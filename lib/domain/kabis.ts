// KABİS (Kiralık Araç Bildirim Sistemi) kuyruğu — 1774 sayılı Kanun kapsamında EGM bildirimi.
// Resmi entegrasyon yöntemi EGM ile teyit edilene kadar "manuel" mod: operatör arackiralama.egm.gov.tr'de
// bildirimi yapar ve referans numarasını girer. "simulate" modu test/demo içindir.
import { all, APP_TZ, getSettings, insertRow, one, run } from '../db';
import { HttpError, nowLocal, str } from '../core';
import { audit } from '../audit';
import type { Customer, Rental, Vehicle } from '../types';

export interface KabisSubmission {
  id: number;
  rental_id: number;
  kind: 'open' | 'close';
  status: 'pending' | 'sent' | 'error';
  attempts: number;
  last_error: string | null;
  reference_no: string | null;
  payload: string;
  created_at: string;
  sent_at: string | null;
}

export type KabisRow = KabisSubmission & { contract_no: string; plate: string; customer_name: string; alarm: boolean };

async function buildPayload(rentalId: number, kind: 'open' | 'close') {
  const r = await one<Rental>('SELECT * FROM rentals WHERE id = ?', rentalId);
  if (!r) throw new HttpError(404, 'Kiralama bulunamadı');
  const c = (await one<Customer>('SELECT * FROM customers WHERE id = ?', r.customer_id))!;
  const v = (await one<Vehicle>('SELECT * FROM vehicles WHERE id = ?', r.vehicle_id))!;
  const branch = await one<{ name: string; city: string | null; address: string | null }>('SELECT name, city, address FROM branches WHERE id = ?', r.pickup_branch_id ?? 0);
  const drivers = await all('SELECT d.first_name, d.last_name, d.national_id, d.license_no FROM rental_drivers rd JOIN drivers d ON d.id = rd.driver_id WHERE rd.rental_id = ?', rentalId);
  return {
    islem: kind === 'open' ? 'KIRALAMA_BASLANGIC' : 'KIRALAMA_BITIS',
    sozlesme_no: r.contract_no,
    firma: { unvan: (await getSettings()).company_name, vergi_no: (await getSettings()).company_tax_no },
    sube: branch ? { ad: branch.name, il: branch.city, adres: branch.address } : null,
    arac: { plaka: v.plate, marka: v.brand, model: v.model, sasi_no: v.vin, motor_no: v.engine_no },
    kiraci: {
      ad: c.first_name, soyad: c.last_name, tc_kimlik_no: c.national_id, pasaport_no: c.passport_no, uyruk: c.nationality,
      dogum_tarihi: c.birth_date, telefon: c.phone, adres: c.address, ehliyet_no: c.license_no, ehliyet_sinifi: c.license_class, ehliyet_tarihi: c.license_date,
    },
    ek_suruculer: drivers,
    baslangic: r.pickup_at,
    planlanan_bitis: r.planned_return_at,
    bitis: kind === 'close' ? r.actual_return_at : null,
    km: kind === 'open' ? r.start_km : r.end_km,
  };
}

/** Teslim/iade tamamlanınca bildirim kaydı hazırlanır (aynı sözleşme+tip için bir kez). */
export async function queueKabis(rentalId: number, kind: 'open' | 'close'): Promise<KabisSubmission> {
  const existing = await one<KabisSubmission>('SELECT * FROM kabis_submissions WHERE rental_id = ? AND kind = ?', rentalId, kind);
  if (existing) return existing;
  const id = await insertRow('kabis_submissions', { rental_id: rentalId, kind, payload: JSON.stringify(await buildPayload(rentalId, kind)) });
  await audit('kabis.queue', 'rental', rentalId, { kind });
  if ((await getSettings()).kabis_mode === 'simulate') return sendKabis(id, {});
  return (await one<KabisSubmission>('SELECT * FROM kabis_submissions WHERE id = ?', id))!;
}

/** Gönderim: simülasyon modunda otomatik referans; manuel modda operatörün girdiği EGM referansı ile kapanır. */
export async function sendKabis(id: number, b: { reference_no?: unknown; error?: unknown }): Promise<KabisSubmission> {
  const sub = await one<KabisSubmission>('SELECT * FROM kabis_submissions WHERE id = ?', id);
  if (!sub) throw new HttpError(404, 'Bildirim bulunamadı');
  if (sub.status === 'sent') return sub;
  const err = str(b.error);
  if (err) {
    await run("UPDATE kabis_submissions SET status = 'error', attempts = attempts + 1, last_error = ? WHERE id = ?", err, id);
    await audit('kabis.error', 'rental', sub.rental_id, { id, error: err });
  } else {
    let ref = str(b.reference_no);
    if (!ref) {
      if ((await getSettings()).kabis_mode !== 'simulate') throw new HttpError(400, 'EGM bildirim referans numarası girilmelidir');
      ref = `SIM-${Date.now().toString(36).toUpperCase()}`;
    }
    await run("UPDATE kabis_submissions SET status = 'sent', attempts = attempts + 1, reference_no = ?, sent_at = ?, last_error = NULL WHERE id = ?", ref, nowLocal(), id);
    await audit('kabis.sent', 'rental', sub.rental_id, { id, reference_no: ref, kind: sub.kind });
  }
  return (await one<KabisSubmission>('SELECT * FROM kabis_submissions WHERE id = ?', id))!;
}

/** Alarm: hata alan veya oluşturulduğu gün içinde gönderilmemiş bildirimler. */
const ALARM_SQL = `(k.status = 'error' OR (k.status = 'pending' AND (substr(k.created_at,1,10) < substr(app_now_text(),1,10) OR k.created_at < to_char((now() - INTERVAL '2 hours') AT TIME ZONE '${APP_TZ}', 'YYYY-MM-DD HH24:MI:SS'))))`;

export async function listKabis(f: { status?: string } = {}): Promise<KabisRow[]> {
  return (await all<KabisRow>(
    `SELECT k.*, r.contract_no, v.plate, c.first_name || ' ' || c.last_name AS customer_name, ${ALARM_SQL} AS alarm
     FROM kabis_submissions k JOIN rentals r ON r.id = k.rental_id JOIN vehicles v ON v.id = r.vehicle_id JOIN customers c ON c.id = r.customer_id
     ${f.status ? 'WHERE k.status = ?' : ''} ORDER BY k.status = 'sent', k.id DESC LIMIT 500`,
    ...(f.status ? [f.status] : []),
  )).map((r) => ({ ...r, alarm: !!r.alarm }));
}

export const kabisAlarms = async () => (await one<{ n: number }>(`SELECT COUNT(*) n FROM kabis_submissions k WHERE ${ALARM_SQL}`))?.n ?? 0;
export const kabisFor = (rentalId: number) => all<KabisSubmission>('SELECT * FROM kabis_submissions WHERE rental_id = ? ORDER BY id', rentalId);
