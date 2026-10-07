// Müşteri self-servis portalı (giriş gerektirmez; rezervasyon/sözleşmeye özel gizli bağlantı ile).
// Telefon uygulamasındaki müşteri akışlarının web karşılığı: online check-in, belge yükleme, sözleşme/fatura,
// HGS/ceza görüntüleme, yol yardım ve uzatma talebi, memnuniyet anketi.
import { all, getSettings, insertRow, one, run } from '../db';
import { HttpError, bool, normDate, normDateTime, nowLocal, num, oneOf, round2, str } from '../core';
import { rentalFinance } from '../rules';
import { audit } from '../audit';
import { listFiles, saveFile, type StoredFile } from '../files';
import { DOC_TYPES } from '../inspection';
import { consentState, recordConsent } from './customers';
import type { Customer, Rental, Reservation, RentalCharge } from '../types';

interface PortalTarget {
  reservation: Reservation | null;
  rental: Rental | null;
  customer: Customer;
}

async function resolve(token: string): Promise<PortalTarget> {
  if (!token || token.length < 16) throw new HttpError(404, 'Bağlantı geçersiz');
  const rental = await one<Rental>("SELECT * FROM rentals WHERE portal_token = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1", token) ?? null;
  const reservation = await one<Reservation>('SELECT * FROM reservations WHERE portal_token = ?', token) ?? null;
  if (!rental && !reservation) throw new HttpError(404, 'Bağlantı geçersiz veya süresi dolmuş');
  const customer = (await one<Customer>('SELECT * FROM customers WHERE id = ?', (rental ?? reservation)!.customer_id))!;
  if (customer.anonymized_at) throw new HttpError(410, 'Kayıt silinmiş');
  return { rental, reservation, customer };
}

export async function getPortal(token: string) {
  const { rental, reservation, customer } = await resolve(token);
  const s = await getSettings();
  const vehicle = rental
    ? await one<{ plate: string; brand: string; model: string; category: string }>('SELECT plate, brand, model, category FROM vehicles WHERE id = ?', rental.vehicle_id)
    : reservation?.vehicle_id
      ? await one<{ plate: string; brand: string; model: string; category: string }>('SELECT plate, brand, model, category FROM vehicles WHERE id = ?', reservation.vehicle_id)
      : null;
  const branch = async (id: number | null) => (id ? await one<{ name: string; address: string | null; phone: string | null }>('SELECT name, address, phone FROM branches WHERE id = ?', id) ?? null : null);
  const base = rental ?? reservation!;
  const fin = rental ? await rentalFinance(rental) : null;
  const docs: StoredFile[] = rental ? await all<StoredFile>("SELECT * FROM files WHERE entity = 'rental' AND entity_id = ? AND kind = 'pdf' AND voided_at IS NULL ORDER BY id DESC", rental.id) : [];
  const invoices = rental
    ? await all<{ id: number; invoice_no: string; type: string; total: number; issue_date: string; pdf_file_id: number | null }>(
      "SELECT id, invoice_no, type, total, issue_date, pdf_file_id FROM invoices WHERE rental_id = ? AND status <> 'cancelled' ORDER BY id", rental.id,
    )
    : [];
  return {
    company: { name: s.company_name, phone: s.company_phone, email: s.company_email },
    customer: {
      first_name: customer.first_name, last_name: customer.last_name, email: customer.email, phone: customer.phone, birth_date: customer.birth_date,
      license_no: customer.license_no, license_class: customer.license_class, license_date: customer.license_date, license_expiry: customer.license_expiry,
      address: customer.address, preferred_language: customer.preferred_language,
    },
    consents: await consentState(customer.id),
    documents_uploaded: (await listFiles('customer', customer.id)).map((f) => ({ id: f.id, doc_type: JSON.parse(f.meta || '{}').doc_type as string, created_at: f.created_at })),
    kind: rental ? ('rental' as const) : ('reservation' as const),
    status: rental ? rental.status : reservation!.status,
    code: rental ? rental.contract_no : reservation!.code,
    vehicle,
    category: reservation?.category ?? vehicle?.category ?? null,
    pickup_at: base.pickup_at,
    return_at: rental ? rental.planned_return_at : reservation!.return_at,
    actual_return_at: rental?.actual_return_at ?? null,
    pickup_branch: await branch(base.pickup_branch_id),
    return_branch: await branch(base.return_branch_id),
    total: base.total_amount,
    deposit: base.deposit_amount,
    finance: fin ? { paid: fin.paid, balance: fin.balance, deposit_held: fin.deposit_held } : null,
    charges: rental ? await all<RentalCharge>("SELECT * FROM rental_charges WHERE rental_id = ? ORDER BY id", rental.id) : [],
    files: docs
      .map((d) => ({ id: d.id, name: d.original_name, doc: JSON.parse(d.meta || '{}').doc as string, created_at: d.created_at }))
      .filter((d) => d.doc === 'contract' || d.doc === 'settlement'),
    invoices,
    open_requests: rental ? await all<{ id: number; type: string; status: string; created_at: string }>("SELECT id, type, status, created_at FROM tasks WHERE rental_id = ? AND type IN ('roadside','extension_request') ORDER BY id DESC", rental.id) : [],
    nps_done: rental ? !!await one('SELECT 1 FROM nps_responses WHERE rental_id = ?', rental.id) : false,
    can_precheckin: !rental && ['pending', 'confirmed'].includes(reservation!.status),
  };
}

export type PortalView = Awaited<ReturnType<typeof getPortal>>;

/** Online check-in: ehliyet/iletişim bilgileri + KVKK onayı. */
export async function portalCheckin(token: string, b: Record<string, unknown>) {
  const { customer } = await resolve(token);
  if (!bool(b.kvkk_notice)) throw new HttpError(400, 'KVKK aydınlatma metnini onaylamanız gerekir');
  const email = str(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-posta geçersiz');
  const data: Record<string, string | null> = {
    email: email ?? customer.email, address: str(b.address) ?? customer.address, license_no: str(b.license_no) ?? customer.license_no,
    license_class: str(b.license_class) ?? customer.license_class, license_date: normDate(b.license_date, 'Ehliyet tarihi', true) ?? customer.license_date,
    license_expiry: normDate(b.license_expiry, 'Ehliyet geçerlilik', true) ?? customer.license_expiry, birth_date: normDate(b.birth_date, 'Doğum tarihi', true) ?? customer.birth_date,
  };
  const keys = Object.keys(data);
  // Portal kullanıcısı yalnızca bu alanları değiştirebilir
  await run(`UPDATE customers SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), customer.id);
  await recordConsent(customer.id, 'kvkk_notice', true, 'portal');
  for (const t of ['marketing_email', 'marketing_sms', 'marketing_whatsapp']) if (b[t] !== undefined) await recordConsent(customer.id, t, b[t], 'portal');
  await audit('portal.checkin', 'customer', customer.id);
  return getPortal(token);
}

export async function portalUpload(token: string, docType: string, file: { name: string; type: string; data: Buffer }) {
  const { customer } = await resolve(token);
  const t = oneOf(docType, Object.keys(DOC_TYPES) as (keyof typeof DOC_TYPES)[], 'Belge tipi');
  await saveFile({ kind: 'document', entity: 'customer', entityId: customer.id, name: file.name, mime: file.type, data: file.data, meta: { doc_type: t, source: 'portal' } });
  return getPortal(token);
}

export async function portalRequest(token: string, type: string, b: Record<string, unknown>) {
  const { rental } = await resolve(token);
  if (!rental || rental.status !== 'active') throw new HttpError(409, 'Talep yalnızca aktif kiralama için oluşturulabilir');
  const kind = oneOf(type, ['roadside', 'extension_request'] as const, 'Talep tipi');
  const note = str(b.note);
  if (kind === 'roadside' && !note) throw new HttpError(400, 'Lütfen sorunu ve konumunuzu yazın');
  const until = kind === 'extension_request' ? normDateTime(b.return_at, 'Yeni dönüş tarihi') : null;
  if (until && until <= rental.planned_return_at) throw new HttpError(400, 'Yeni tarih mevcut dönüş tarihinden sonra olmalı');
  await insertRow('tasks', {
    type: kind, title: kind === 'roadside' ? `Yol yardım talebi · ${rental.contract_no}` : `Uzatma talebi · ${rental.contract_no} → ${until}`,
    rental_id: rental.id, vehicle_id: rental.vehicle_id, branch_id: rental.return_branch_id, address: str(b.location),
    priority: kind === 'roadside' ? 'urgent' : 'normal', notes: [note, until ? `İstenen dönüş: ${until}` : null, str(b.phone) ? `Tel: ${str(b.phone)}` : null].filter(Boolean).join('\n'),
    due_at: nowLocal(),
  });
  await audit(`portal.${kind}`, 'rental', rental.id);
  return getPortal(token);
}

export async function portalNps(token: string, score: unknown, comment: unknown) {
  const { rental } = await resolve(token);
  if (!rental || !['returned', 'closed'].includes(rental.status)) throw new HttpError(409, 'Anket iade sonrası doldurulabilir');
  const s = Math.floor(num(score, -1));
  if (!(s >= 0 && s <= 10)) throw new HttpError(400, 'Puan 0-10 arası olmalı');
  if (await one('SELECT 1 FROM nps_responses WHERE rental_id = ?', rental.id)) throw new HttpError(409, 'Anket zaten yanıtlandı');
  await insertRow('nps_responses', { rental_id: rental.id, score: s, comment: str(comment) });
  return getPortal(token);
}

/** Portal üzerinden yalnızca bu sözleşme/müşteriye ait belgeler indirilebilir. */
export async function portalFileAllowed(token: string, fileId: number): Promise<boolean> {
  const { rental, customer } = await resolve(token);
  const f = await one<StoredFile>('SELECT * FROM files WHERE id = ? AND voided_at IS NULL', fileId);
  if (!f) return false;
  if (rental && f.entity === 'rental' && f.entity_id === rental.id && f.kind === 'pdf') {
    const doc = JSON.parse(f.meta || '{}').doc;
    return doc === 'contract' || doc === 'settlement';
  }
  if (f.entity === 'invoice') return !!await one('SELECT 1 FROM invoices WHERE id = ? AND customer_id = ?', f.entity_id, customer.id);
  return false;
}

export const npsSummary = async () => {
  const rows = await all<{ score: number }>('SELECT score FROM nps_responses');
  const n = rows.length;
  const promoters = rows.filter((r) => r.score >= 9).length;
  const detractors = rows.filter((r) => r.score <= 6).length;
  return { responses: n, nps: n ? round2(((promoters - detractors) / n) * 100) : null };
};
