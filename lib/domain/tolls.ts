// HGS/OGS geçişleri ve trafik cezaları: içe aktarma, sözleşmeyle eşleştirme, istisna kuyruğu, müşteriye yansıtma.
import { all, getSettings, insertRow, one, run, savepoint, tx, updateRow } from '../db';
import { HttpError, addDays, fmtDate, fmtDateTime, mustGet, normDateTime, nowLocal, num, oneOf, optId, parseDate, required, round2, str, today } from '../core';
import { recalcRental } from '../rules';
import { audit } from '../audit';
import { notifyRental, portalUrl, sendTemplate } from './notify';
import { dt, money } from '../format';
import type { Body, Customer, Rental, SessionUser, Vehicle } from '../types';

// ---------- CSV ----------

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') {
        if (q && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === delim && !q) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]).map((h) => h.toLocaleLowerCase('tr-TR').replace(/[^a-zçğıöşü0-9_]/g, ''));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i] ?? `c${i}`, v])));
}

const pick = (row: Record<string, string>, keys: string[]) => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
  return '';
};

/** "12.03.2026 14:35" / "2026-03-12 14:35" / ISO → "YYYY-MM-DDTHH:MM" */
export function parseTrDateTime(s: string): string | null {
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s.trim());
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}`;
  const d = parseDate(s);
  return d ? fmtDateTime(d) : null;
}

const parseAmount = (s: string) => num(String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'), NaN);
const normPlate = (p: string) => p.toLocaleUpperCase('tr-TR').replace(/\s+/g, '');

async function findVehicle(plate: string, tag?: string): Promise<Vehicle | undefined> {
  if (tag) {
    const v = await one<Vehicle>('SELECT * FROM vehicles WHERE hgs_tag_no = ?', tag);
    if (v) return v;
  }
  return plate ? await one<Vehicle>("SELECT * FROM vehicles WHERE REPLACE(UPPER(plate), ' ', '') = ?", normPlate(plate)) : undefined;
}

/** Olay zamanında aracı kullanan sözleşme (teslim ≤ t ≤ iade). */
export async function rentalAt(vehicleId: number, at: string): Promise<Rental | undefined> {
  return await one<Rental>(
    `SELECT * FROM rentals WHERE vehicle_id = ? AND status IN ('active','returned','closed') AND pickup_at <= ?
       AND COALESCE(actual_return_at, GREATEST(planned_return_at, ?)) >= ? ORDER BY pickup_at DESC LIMIT 1`,
    vehicleId, at, nowLocal(), at,
  ) ?? // ikame araç değişikliklerinde eski araçla yapılan geçişler
    await one<Rental>(
      `SELECT r.* FROM rental_vehicle_changes c JOIN rentals r ON r.id = c.rental_id
       WHERE c.old_vehicle_id = ? AND r.pickup_at <= ? AND c.changed_at >= ? LIMIT 1`, vehicleId, at, at,
    );
}

// ================= HGS / OGS =================

export interface Toll {
  id: number;
  vehicle_id: number | null;
  plate: string | null;
  tag_no: string | null;
  passed_at: string;
  location: string | null;
  amount: number;
  rental_id: number | null;
  status: 'unmatched' | 'matched' | 'charged' | 'company' | 'disputed';
  charge_id: number | null;
  service_fee: number;
  batch: string | null;
  note: string | null;
  created_at: string;
}

export type TollRow = Toll & { contract_no: string | null; customer_name: string | null };

export function listTolls(f: { status?: string; q?: string; from?: string; to?: string } = {}): Promise<TollRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.status)) { where.push('t.status = ?'); params.push(str(f.status)!); }
  if (str(f.q)) { where.push('(t.plate ILIKE ? OR t.location ILIKE ? OR r.contract_no ILIKE ?)'); params.push(...Array(3).fill(`%${str(f.q)}%`)); }
  if (str(f.from)) { where.push('t.passed_at >= ?'); params.push(str(f.from)!); }
  if (str(f.to)) { where.push('t.passed_at <= ?'); params.push(str(f.to) + 'T23:59'); }
  return all<TollRow>(
    `SELECT t.*, r.contract_no, c.first_name || ' ' || c.last_name AS customer_name FROM toll_transactions t
     LEFT JOIN rentals r ON r.id = t.rental_id LEFT JOIN customers c ON c.id = r.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.status = 'unmatched' DESC, t.passed_at DESC LIMIT 1000`,
    ...params,
  );
}

async function chargeToll(t: Toll, rental: Rental, userId: number | null) {
  const fee = num((await getSettings()).hgs_service_fee);
  const chargeId = await insertRow('rental_charges', {
    rental_id: rental.id, type: 'hgs', amount: round2(t.amount + fee), toll_id: t.id, created_by: userId,
    description: `${dt(t.passed_at)} ${t.location ?? ''} (${money(t.amount)} + hizmet ${money(fee)})`.trim(),
    post_charge: rental.status === 'returned' || rental.status === 'closed' ? 1 : 0,
  });
  await updateRow('toll_transactions', t.id, { status: 'charged', rental_id: rental.id, charge_id: chargeId, service_fee: fee });
  await recalcRental(rental.id);
  await notifyRental('hgs_notice', rental.id, { vars: { amount: money(t.amount + fee) }, dedupeKey: `hgs:${t.id}` });
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

/** Banka/PTT/sağlayıcı ekstresi CSV'si: plaka;tarih;gise;tutar (başlık isimleri esnek). */
export async function importTolls(csv: string, user: SessionUser): Promise<ImportResult> {
  const rows = parseCsv(csv);
  if (!rows.length) throw new HttpError(400, 'CSV boş veya başlık satırı yok');
  const res: ImportResult = { imported: 0, duplicates: 0, matched: 0, unmatched: 0, errors: [] };
  const batch = `HGS-${fmtDateTime(new Date())}`;
  await tx(async () => {
    for (const [i, row] of rows.entries()) {
      const plate = pick(row, ['plaka', 'plate']);
      const tag = pick(row, ['etiket', 'etiketno', 'tag', 'hgs', 'ogs']);
      const passed = parseTrDateTime(pick(row, ['tarih', 'tarihsaat', 'gecistarihi', 'date', 'datetime', 'passed_at']));
      const amount = parseAmount(pick(row, ['tutar', 'ucret', 'amount']));
      const location = pick(row, ['gise', 'gişe', 'giseadi', 'yer', 'istasyon', 'location']) || null;
      if (!passed || !Number.isFinite(amount) || (!plate && !tag)) {
        res.errors.push(`Satır ${i + 2}: plaka/etiket, tarih ve tutar zorunlu`);
        continue;
      }
      const vehicle = await findVehicle(plate, tag);
      const r = await one<{ id: number }>(
        `INSERT INTO toll_transactions(vehicle_id, plate, tag_no, passed_at, location, amount, batch) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (plate, passed_at, location, amount) DO NOTHING RETURNING id`,
        vehicle?.id ?? null, vehicle?.plate ?? plate.toLocaleUpperCase('tr-TR'), tag || vehicle?.hgs_tag_no || null, passed, location, round2(amount), batch,
      );
      if (!r) {
        res.duplicates++;
        continue;
      }
      res.imported++;
      const toll = (await one<Toll>('SELECT * FROM toll_transactions WHERE id = ?', r.id))!;
      if (vehicle) await run('UPDATE vehicles SET hgs_balance = hgs_balance - ? WHERE id = ?', toll.amount, vehicle.id);
      const rental = vehicle ? await rentalAt(vehicle.id, passed) : undefined;
      if (rental) {
        await chargeToll(toll, rental, user.id);
        res.matched++;
      } else res.unmatched++;
    }
  });
  await audit('toll.import', 'toll', null, { ...res, errors: res.errors.length });
  return res;
}

/** İstisna kuyruğu: elle sözleşmeye bağla / şirket gideri / itiraz. */
export async function resolveToll(id: number, action: 'assign' | 'company' | 'dispute', b: Body, user: SessionUser): Promise<Toll> {
  const t = await mustGet<Toll>('toll_transactions', id, 'Geçiş');
  if (t.status === 'charged' && action !== 'dispute') throw new HttpError(409, 'Geçiş zaten müşteriye yansıtılmış');
  await tx(async () => {
    if (action === 'assign') {
      const rental = await mustGet<Rental>('rentals', num(b.rental_id), 'Sözleşme');
      await chargeToll(t, rental, user.id);
    } else if (action === 'company') {
      await updateRow('toll_transactions', id, { status: 'company', note: str(b.note) });
      await insertRow('expenses', { vehicle_id: t.vehicle_id, category: 'HGS yükleme', amount: t.amount, expense_date: t.passed_at.slice(0, 10), description: `Şirket kullanımı geçiş: ${t.location ?? ''}`, created_by: user.id });
    } else await updateRow('toll_transactions', id, { status: 'disputed', note: str(b.note) });
    await audit(`toll.${action}`, 'toll', id, { rental_id: b.rental_id });
  });
  return mustGet<Toll>('toll_transactions', id);
}

/** Sözleşme bulunamayan geçişleri yeniden eşleştirmeyi dener (geç gelen kayıtlar için). */
export async function rematchTolls(user: SessionUser) {
  let n = 0;
  for (const t of await all<Toll>("SELECT * FROM toll_transactions WHERE status = 'unmatched' AND vehicle_id IS NOT NULL")) {
    const r = await rentalAt(t.vehicle_id!, t.passed_at);
    if (r) {
      await tx(() => chargeToll(t, r, user.id));
      n++;
    }
  }
  return { matched: n };
}

// ================= TRAFİK CEZALARI =================

export const FINE_TYPES: Record<string, string> = {
  speed: 'Hız ihlali', eds: 'EDS (elektronik denetim)', red_light: 'Kırmızı ışık', parking: 'Park cezası', closed_road: 'Kapalı yol / şerit ihlali',
  tow: 'Çekici / otopark', toll_evasion: 'Otoyol kaçak geçiş', other: 'Diğer',
};

export interface Fine {
  id: number;
  vehicle_id: number | null;
  plate: string;
  fine_no: string | null;
  violation_at: string;
  type: string;
  location: string | null;
  amount: number;
  notified_at: string | null;
  discount_deadline: string | null;
  rental_id: number | null;
  customer_id: number | null;
  status: 'new' | 'matched' | 'transferred' | 'charged' | 'paid' | 'objected' | 'closed' | 'cancelled';
  charge_id: number | null;
  service_fee: number;
  paid_amount: number | null;
  paid_at: string | null;
  objection_note: string | null;
  file_id: number | null;
  notes: string | null;
  created_at: string;
}

export type FineRow = Fine & { contract_no: string | null; customer_name: string | null; limitation_date: string; warning: string | null };

function fineWarning(f: Fine): string | null {
  if (['paid', 'closed', 'cancelled'].includes(f.status)) return null;
  const t = today();
  if (f.discount_deadline) {
    if (f.discount_deadline < t) return 'İndirimli ödeme süresi geçti';
    if (f.discount_deadline <= fmtDate(addDays(new Date(), 3))) return `İndirimli ödeme son günü: ${f.discount_deadline}`;
  }
  return null;
}

export async function listFines(f: { status?: string; q?: string } = {}): Promise<FineRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.status)) { where.push('f.status = ?'); params.push(str(f.status)!); }
  if (str(f.q)) { where.push('(f.plate ILIKE ? OR f.fine_no ILIKE ? OR r.contract_no ILIKE ?)'); params.push(...Array(3).fill(`%${str(f.q)}%`)); }
  const limitDays = num((await getSettings()).fine_limitation_days, 730);
  return (await all<Fine & { contract_no: string | null; customer_name: string | null }>(
    `SELECT f.*, r.contract_no, c.first_name || ' ' || c.last_name AS customer_name FROM traffic_fines f
     LEFT JOIN rentals r ON r.id = f.rental_id LEFT JOIN customers c ON c.id = f.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.violation_at DESC LIMIT 1000`,
    ...params,
  )).map((x) => ({ ...x, limitation_date: fmtDate(addDays(parseDate(x.violation_at)!, limitDays)), warning: fineWarning(x) }));
}

async function matchFine(id: number) {
  const f = await mustGet<Fine>('traffic_fines', id);
  if (!f.vehicle_id) return;
  const r = await rentalAt(f.vehicle_id, f.violation_at);
  if (r) await updateRow('traffic_fines', id, { rental_id: r.id, customer_id: r.customer_id, status: f.status === 'new' ? 'matched' : f.status });
}

async function fineData(b: Body) {
  required(b, [['plate', 'Plaka'], ['violation_at', 'İhlal tarihi'], ['amount', 'Tutar']]);
  const vehicle = await findVehicle(String(b.plate));
  const notified = str(b.notified_at) ? normDateTime(b.notified_at, 'Tebliğ tarihi').slice(0, 10) : null;
  return {
    vehicle_id: vehicle?.id ?? null,
    plate: vehicle?.plate ?? String(b.plate).toLocaleUpperCase('tr-TR'),
    fine_no: str(b.fine_no),
    violation_at: normDateTime(parseTrDateTime(String(b.violation_at)) ?? b.violation_at, 'İhlal tarihi'),
    type: oneOf(b.type, Object.keys(FINE_TYPES), 'Ceza tipi', 'other'),
    location: str(b.location),
    amount: round2(num(b.amount)),
    notified_at: notified,
    discount_deadline: notified ? fmtDate(addDays(parseDate(notified)!, num((await getSettings()).fine_discount_days, 15))) : null,
    file_id: optId(b.file_id),
    notes: str(b.notes),
  };
}

export async function createFine(b: Body, user: SessionUser): Promise<FineRow> {
  const id = await insertRow('traffic_fines', { ...await fineData(b), created_by: user.id });
  await matchFine(id);
  await audit('fine.create', 'fine', id);
  return (await listFines()).find((x) => x.id === id)!;
}

export async function importFines(csv: string, user: SessionUser): Promise<ImportResult> {
  const rows = parseCsv(csv);
  if (!rows.length) throw new HttpError(400, 'CSV boş veya başlık satırı yok');
  const res: ImportResult = { imported: 0, duplicates: 0, matched: 0, unmatched: 0, errors: [] };
  await tx(async () => {
    for (const [i, row] of rows.entries()) {
      try {
        // Satır hatası tüm işlemi iptal etmesin (Postgres): her satır kendi SAVEPOINT'inde
        await savepoint(async () => {
          const body = {
            plate: pick(row, ['plaka', 'plate']), violation_at: pick(row, ['tarih', 'cezatarihi', 'ihlaltarihi', 'date']),
            amount: parseAmount(pick(row, ['tutar', 'ceza', 'amount'])), fine_no: pick(row, ['cezano', 'tutanakno', 'no', 'fine_no']) || null,
            location: pick(row, ['yer', 'konum', 'location']) || null, notified_at: pick(row, ['teblig', 'tebligtarihi', 'notified_at']) || null,
            type: pick(row, ['tip', 'type']) || 'other',
          };
          const parsedNotified = body.notified_at ? parseTrDateTime(body.notified_at) : null;
          if (body.fine_no && (await one('SELECT 1 FROM traffic_fines WHERE fine_no = ?', body.fine_no))) {
            res.duplicates++;
            return;
          }
          const data = await fineData({ ...body, notified_at: parsedNotified, type: FINE_TYPES[body.type] ? body.type : 'other' });
          const id = await insertRow('traffic_fines', { ...data, created_by: user.id });
          await matchFine(id);
          res.imported++;
          if (await one('SELECT 1 FROM traffic_fines WHERE id = ? AND rental_id IS NOT NULL', id)) res.matched++;
          else res.unmatched++;
        });
      } catch (e) {
        res.errors.push(`Satır ${i + 2}: ${(e as Error).message}`);
      }
    }
  });
  await audit('fine.import', 'fine', null, { ...res, errors: res.errors.length });
  return res;
}

export async function fineAction(id: number, action: string, b: Body, user: SessionUser): Promise<Fine> {
  const f = await mustGet<Fine>('traffic_fines', id, 'Ceza');
  switch (action) {
    case 'assign': {
      const r = await mustGet<Rental>('rentals', num(b.rental_id), 'Sözleşme');
      await updateRow('traffic_fines', id, { rental_id: r.id, customer_id: r.customer_id, status: f.status === 'new' ? 'matched' : f.status });
      break;
    }
    case 'charge': {
      if (!f.rental_id) throw new HttpError(409, 'Ceza bir sözleşmeyle eşleşmemiş');
      if (f.charge_id) throw new HttpError(409, 'Ceza zaten yansıtılmış');
      const r = await mustGet<Rental>('rentals', f.rental_id);
      const fee = str(b.service_fee) === null ? num((await getSettings()).fine_service_fee) : num(b.service_fee);
      await tx(async () => {
        const chargeId = await insertRow('rental_charges', {
          rental_id: r.id, type: 'traffic_fine', amount: round2(f.amount + fee), fine_id: id, created_by: user.id,
          description: `${FINE_TYPES[f.type] ?? f.type} ${dt(f.violation_at)}${f.fine_no ? ' #' + f.fine_no : ''} (${money(f.amount)} + hizmet ${money(fee)})`,
          post_charge: r.status === 'returned' || r.status === 'closed' ? 1 : 0,
        });
        await updateRow('traffic_fines', id, { status: 'charged', charge_id: chargeId, service_fee: fee });
        await recalcRental(r.id);
      });
      const customer = (await one<Customer>('SELECT * FROM customers WHERE id = ?', r.customer_id))!;
      await sendTemplate('fine_notice', {
        customer, entity: 'fine', entityId: id, dedupeKey: `fine:${id}`,
        vars: { plate: f.plate, contract_no: r.contract_no, violation_at: dt(f.violation_at), amount: money(f.amount + fee), portal_url: await portalUrl(r.portal_token) },
      });
      break;
    }
    case 'transfer': {
      // Sürücüye devir (kabahatliye bildirim) yazısı
      const { fineLetterPdf } = await import('../documents');
      const pdf = await fineLetterPdf(id);
      await updateRow('traffic_fines', id, { status: 'transferred', file_id: f.file_id ?? pdf.id, notes: [f.notes, `Devir yazısı #${pdf.id}`].filter(Boolean).join(' · ') });
      break;
    }
    case 'pay':
      await updateRow('traffic_fines', id, { status: f.charge_id ? 'closed' : 'paid', paid_amount: num(b.paid_amount, f.amount), paid_at: str(b.paid_at) ?? today() });
      if (!f.charge_id) {
        await insertRow('expenses', { vehicle_id: f.vehicle_id, category: 'Trafik cezası', amount: num(b.paid_amount, f.amount), expense_date: today(), description: `Ceza ${f.fine_no ?? id} şirket ödemesi`, created_by: user.id });
      }
      break;
    case 'object':
      await updateRow('traffic_fines', id, { status: 'objected', objection_note: str(b.note) });
      break;
    case 'close':
      await updateRow('traffic_fines', id, { status: 'closed', notes: [f.notes, str(b.note)].filter(Boolean).join(' · ') });
      break;
    case 'cancel':
      if (f.charge_id) throw new HttpError(409, 'Yansıtılmış ceza önce ücret affı ile geri alınmalı');
      await updateRow('traffic_fines', id, { status: 'cancelled', notes: str(b.note) });
      break;
    default:
      throw new HttpError(404, 'Bilinmeyen işlem');
  }
  await audit(`fine.${action}`, 'fine', id, { rental_id: b.rental_id });
  return mustGet<Fine>('traffic_fines', id);
}

/** HGS/ceza yönetim özeti (gösterge paneli ve raporlar için). */
export async function tollFineSummary() {
  return {
    unmatched_tolls: (await one<{ n: number }>("SELECT COUNT(*) n FROM toll_transactions WHERE status = 'unmatched'"))!.n,
    open_fines: (await one<{ n: number }>("SELECT COUNT(*) n FROM traffic_fines WHERE status IN ('new','matched','transferred')"))!.n,
    fine_deadlines: (await listFines()).filter((f) => f.warning).length,
    low_hgs: await all<{ id: number; plate: string; hgs_balance: number }>(
      "SELECT id, plate, hgs_balance FROM vehicles WHERE hgs_tag_no IS NOT NULL AND status <> 'sold' AND hgs_balance < ?", num((await getSettings()).hgs_low_balance),
    ),
  };
}
