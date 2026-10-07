// CRM + KVKK: müşteri kartı, kurumsal cari, ek sürücüler, belgeler, rıza kayıtları, veri ihracı ve anonimleştirme.
import { all, insertRow, one, run, tx, updateRow } from '../db';
import { bool, HttpError, mapSeq, mustGet, normDate, nowLocal, num, oneOf, optId, required, round2, str } from '../core';
import { customerIssues, customerWarnings, paymentTotals } from '../rules';
import { audit } from '../audit';
import { getContext } from '../context';
import { listFiles, voidFile, type StoredFile } from '../files';
import type { Body, Customer, CustomerListItem, Payment, ReservationStatus, RentalStatus, SessionUser } from '../types';

export const CONSENT_TYPES: Record<string, string> = {
  kvkk_notice: 'KVKK aydınlatma metni okundu',
  explicit_consent: 'Açık rıza (yurt dışı aktarım / özel nitelikli veri)',
  marketing_email: 'Ticari ileti — e-posta (İYS)',
  marketing_sms: 'Ticari ileti — SMS (İYS)',
  marketing_whatsapp: 'Ticari ileti — WhatsApp (İYS)',
};

export function listCustomers(f: { q?: string; blacklisted?: string; type?: string } = {}): Promise<CustomerListItem[]> {
  const where: string[] = ['c.anonymized_at IS NULL'];
  const params: (string | number)[] = [];
  const q = str(f.q);
  if (q) {
    where.push(`(c.first_name || ' ' || c.last_name ILIKE ? OR c.company_name ILIKE ? OR c.phone ILIKE ? OR c.email ILIKE ?
                 OR c.national_id ILIKE ? OR c.passport_no ILIKE ? OR c.license_no ILIKE ? OR c.tax_no ILIKE ?)`);
    params.push(...Array(8).fill(`%${q}%`));
  }
  if (f.blacklisted !== undefined && f.blacklisted !== '') {
    where.push('c.blacklisted = ?');
    params.push(bool(f.blacklisted));
  }
  if (str(f.type)) {
    where.push('c.type = ?');
    params.push(str(f.type)!);
  }
  return all<CustomerListItem>(
    `SELECT c.*,
      (SELECT COUNT(*) FROM rentals WHERE customer_id = c.id AND status NOT IN ('cancelled','draft')) AS rental_count,
      (SELECT COALESCE(SUM(total_amount),0) FROM rentals WHERE customer_id = c.id AND status NOT IN ('cancelled','draft')) AS total_spent
     FROM customers c WHERE ${where.join(' AND ')}
     ORDER BY c.first_name, c.last_name LIMIT 500`,
    ...params,
  );
}

export interface Driver {
  id: number;
  customer_id: number;
  first_name: string;
  last_name: string;
  national_id: string | null;
  birth_date: string | null;
  phone: string | null;
  license_no: string | null;
  license_class: string | null;
  license_date: string | null;
  license_expiry: string | null;
}

export interface Consent {
  id: number;
  type: string;
  granted: number;
  channel: string | null;
  text_version: string | null;
  ip: string | null;
  recorded_by_name: string | null;
  created_at: string;
}

export interface CustomerDetail extends Customer {
  rentals: { id: number; contract_no: string; pickup_at: string; planned_return_at: string; actual_return_at: string | null; status: RentalStatus; total_amount: number; plate: string; brand: string; model: string; paid: number; balance: number }[];
  reservations: { id: number; code: string; pickup_at: string; return_at: string; status: ReservationStatus; total_amount: number; plate: string | null; category: string | null }[];
  payments: Payment[];
  drivers: Driver[];
  documents: StoredFile[];
  consents: Consent[];
  balance: number;
  issues: string[];
  warnings: string[];
  agency_name: string | null;
}

/** Müşteri kartı; kişisel veri erişimi KVKK kapsamında loglanır. */
export async function getCustomer(id: number, opts: { log?: boolean } = {}): Promise<CustomerDetail> {
  const c = await mustGet<Customer>('customers', id, 'Müşteri');
  if (opts.log) await audit('pii.view', 'customer', id);
  const rentals = await mapSeq(await all<Omit<CustomerDetail['rentals'][number], 'paid' | 'balance'>>(
    `SELECT r.id, r.contract_no, r.pickup_at, r.planned_return_at, r.actual_return_at, r.status, r.total_amount, v.plate, v.brand, v.model
     FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.customer_id = ? ORDER BY r.pickup_at DESC`, id,
      ), async (r) => {
    const t = await paymentTotals('rental_id', r.id);
    return { ...r, paid: t.paid, balance: ['cancelled', 'draft'].includes(r.status) ? 0 : round2(r.total_amount - t.paid) };
  });
  const balance = round2(rentals.reduce((a, x) => a + x.balance, 0));
  return {
    ...c,
    rentals,
    reservations: await all(
      `SELECT r.id, r.code, r.pickup_at, r.return_at, r.status, r.total_amount, v.plate, r.category
       FROM reservations r LEFT JOIN vehicles v ON v.id = r.vehicle_id WHERE r.customer_id = ? ORDER BY r.pickup_at DESC`, id,
    ),
    payments: await all<Payment>('SELECT * FROM payments WHERE customer_id = ? ORDER BY paid_at DESC, id DESC', id),
    drivers: await all<Driver>('SELECT * FROM drivers WHERE customer_id = ? ORDER BY id', id),
    documents: await listFiles('customer', id),
    consents: await all<Consent>(
      `SELECT c.*, u.full_name AS recorded_by_name FROM consents c LEFT JOIN users u ON u.id = c.recorded_by
       WHERE c.customer_id = ? ORDER BY c.id DESC`, id,
    ),
    balance,
    issues: await customerIssues(c, nowLocal(), { strict: true }),
    warnings: customerWarnings(c, balance),
    agency_name: c.agency_id ? ((await one<{ name: string }>('SELECT name FROM agencies WHERE id = ?', c.agency_id))?.name ?? null) : null,
  };
}

function customerData(b: Body) {
  const email = str(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-posta adresi geçersiz');
  const nid = str(b.national_id);
  if (nid && !validTckn(nid)) throw new HttpError(400, 'T.C. kimlik numarası geçersiz');
  return {
    type: oneOf(b.type, ['individual', 'corporate'] as const, 'Müşteri tipi', 'individual'),
    first_name: str(b.first_name),
    last_name: str(b.last_name),
    company_name: str(b.company_name),
    tax_office: str(b.tax_office),
    tax_no: str(b.tax_no),
    national_id: nid,
    passport_no: str(b.passport_no),
    nationality: str(b.nationality) || 'TR',
    birth_date: normDate(b.birth_date, 'Doğum tarihi', true),
    phone: str(b.phone),
    email,
    address: str(b.address),
    license_no: str(b.license_no),
    license_class: str(b.license_class),
    license_date: normDate(b.license_date, 'Ehliyet tarihi', true),
    license_expiry: normDate(b.license_expiry, 'Ehliyet geçerlilik tarihi', true),
    invoice_title: str(b.invoice_title),
    invoice_address: str(b.invoice_address),
    credit_limit: Math.max(0, num(b.credit_limit)),
    risk_score: Math.min(100, Math.max(0, Math.floor(num(b.risk_score)))),
    risk_note: str(b.risk_note),
    preferred_language: oneOf(b.preferred_language, ['tr', 'en', 'de', 'ru'] as const, 'Dil', 'tr'),
    agency_id: optId(b.agency_id),
    blacklisted: bool(b.blacklisted),
    blacklist_reason: str(b.blacklist_reason),
    notes: str(b.notes),
  };
}

/** T.C. kimlik numarası algoritma kontrolü (11 hane + kontrol haneleri). */
export function validTckn(v: string): boolean {
  if (!/^[1-9]\d{10}$/.test(v)) return false;
  const d = v.split('').map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, x) => a + x, 0) % 10 === d[10];
}

const REQUIRED: [string, string][] = [['first_name', 'Ad'], ['last_name', 'Soyad'], ['phone', 'Telefon']];

export async function createCustomer(b: Body, user?: SessionUser): Promise<Customer> {
  required(b, REQUIRED);
  const data = customerData(b);
  if (data.national_id && await one('SELECT 1 FROM customers WHERE national_id = ? AND anonymized_at IS NULL', data.national_id)) {
    throw new HttpError(409, 'Bu T.C. kimlik numarası ile kayıtlı müşteri var');
  }
  const id = await tx(async () => {
    const newId = await insertRow('customers', data);
    // Kayıt sırasında alınan rızalar
    for (const type of Object.keys(CONSENT_TYPES)) {
      if (b[`consent_${type}`] !== undefined) await recordConsent(newId, type, b[`consent_${type}`], 'Ofis', user);
    }
    return newId;
  });
  await audit('customer.create', 'customer', id);
  return mustGet<Customer>('customers', id);
}

export async function updateCustomer(id: number, b: Body): Promise<Customer> {
  const c = await mustGet<Customer>('customers', id, 'Müşteri');
  if (c.anonymized_at) throw new HttpError(409, 'Anonimleştirilmiş kayıt düzenlenemez');
  required(b, REQUIRED);
  const data = customerData(b);
  if (data.national_id && await one('SELECT 1 FROM customers WHERE national_id = ? AND id <> ? AND anonymized_at IS NULL', data.national_id, id)) {
    throw new HttpError(409, 'Bu T.C. kimlik numarası ile kayıtlı başka müşteri var');
  }
  await updateRow('customers', id, data);
  await audit('customer.update', 'customer', id, { blacklisted: data.blacklisted, risk_score: data.risk_score });
  return mustGet<Customer>('customers', id);
}

export async function deleteCustomer(id: number) {
  await mustGet('customers', id, 'Müşteri');
  const used =
    await one('SELECT 1 FROM rentals WHERE customer_id = ? LIMIT 1', id) ||
    await one('SELECT 1 FROM reservations WHERE customer_id = ? LIMIT 1', id) ||
    await one('SELECT 1 FROM payments WHERE customer_id = ? LIMIT 1', id);
  if (used) throw new HttpError(409, 'İşlem geçmişi olan müşteri silinemez; KVKK talebi için anonimleştirme kullanın');
  await tx(async () => {
    await run('DELETE FROM consents WHERE customer_id = ?', id);
    await run('DELETE FROM drivers WHERE customer_id = ?', id);
    await run('DELETE FROM customers WHERE id = ?', id);
  });
  await audit('customer.delete', 'customer', id);
  return { ok: true };
}

// ----- Ek sürücüler -----

export async function saveDriver(customerId: number, driverId: number | null, b: Body): Promise<Driver> {
  await mustGet('customers', customerId, 'Müşteri');
  required(b, [['first_name', 'Ad'], ['last_name', 'Soyad'], ['license_no', 'Ehliyet no']]);
  const nid = str(b.national_id);
  if (nid && !validTckn(nid)) throw new HttpError(400, 'T.C. kimlik numarası geçersiz');
  const data = {
    customer_id: customerId, first_name: str(b.first_name), last_name: str(b.last_name), national_id: nid,
    birth_date: normDate(b.birth_date, 'Doğum tarihi', true), phone: str(b.phone), license_no: str(b.license_no),
    license_class: str(b.license_class), license_date: normDate(b.license_date, 'Ehliyet tarihi', true),
    license_expiry: normDate(b.license_expiry, 'Ehliyet geçerlilik', true),
  };
  if (driverId) {
    const d = await mustGet<Driver>('drivers', driverId, 'Sürücü');
    if (d.customer_id !== customerId) throw new HttpError(404, 'Sürücü bulunamadı');
    await updateRow('drivers', driverId, data);
  } else driverId = await insertRow('drivers', data);
  await audit('customer.driver', 'customer', customerId, { driver_id: driverId });
  return mustGet<Driver>('drivers', driverId);
}

export async function deleteDriver(customerId: number, driverId: number) {
  if (await one('SELECT 1 FROM rental_drivers WHERE driver_id = ?', driverId)) throw new HttpError(409, 'Sözleşmede kayıtlı sürücü silinemez');
  await run('DELETE FROM drivers WHERE id = ? AND customer_id = ?', driverId, customerId);
  return { ok: true };
}

// ----- KVKK -----

export async function recordConsent(customerId: number, type: string, granted: unknown, channel: string | null, user?: SessionUser) {
  if (!CONSENT_TYPES[type]) throw new HttpError(400, 'Rıza tipi geçersiz');
  const ctx = getContext();
  await insertRow('consents', {
    customer_id: customerId, type, granted: bool(granted), channel, text_version: 'v1', ip: ctx.ip, recorded_by: user?.id ?? ctx.user?.id ?? null,
  });
  await audit('consent.record', 'customer', customerId, { type, granted: bool(granted), channel });
}

/** Güncel rıza durumu (her tip için son kayıt). */
export async function consentState(customerId: number): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const type of Object.keys(CONSENT_TYPES)) {
    out[type] = !!(await one<{ granted: number }>('SELECT granted FROM consents WHERE customer_id = ? AND type = ? ORDER BY id DESC LIMIT 1', customerId, type))?.granted;
  }
  return out;
}

/** KVKK veri ihracı: müşteriye ait tüm kişisel veriler (JSON). */
export async function exportCustomerData(id: number) {
  const c = await getCustomer(id);
  await audit('pii.export', 'customer', id);
  return {
    exported_at: new Date().toISOString(),
    customer: Object.fromEntries(Object.entries(c).filter(([k]) => !['rentals', 'reservations', 'payments', 'documents', 'issues', 'warnings'].includes(k))),
    drivers: c.drivers,
    consents: c.consents,
    reservations: c.reservations,
    rentals: c.rentals,
    payments: c.payments,
    documents: c.documents.map((d) => ({ id: d.id, name: d.original_name, sha256: d.sha256, created_at: d.created_at })),
    messages: await all('SELECT channel, to_address, subject, status, created_at FROM message_log WHERE customer_id = ?', id),
    access_log: await all("SELECT action, created_at, ip FROM audit_log WHERE entity = 'customer' AND entity_id = ? ORDER BY id", id),
  };
}

/**
 * KVKK silme talebi: yasal saklama yükümlülüğü olan işlem kayıtları (sözleşme, ödeme, fatura) korunur,
 * kişiyi tanımlayan alanlar maskelenir ve belge görselleri geçersiz kılınır.
 */
export async function anonymizeCustomer(id: number, reason: unknown) {
  const c = await mustGet<Customer>('customers', id, 'Müşteri');
  if (c.anonymized_at) return c;
  if (await one("SELECT 1 FROM rentals WHERE customer_id = ? AND status IN ('draft','active')", id)) throw new HttpError(409, 'Aktif sözleşmesi olan müşteri anonimleştirilemez');
  await tx(async () => {
    await updateRow('customers', id, {
      first_name: 'Anonim', last_name: `#${id}`, company_name: null, national_id: null, passport_no: null, birth_date: null,
      phone: '-', email: null, address: null, license_no: null, license_date: null, license_expiry: null, invoice_title: null,
      invoice_address: null, notes: null, risk_note: null, anonymized_at: nowLocal(),
    });
    await run(`UPDATE drivers SET first_name = 'Anonim', last_name = '', national_id = NULL, birth_date = NULL, phone = NULL, license_no = NULL WHERE customer_id = ?`, id);
    await run("UPDATE message_log SET to_address = NULL, body = '[anonimleştirildi]' WHERE customer_id = ?", id);
    for (const f of await listFiles('customer', id)) await voidFile(f.id, 'KVKK anonimleştirme');
  });
  await audit('pii.anonymize', 'customer', id, { reason });
  return mustGet<Customer>('customers', id);
}
