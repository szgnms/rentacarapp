// Filo yönetimi: araç kartı, belge takibi, şube transferleri, amortisman ve satış.
import { all, insertRow, one, run, scalar, tx, updateRow } from '../db';
import { HttpError, addDays, fmtDate, mustGet, normDate, normDateTime, nowLocal, num, oneOf, optId, parseDate, required, round2, str, today } from '../core';
import { CATEGORIES, calcQuote, findConflicts } from '../rules';
import { audit } from '../audit';
import { scopedBranch } from '../permissions';
import type { Body, Conflict, Damage, Expense, Maintenance, Quote, ReservationStatus, RentalStatus, SessionUser, Vehicle, VehicleListItem } from '../types';

export { CATEGORIES };
export const FUEL_TYPES = ['Benzin', 'Dizel', 'LPG', 'Hibrit', 'Elektrik'] as const;
export const TRANSMISSIONS = ['Manuel', 'Otomatik'] as const;
export const FINANCING = ['cash', 'loan', 'leasing'] as const;

export const DOCUMENT_TYPES: Record<string, string> = {
  inspection: 'Muayene',
  traffic_insurance: 'Trafik sigortası',
  kasko: 'Kasko',
  exhaust: 'Egzoz emisyon',
  registration: 'Ruhsat',
  hgs: 'HGS etiketi',
  tire_change: 'Lastik değişimi / depo',
  mtv: 'MTV',
  other: 'Diğer',
};

// ================= ARAÇLAR =================

const VEHICLE_LIST_SQL = `
  SELECT v.*, b.name AS branch_name,
    (SELECT contract_no FROM rentals WHERE vehicle_id = v.id AND status IN ('active','draft') LIMIT 1) AS active_contract,
    (SELECT planned_return_at FROM rentals WHERE vehicle_id = v.id AND status IN ('active','draft') LIMIT 1) AS active_return_at
  FROM vehicles v LEFT JOIN branches b ON b.id = v.branch_id`;

export interface VehicleFilters {
  q?: string;
  status?: string;
  category?: string;
  fuel_type?: string;
  transmission?: string;
  branch_id?: string;
  include_sold?: string;
}

export function listVehicles(f: VehicleFilters = {}, user?: SessionUser): VehicleListItem[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const q = str(f.q);
  if (q) {
    where.push('(v.plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR v.vin LIKE ? OR v.hgs_tag_no LIKE ?)');
    params.push(...Array(5).fill(`%${q}%`));
  }
  for (const k of ['status', 'category', 'fuel_type', 'transmission'] as const) {
    const v = str(f[k]);
    if (v) {
      where.push(`v.${k} = ?`);
      params.push(v);
    }
  }
  if (!str(f.status) && f.include_sold !== '1') where.push("v.status <> 'sold'");
  const branch = str(f.branch_id) ? num(f.branch_id) : user ? scopedBranch(user) : null;
  if (branch) {
    where.push('v.branch_id = ?');
    params.push(branch);
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
  const where = ["v.status NOT IN ('out_of_service','sold','for_sale','damaged')"];
  const params: (string | number)[] = [];
  for (const k of ['category', 'transmission'] as const) {
    const v = str(q[k]);
    if (v) {
      where.push(`v.${k} = ?`);
      params.push(v);
    }
  }
  if (str(q.branch_id)) {
    where.push('v.branch_id = ?');
    params.push(num(q.branch_id));
  }
  const excl = { excludeReservationId: num(q.exclude_reservation_id), excludeRentalId: num(q.exclude_rental_id) };
  const out: AvailableVehicle[] = [];
  for (const v of all<VehicleListItem>(`${VEHICLE_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY v.daily_rate, v.plate`, ...params)) {
    const conflicts = findConflicts(v.id, from, to, excl);
    if (conflicts.length && !q.include_unavailable) continue;
    out.push({ ...v, available: conflicts.length === 0, conflicts, quote: calcQuote({ vehicle: v, pickup_at: from, return_at: to, channel: str(q.source) }) });
  }
  return out;
}

export interface VehicleDocument {
  id: number;
  vehicle_id: number;
  type: string;
  number: string | null;
  provider: string | null;
  issued_at: string | null;
  expires_at: string | null;
  cost: number;
  file_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface Transfer {
  id: number;
  vehicle_id: number;
  from_branch_id: number | null;
  to_branch_id: number;
  planned_at: string | null;
  departed_at: string | null;
  arrived_at: string | null;
  driver: string | null;
  km: number | null;
  cost: number;
  status: 'requested' | 'in_transit' | 'completed' | 'cancelled';
  notes: string | null;
  created_at: string;
}

export type TransferRow = Transfer & { plate: string; from_branch: string | null; to_branch: string };

export interface VehicleDetail extends VehicleListItem {
  rentals: { id: number; contract_no: string; pickup_at: string; planned_return_at: string; actual_return_at: string | null; status: RentalStatus; total_amount: number; start_km: number; end_km: number | null; customer_name: string }[];
  reservations: { id: number; code: string; pickup_at: string; return_at: string; status: ReservationStatus; total_amount: number; customer_name: string }[];
  maintenance: Maintenance[];
  damages: Damage[];
  expenses: Expense[];
  documents: VehicleDocument[];
  transfers: TransferRow[];
  tolls: { id: number; passed_at: string; location: string | null; amount: number; status: string; contract_no: string | null }[];
  fines: { id: number; violation_at: string; type: string; amount: number; status: string; contract_no: string | null }[];
  stats: { revenue: number; rented_days: number; costs: number; profit: number; utilization: number };
  depreciation: { monthly: number; book_value: number; months: number } | null;
}

export function depreciation(v: Pick<Vehicle, 'purchase_price' | 'purchase_date' | 'depreciation_years' | 'residual_value'>) {
  if (!v.purchase_price || !v.purchase_date || !v.depreciation_years) return null;
  const residual = v.residual_value ?? 0;
  const monthly = round2((v.purchase_price - residual) / (v.depreciation_years * 12));
  const start = parseDate(v.purchase_date)!;
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth());
  return { monthly, months, book_value: round2(Math.max(residual, v.purchase_price - monthly * months)) };
}

export function getVehicle(id: number): VehicleDetail {
  const v = one<VehicleListItem>(`${VEHICLE_LIST_SQL} WHERE v.id = ?`, id);
  if (!v) throw new HttpError(404, 'Araç bulunamadı');
  const income = one<{ t: number; d: number }>(
    `SELECT COALESCE(SUM(total_amount),0) AS t, COALESCE(SUM(days),0) AS d FROM rentals WHERE vehicle_id = ? AND status NOT IN ('cancelled','draft')`, id,
  )!;
  const dep = depreciation(v);
  const costs =
    scalar<number>(`SELECT COALESCE(SUM(cost),0) FROM maintenance WHERE vehicle_id = ? AND status <> 'cancelled'`, id) +
    scalar<number>('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE vehicle_id = ?', id) +
    scalar<number>('SELECT COALESCE(SUM(cost),0) FROM vehicle_documents WHERE vehicle_id = ?', id) +
    scalar<number>("SELECT COALESCE(SUM(cost),0) FROM vehicle_transfers WHERE vehicle_id = ? AND status <> 'cancelled'", id) +
    (dep ? dep.monthly * dep.months : 0);
  const ownedDays = Math.max(1, Math.round((Date.now() - (parseDate(v.purchase_date ?? v.created_at)?.getTime() ?? Date.now())) / 86400000));
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
    documents: all<VehicleDocument>('SELECT * FROM vehicle_documents WHERE vehicle_id = ? ORDER BY expires_at DESC, id DESC', id),
    transfers: listTransfers({ vehicle_id: String(id) }),
    tolls: all(
      `SELECT t.id, t.passed_at, t.location, t.amount, t.status, r.contract_no FROM toll_transactions t LEFT JOIN rentals r ON r.id = t.rental_id
       WHERE t.vehicle_id = ? ORDER BY t.passed_at DESC LIMIT 100`, id,
    ),
    fines: all(
      `SELECT f.id, f.violation_at, f.type, f.amount, f.status, r.contract_no FROM traffic_fines f LEFT JOIN rentals r ON r.id = f.rental_id
       WHERE f.vehicle_id = ? ORDER BY f.violation_at DESC`, id,
    ),
    stats: {
      revenue: round2(income.t), rented_days: income.d, costs: round2(costs), profit: round2(income.t - costs + (v.sale_price ?? 0) - (v.sold_at ? (v.purchase_price ?? 0) - (dep ? dep.monthly * dep.months : 0) : 0)),
      utilization: Math.min(100, Math.round((income.d / ownedDays) * 100)),
    },
    depreciation: dep,
  };
}

function vehicleData(b: Body, partial = false) {
  const d: Record<string, string | number | null | undefined> = {
    plate: str(b.plate)?.toLocaleUpperCase('tr-TR').replace(/\s+/g, ' '),
    brand: str(b.brand),
    model: str(b.model),
    trim: str(b.trim),
    year: str(b.year) === null ? null : Math.floor(num(b.year)),
    category: oneOf(b.category, CATEGORIES, 'Kategori', 'Ekonomi'),
    acriss: str(b.acriss)?.toUpperCase().slice(0, 4) ?? null,
    fuel_type: oneOf(b.fuel_type, FUEL_TYPES, 'Yakıt tipi', 'Benzin'),
    transmission: oneOf(b.transmission, TRANSMISSIONS, 'Vites', 'Manuel'),
    seats: Math.floor(num(b.seats, 5)),
    luggage: str(b.luggage) === null ? null : Math.floor(num(b.luggage)),
    color: str(b.color),
    vin: str(b.vin)?.toUpperCase() ?? null,
    engine_no: str(b.engine_no),
    daily_rate: Math.max(0, num(b.daily_rate)),
    deposit_amount: Math.max(0, num(b.deposit_amount)),
    current_km: Math.max(0, Math.floor(num(b.current_km))),
    km_limit_per_day: Math.max(0, Math.floor(num(b.km_limit_per_day))),
    extra_km_fee: Math.max(0, num(b.extra_km_fee)),
    fuel_capacity: Math.max(1, num(b.fuel_capacity, 50)),
    branch_id: optId(b.branch_id),
    parking_spot: str(b.parking_spot),
    hgs_tag_no: str(b.hgs_tag_no),
    next_service_km: str(b.next_service_km) === null ? null : Math.floor(num(b.next_service_km)),
    next_service_date: normDate(b.next_service_date, 'Sonraki bakım tarihi', true),
    purchase_date: normDate(b.purchase_date, 'Alış tarihi', true),
    purchase_price: str(b.purchase_price) === null ? null : num(b.purchase_price),
    financing: str(b.financing) === null ? null : oneOf(b.financing, FINANCING, 'Finansman'),
    monthly_installment: str(b.monthly_installment) === null ? null : num(b.monthly_installment),
    depreciation_years: str(b.depreciation_years) === null ? null : num(b.depreciation_years),
    residual_value: str(b.residual_value) === null ? null : num(b.residual_value),
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
  const id = insertRow('vehicles', data);
  // Hızlı belge girişi (eski alanlarla uyumluluk)
  for (const [key, type] of [['insurance_expiry', 'traffic_insurance'], ['kasko_expiry', 'kasko'], ['inspection_expiry', 'inspection']] as const) {
    const date = normDate(b[key], 'Belge tarihi', true);
    if (date) insertRow('vehicle_documents', { vehicle_id: id, type, expires_at: date });
  }
  audit('vehicle.create', 'vehicle', id, { plate: data.plate });
  return mustGet<Vehicle>('vehicles', id);
}

/** Elle geçilebilen durumlar; kirada/serviste/transferde durumları süreçlerle yönetilir. */
const MANUAL_STATUS = ['available', 'out_of_service', 'damaged', 'for_sale'];

export function updateVehicle(id: number, b: Body): Vehicle {
  const v = mustGet<Vehicle>('vehicles', id, 'Araç');
  const data = vehicleData(b, true);
  if (data.plate && data.plate !== v.plate && one('SELECT 1 FROM vehicles WHERE plate = ? AND id <> ?', data.plate, id)) {
    throw new HttpError(409, 'Bu plaka zaten kayıtlı');
  }
  if (b.status && b.status !== v.status) {
    if (!MANUAL_STATUS.includes(String(b.status)) || !MANUAL_STATUS.includes(v.status)) {
      throw new HttpError(400, 'Bu durum geçişi kiralama/bakım/transfer süreçleriyle yönetilir');
    }
    data.status = String(b.status);
  }
  updateRow('vehicles', id, data);
  audit('vehicle.update', 'vehicle', id, { fields: Object.keys(data) });
  return mustGet<Vehicle>('vehicles', id);
}

export function sellVehicle(id: number, b: Body): Vehicle {
  const v = mustGet<Vehicle>('vehicles', id, 'Araç');
  if (['rented', 'in_transfer'].includes(v.status)) throw new HttpError(409, 'Kirada/transferdeki araç satılamaz');
  if (one("SELECT 1 FROM reservations WHERE vehicle_id = ? AND status IN ('pending','confirmed')", id)) {
    throw new HttpError(409, 'Araca atanmış açık rezervasyonlar var; önce başka araca atayın');
  }
  updateRow('vehicles', id, { status: 'sold', sold_at: normDate(b.sold_at || today(), 'Satış tarihi'), sale_price: num(b.sale_price) });
  audit('vehicle.sell', 'vehicle', id, { price: b.sale_price });
  return mustGet<Vehicle>('vehicles', id);
}

export function deleteVehicle(id: number) {
  mustGet('vehicles', id, 'Araç');
  if (one('SELECT 1 FROM rentals WHERE vehicle_id = ? LIMIT 1', id) || one('SELECT 1 FROM reservations WHERE vehicle_id = ? LIMIT 1', id)) {
    throw new HttpError(409, 'Kiralama/rezervasyon geçmişi olan araç silinemez; "Hizmet dışı" veya "Satıldı" yapabilirsiniz');
  }
  tx(() => {
    for (const t of ['maintenance', 'damages', 'vehicle_documents', 'vehicle_transfers']) run(`DELETE FROM ${t} WHERE vehicle_id = ?`, id);
    run('UPDATE expenses SET vehicle_id = NULL WHERE vehicle_id = ?', id);
    run('DELETE FROM vehicles WHERE id = ?', id);
  });
  audit('vehicle.delete', 'vehicle', id);
  return { ok: true };
}

// ----- Belgeler -----

function documentData(b: Body) {
  return {
    vehicle_id: num(b.vehicle_id),
    type: oneOf(b.type, Object.keys(DOCUMENT_TYPES), 'Belge tipi', 'other'),
    number: str(b.number),
    provider: str(b.provider),
    issued_at: normDate(b.issued_at, 'Başlangıç', true),
    expires_at: normDate(b.expires_at, 'Bitiş', true),
    cost: Math.max(0, num(b.cost)),
    file_id: optId(b.file_id),
    notes: str(b.notes),
  };
}

export function saveDocument(id: number | null, b: Body): VehicleDocument {
  const data = documentData(id ? { ...mustGet<VehicleDocument>('vehicle_documents', id, 'Belge'), ...b } : b);
  mustGet('vehicles', data.vehicle_id, 'Araç');
  if (id) updateRow('vehicle_documents', id, data);
  else id = insertRow('vehicle_documents', data);
  syncDocumentColumns(data.vehicle_id);
  audit('vehicle.document', 'vehicle', data.vehicle_id, { type: data.type, expires_at: data.expires_at });
  return one<VehicleDocument>('SELECT * FROM vehicle_documents WHERE id = ?', id)!;
}

export function deleteDocument(id: number) {
  const d = one<VehicleDocument>('SELECT * FROM vehicle_documents WHERE id = ?', id);
  if (!d) throw new HttpError(404, 'Belge bulunamadı');
  run('DELETE FROM vehicle_documents WHERE id = ?', id);
  syncDocumentColumns(d.vehicle_id);
  return { ok: true };
}

/** Hızlı görünüm için araç kartındaki son geçerlilik tarihlerini günceller. */
function syncDocumentColumns(vehicleId: number) {
  const latest = (type: string) => one<{ e: string | null }>('SELECT MAX(expires_at) e FROM vehicle_documents WHERE vehicle_id = ? AND type = ?', vehicleId, type)?.e ?? null;
  run('UPDATE vehicles SET insurance_expiry = ?, kasko_expiry = ?, inspection_expiry = ? WHERE id = ?',
    latest('traffic_insurance'), latest('kasko'), latest('inspection'), vehicleId);
}

/** Her araç ve belge tipi için en güncel belge; süresi dolan / 30 gün içinde dolacaklar. */
export function expiringDocuments(days = 30) {
  const limit = fmtDate(addDays(new Date(), days));
  return all<{ vehicle_id: number; plate: string; type: string; expires_at: string }>(
    `SELECT d.vehicle_id, v.plate, d.type, MAX(d.expires_at) AS expires_at FROM vehicle_documents d JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.expires_at IS NOT NULL AND v.status NOT IN ('sold','out_of_service') GROUP BY d.vehicle_id, d.type HAVING MAX(d.expires_at) <= ?
     ORDER BY expires_at`, limit,
  );
}

// ----- Şube transferleri -----

export function listTransfers(f: { status?: string; vehicle_id?: string } = {}): TransferRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.status)) { where.push('t.status = ?'); params.push(str(f.status)!); }
  if (str(f.vehicle_id)) { where.push('t.vehicle_id = ?'); params.push(num(f.vehicle_id)); }
  return all<TransferRow>(
    `SELECT t.*, v.plate, fb.name AS from_branch, tb.name AS to_branch FROM vehicle_transfers t JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN branches fb ON fb.id = t.from_branch_id JOIN branches tb ON tb.id = t.to_branch_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 300`,
    ...params,
  );
}

export function createTransfer(b: Body, user: SessionUser): Transfer {
  required(b, [['vehicle_id', 'Araç'], ['to_branch_id', 'Hedef şube']]);
  const v = mustGet<Vehicle>('vehicles', num(b.vehicle_id), 'Araç');
  if (v.branch_id === num(b.to_branch_id)) throw new HttpError(400, 'Araç zaten bu şubede');
  if (one("SELECT 1 FROM vehicle_transfers WHERE vehicle_id = ? AND status IN ('requested','in_transit')", v.id)) throw new HttpError(409, 'Araç için açık transfer emri var');
  const id = insertRow('vehicle_transfers', {
    vehicle_id: v.id, from_branch_id: v.branch_id, to_branch_id: num(b.to_branch_id), planned_at: str(b.planned_at) ? normDateTime(b.planned_at) : nowLocal(),
    driver: str(b.driver), cost: Math.max(0, num(b.cost)), notes: str(b.notes), created_by: user.id,
  });
  audit('transfer.create', 'vehicle', v.id, { transfer_id: id, to: b.to_branch_id });
  return one<Transfer>('SELECT * FROM vehicle_transfers WHERE id = ?', id)!;
}

export function advanceTransfer(id: number, action: 'depart' | 'arrive' | 'cancel', b: Body): Transfer {
  const t = one<Transfer>('SELECT * FROM vehicle_transfers WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'Transfer bulunamadı');
  const v = mustGet<Vehicle>('vehicles', t.vehicle_id);
  tx(() => {
    if (action === 'depart') {
      if (t.status !== 'requested') throw new HttpError(409, 'Transfer başlatılamaz');
      if (v.status !== 'available') throw new HttpError(409, 'Araç müsait değil');
      updateRow('vehicle_transfers', id, { status: 'in_transit', departed_at: nowLocal(), driver: str(b.driver) ?? t.driver });
      run("UPDATE vehicles SET status = 'in_transfer' WHERE id = ?", v.id);
    } else if (action === 'arrive') {
      if (t.status !== 'in_transit') throw new HttpError(409, 'Transfer yolda değil');
      const km = str(b.km) === null ? v.current_km : Math.max(v.current_km, Math.floor(num(b.km)));
      updateRow('vehicle_transfers', id, { status: 'completed', arrived_at: nowLocal(), km: km - v.current_km, cost: str(b.cost) === null ? t.cost : num(b.cost) });
      run("UPDATE vehicles SET status = 'available', branch_id = ?, current_km = ? WHERE id = ?", t.to_branch_id, km, v.id);
    } else {
      if (t.status === 'completed') throw new HttpError(409, 'Tamamlanmış transfer iptal edilemez');
      updateRow('vehicle_transfers', id, { status: 'cancelled' });
      if (v.status === 'in_transfer') run("UPDATE vehicles SET status = 'available' WHERE id = ?", v.id);
    }
    audit(`transfer.${action}`, 'vehicle', v.id, { transfer_id: id });
  });
  return one<Transfer>('SELECT * FROM vehicle_transfers WHERE id = ?', id)!;
}

/** HGS etiket bakiyesi yükleme (masraf olarak kaydedilir). */
export function topUpHgs(vehicleId: number, amount: unknown, user: SessionUser): Vehicle {
  const a = round2(num(amount));
  if (!(a > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalıdır');
  const v = mustGet<Vehicle>('vehicles', vehicleId, 'Araç');
  tx(() => {
    run('UPDATE vehicles SET hgs_balance = hgs_balance + ? WHERE id = ?', a, v.id);
    insertRow('expenses', { vehicle_id: v.id, category: 'HGS yükleme', amount: a, expense_date: today(), description: `HGS ${v.hgs_tag_no ?? ''} bakiye yükleme`, created_by: user.id });
  });
  audit('vehicle.hgs_topup', 'vehicle', v.id, { amount: a });
  return mustGet<Vehicle>('vehicles', v.id);
}
