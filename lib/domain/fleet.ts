import { all, insertRow, one, run, scalar, updateRow } from '../db';
import { HttpError, bool, mustGet, normDate, normDateTime, nowLocal, num, oneOf, required, round2, str } from '../core';
import { calcQuote, customerIssues, findConflicts, paymentTotals } from '../rules';
import type {
  Body, Conflict, Customer, CustomerListItem, Damage, Expense, Maintenance, Payment, Quote, ReservationStatus, RentalStatus,
  Vehicle, VehicleListItem,
} from '../types';

export const CATEGORIES = ['Ekonomi', 'Orta', 'Üst', 'SUV', 'Minivan', 'Lüks', 'Ticari'] as const;
export const FUEL_TYPES = ['Benzin', 'Dizel', 'LPG', 'Hibrit', 'Elektrik'] as const;
export const TRANSMISSIONS = ['Manuel', 'Otomatik'] as const;

// ================= ARAÇLAR =================

const VEHICLE_LIST_SQL = `
  SELECT v.*, b.name AS branch_name,
    (SELECT contract_no FROM rentals WHERE vehicle_id = v.id AND status = 'active' LIMIT 1) AS active_contract,
    (SELECT planned_return_at FROM rentals WHERE vehicle_id = v.id AND status = 'active' LIMIT 1) AS active_return_at
  FROM vehicles v LEFT JOIN branches b ON b.id = v.branch_id`;

export interface VehicleFilters {
  q?: string;
  status?: string;
  category?: string;
  fuel_type?: string;
  transmission?: string;
  branch_id?: string;
}

export function listVehicles(f: VehicleFilters = {}): VehicleListItem[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const q = str(f.q);
  if (q) {
    where.push('(v.plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const k of ['status', 'category', 'fuel_type', 'transmission'] as const) {
    const v = str(f[k]);
    if (v) {
      where.push(`v.${k} = ?`);
      params.push(v);
    }
  }
  if (str(f.branch_id)) {
    where.push('v.branch_id = ?');
    params.push(num(f.branch_id));
  }
  return all<VehicleListItem>(`${VEHICLE_LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.plate`, ...params);
}

export interface AvailableVehicle extends VehicleListItem {
  available: boolean;
  conflicts: Conflict[];
  quote: Quote;
}

export function availableVehicles(q: Record<string, unknown>): AvailableVehicle[] {
  const from = normDateTime(q.pickup_at, 'Alış tarihi');
  const to = normDateTime(q.return_at, 'Dönüş tarihi');
  if (to <= from) throw new HttpError(400, 'Dönüş tarihi alış tarihinden sonra olmalıdır');
  const where = ["v.status <> 'out_of_service'"];
  const params: string[] = [];
  for (const k of ['category', 'transmission'] as const) {
    const v = str(q[k]);
    if (v) {
      where.push(`v.${k} = ?`);
      params.push(v);
    }
  }
  const excl = { excludeReservationId: num(q.exclude_reservation_id), excludeRentalId: num(q.exclude_rental_id) };
  const out: AvailableVehicle[] = [];
  for (const v of all<VehicleListItem>(`${VEHICLE_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY v.daily_rate, v.plate`, ...params)) {
    const conflicts = findConflicts(v.id, from, to, excl);
    if (conflicts.length && !q.include_unavailable) continue;
    out.push({ ...v, available: conflicts.length === 0, conflicts, quote: calcQuote({ vehicle: v, pickup_at: from, return_at: to }) });
  }
  return out;
}

export interface VehicleDetail extends VehicleListItem {
  rentals: { id: number; contract_no: string; pickup_at: string; planned_return_at: string; actual_return_at: string | null; status: RentalStatus; total_amount: number; start_km: number; end_km: number | null; customer_name: string }[];
  reservations: { id: number; code: string; pickup_at: string; return_at: string; status: ReservationStatus; total_amount: number; customer_name: string }[];
  maintenance: Maintenance[];
  damages: Damage[];
  expenses: Expense[];
  stats: { revenue: number; rented_days: number; costs: number; profit: number };
}

export function getVehicle(id: number): VehicleDetail {
  const v = one<VehicleListItem>(`${VEHICLE_LIST_SQL} WHERE v.id = ?`, id);
  if (!v) throw new HttpError(404, 'Araç bulunamadı');
  const income = one<{ t: number; d: number }>(
    `SELECT COALESCE(SUM(total_amount),0) AS t, COALESCE(SUM(days),0) AS d FROM rentals WHERE vehicle_id = ? AND status <> 'cancelled'`, id,
  )!;
  const costs =
    scalar<number>(`SELECT COALESCE(SUM(cost),0) FROM maintenance WHERE vehicle_id = ? AND status <> 'cancelled'`, id) +
    scalar<number>('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE vehicle_id = ?', id);
  return {
    ...v,
    rentals: all(
      `SELECT r.id, r.contract_no, r.pickup_at, r.planned_return_at, r.actual_return_at, r.status, r.total_amount,
              r.start_km, r.end_km, c.first_name || ' ' || c.last_name AS customer_name
       FROM rentals r JOIN customers c ON c.id = r.customer_id WHERE r.vehicle_id = ? ORDER BY r.pickup_at DESC`, id,
    ),
    reservations: all(
      `SELECT r.id, r.code, r.pickup_at, r.return_at, r.status, r.total_amount, c.first_name || ' ' || c.last_name AS customer_name
       FROM reservations r JOIN customers c ON c.id = r.customer_id
       WHERE r.vehicle_id = ? AND r.status IN ('pending','confirmed') ORDER BY r.pickup_at`, id,
    ),
    maintenance: all<Maintenance>('SELECT * FROM maintenance WHERE vehicle_id = ? ORDER BY start_date DESC', id),
    damages: all<Damage>('SELECT * FROM damages WHERE vehicle_id = ? ORDER BY reported_at DESC', id),
    expenses: all<Expense>('SELECT * FROM expenses WHERE vehicle_id = ? ORDER BY expense_date DESC', id),
    stats: { revenue: round2(income.t), rented_days: income.d, costs: round2(costs), profit: round2(income.t - costs) },
  };
}

function vehicleData(b: Body, partial = false) {
  const d: Record<string, string | number | null | undefined> = {
    plate: str(b.plate)?.toLocaleUpperCase('tr-TR').replace(/\s+/g, ' '),
    brand: str(b.brand),
    model: str(b.model),
    year: str(b.year) === null ? null : Math.floor(num(b.year)),
    category: oneOf(b.category, CATEGORIES, 'Kategori', 'Ekonomi'),
    fuel_type: oneOf(b.fuel_type, FUEL_TYPES, 'Yakıt tipi', 'Benzin'),
    transmission: oneOf(b.transmission, TRANSMISSIONS, 'Vites', 'Manuel'),
    seats: Math.floor(num(b.seats, 5)),
    color: str(b.color),
    vin: str(b.vin),
    daily_rate: Math.max(0, num(b.daily_rate)),
    deposit_amount: Math.max(0, num(b.deposit_amount)),
    current_km: Math.max(0, Math.floor(num(b.current_km))),
    km_limit_per_day: Math.max(0, Math.floor(num(b.km_limit_per_day))),
    extra_km_fee: Math.max(0, num(b.extra_km_fee)),
    branch_id: str(b.branch_id) === null ? null : num(b.branch_id),
    insurance_expiry: normDate(b.insurance_expiry, 'Trafik sigortası bitişi', true),
    kasko_expiry: normDate(b.kasko_expiry, 'Kasko bitişi', true),
    inspection_expiry: normDate(b.inspection_expiry, 'Muayene bitişi', true),
    next_service_km: str(b.next_service_km) === null ? null : Math.floor(num(b.next_service_km)),
    notes: str(b.notes),
  };
  if (partial) for (const k of Object.keys(d)) if (b[k] === undefined) delete d[k];
  return d;
}

export function createVehicle(b: Body): Vehicle {
  required(b, [['plate', 'Plaka'], ['brand', 'Marka'], ['model', 'Model'], ['daily_rate', 'Günlük fiyat']]);
  const data = vehicleData(b);
  if (one('SELECT 1 FROM vehicles WHERE plate = ?', data.plate!)) throw new HttpError(409, 'Bu plaka zaten kayıtlı');
  data.status = b.status === 'out_of_service' ? 'out_of_service' : 'available';
  return mustGet<Vehicle>('vehicles', insertRow('vehicles', data));
}

export function updateVehicle(id: number, b: Body): Vehicle {
  const v = mustGet<Vehicle>('vehicles', id, 'Araç');
  const data = vehicleData(b, true);
  if (data.plate && data.plate !== v.plate && one('SELECT 1 FROM vehicles WHERE plate = ? AND id <> ?', data.plate, id)) {
    throw new HttpError(409, 'Bu plaka zaten kayıtlı');
  }
  // Durum yalnızca müsait <-> hizmet dışı arasında elle değiştirilebilir.
  if (b.status && b.status !== v.status) {
    const manual = ['available', 'out_of_service'];
    if (!manual.includes(String(b.status)) || !manual.includes(v.status)) {
      throw new HttpError(400, 'Araç durumu kiralama/bakım işlemleriyle yönetilir; yalnızca "Müsait" ve "Hizmet dışı" arasında elle geçiş yapılabilir');
    }
    data.status = String(b.status);
  }
  updateRow('vehicles', id, data);
  return mustGet<Vehicle>('vehicles', id);
}

export function deleteVehicle(id: number) {
  mustGet('vehicles', id, 'Araç');
  if (one('SELECT 1 FROM rentals WHERE vehicle_id = ? LIMIT 1', id) || one('SELECT 1 FROM reservations WHERE vehicle_id = ? LIMIT 1', id)) {
    throw new HttpError(409, 'Kiralama/rezervasyon geçmişi olan araç silinemez; "Hizmet dışı" yapabilirsiniz');
  }
  run('DELETE FROM maintenance WHERE vehicle_id = ?', id);
  run('DELETE FROM damages WHERE vehicle_id = ?', id);
  run('UPDATE expenses SET vehicle_id = NULL WHERE vehicle_id = ?', id);
  run('DELETE FROM vehicles WHERE id = ?', id);
  return { ok: true };
}

// ================= MÜŞTERİLER =================

export function listCustomers(f: { q?: string; blacklisted?: string } = {}): CustomerListItem[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const q = str(f.q);
  if (q) {
    where.push(`(c.first_name || ' ' || c.last_name LIKE ? OR c.company_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?
                 OR c.national_id LIKE ? OR c.passport_no LIKE ? OR c.license_no LIKE ?)`);
    params.push(...Array(7).fill(`%${q}%`));
  }
  if (f.blacklisted !== undefined && f.blacklisted !== '') {
    where.push('c.blacklisted = ?');
    params.push(bool(f.blacklisted));
  }
  return all<CustomerListItem>(
    `SELECT c.*,
      (SELECT COUNT(*) FROM rentals WHERE customer_id = c.id AND status <> 'cancelled') AS rental_count,
      (SELECT COALESCE(SUM(total_amount),0) FROM rentals WHERE customer_id = c.id AND status <> 'cancelled') AS total_spent
     FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY c.first_name, c.last_name LIMIT 500`,
    ...params,
  );
}

export interface CustomerDetail extends Customer {
  rentals: { id: number; contract_no: string; pickup_at: string; planned_return_at: string; actual_return_at: string | null; status: RentalStatus; total_amount: number; plate: string; brand: string; model: string; paid: number; balance: number }[];
  reservations: { id: number; code: string; pickup_at: string; return_at: string; status: ReservationStatus; total_amount: number; plate: string; brand: string; model: string }[];
  payments: Payment[];
  balance: number;
  issues: string[];
}

export function getCustomer(id: number): CustomerDetail {
  const c = mustGet<Customer>('customers', id, 'Müşteri');
  const rentals = all<Omit<CustomerDetail['rentals'][number], 'paid' | 'balance'>>(
    `SELECT r.id, r.contract_no, r.pickup_at, r.planned_return_at, r.actual_return_at, r.status, r.total_amount, v.plate, v.brand, v.model
     FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.customer_id = ? ORDER BY r.pickup_at DESC`, id,
  ).map((r) => {
    const t = paymentTotals('rental_id', r.id);
    return { ...r, paid: t.paid, balance: r.status === 'cancelled' ? 0 : round2(r.total_amount - t.paid) };
  });
  return {
    ...c,
    rentals,
    reservations: all(
      `SELECT r.id, r.code, r.pickup_at, r.return_at, r.status, r.total_amount, v.plate, v.brand, v.model
       FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.customer_id = ? ORDER BY r.pickup_at DESC`, id,
    ),
    payments: all<Payment>('SELECT * FROM payments WHERE customer_id = ? ORDER BY paid_at DESC, id DESC', id),
    balance: round2(rentals.reduce((a, x) => a + x.balance, 0)),
    issues: customerIssues(c, nowLocal(), { strict: true }),
  };
}

function customerData(b: Body) {
  const email = str(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-posta adresi geçersiz');
  const nid = str(b.national_id);
  if (nid && !/^\d{11}$/.test(nid)) throw new HttpError(400, 'T.C. kimlik numarası 11 haneli olmalıdır');
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
    blacklisted: bool(b.blacklisted),
    blacklist_reason: str(b.blacklist_reason),
    notes: str(b.notes),
  };
}

const CUSTOMER_REQUIRED: [string, string][] = [['first_name', 'Ad'], ['last_name', 'Soyad'], ['phone', 'Telefon']];

export function createCustomer(b: Body): Customer {
  required(b, CUSTOMER_REQUIRED);
  const data = customerData(b);
  if (data.national_id && one('SELECT 1 FROM customers WHERE national_id = ?', data.national_id)) {
    throw new HttpError(409, 'Bu T.C. kimlik numarası ile kayıtlı müşteri var');
  }
  return mustGet<Customer>('customers', insertRow('customers', data));
}

export function updateCustomer(id: number, b: Body): Customer {
  mustGet('customers', id, 'Müşteri');
  required(b, CUSTOMER_REQUIRED);
  const data = customerData(b);
  if (data.national_id && one('SELECT 1 FROM customers WHERE national_id = ? AND id <> ?', data.national_id, id)) {
    throw new HttpError(409, 'Bu T.C. kimlik numarası ile kayıtlı başka müşteri var');
  }
  updateRow('customers', id, data);
  return mustGet<Customer>('customers', id);
}

export function deleteCustomer(id: number) {
  mustGet('customers', id, 'Müşteri');
  const used =
    one('SELECT 1 FROM rentals WHERE customer_id = ? LIMIT 1', id) ||
    one('SELECT 1 FROM reservations WHERE customer_id = ? LIMIT 1', id) ||
    one('SELECT 1 FROM payments WHERE customer_id = ? LIMIT 1', id);
  if (used) throw new HttpError(409, 'İşlem geçmişi olan müşteri silinemez');
  run('DELETE FROM customers WHERE id = ?', id);
  return { ok: true };
}
