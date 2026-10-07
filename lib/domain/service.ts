import { all, insertRow, one, run, scalar, tx, updateRow } from '../db';
import { HttpError, bool, mustGet, normDate, num, oneOf, optId, required, round2, str, today } from '../core';
import type { Body, Damage, Expense, Maintenance, MaintenanceStatus, MaintenanceType, Rental, SessionUser, Vehicle } from '../types';

// ================= BAKIM =================

export const MAINT_TYPES = ['periodic', 'repair', 'tire', 'inspection', 'damage_repair', 'other'] as const satisfies readonly MaintenanceType[];
export const MAINT_STATUS = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const satisfies readonly MaintenanceStatus[];

export type MaintenanceRow = Maintenance & { plate: string; brand: string; model: string };

export function listMaintenance(f: { status?: string; vehicle_id?: string } = {}): MaintenanceRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.status)) {
    where.push('m.status = ?');
    params.push(str(f.status)!);
  }
  if (str(f.vehicle_id)) {
    where.push('m.vehicle_id = ?');
    params.push(num(f.vehicle_id));
  }
  return all<MaintenanceRow>(
    `SELECT m.*, v.plate, v.brand, v.model FROM maintenance m JOIN vehicles v ON v.id = m.vehicle_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.start_date DESC, m.id DESC`,
    ...params,
  );
}

/** Devam eden bakım kaydına göre araç durumunu senkronize eder. */
function syncVehicleStatus(vehicleId: number) {
  const v = one<{ status: string }>('SELECT status FROM vehicles WHERE id = ?', vehicleId);
  if (!v || !['available', 'maintenance', 'damaged'].includes(v.status)) return;
  const open = one("SELECT 1 FROM maintenance WHERE vehicle_id = ? AND status = 'in_progress' LIMIT 1", vehicleId);
  // Hasarlı araç servise girince "serviste", servis bitince "müsait" olur; açık servis yoksa hasarlı durumu korunur.
  if (open) run("UPDATE vehicles SET status = 'maintenance' WHERE id = ?", vehicleId);
  else if (v.status === 'maintenance') run("UPDATE vehicles SET status = 'available' WHERE id = ?", vehicleId);
}

function maintData(b: Body) {
  const d = {
    vehicle_id: num(b.vehicle_id),
    type: oneOf(b.type, MAINT_TYPES, 'Bakım tipi', 'periodic'),
    description: str(b.description),
    start_date: normDate(b.start_date || today(), 'Başlangıç tarihi'),
    end_date: normDate(b.end_date, 'Bitiş tarihi', true),
    km: str(b.km) === null ? null : Math.floor(num(b.km)),
    cost: round2(Math.max(0, num(b.cost))),
    vendor: str(b.vendor),
    status: oneOf(b.status, MAINT_STATUS, 'Durum', 'scheduled'),
  };
  if (d.end_date && d.end_date < d.start_date) throw new HttpError(400, 'Bitiş tarihi başlangıçtan önce olamaz');
  return d;
}

function checkInProgress(d: { status: string; vehicle_id: number }) {
  if (d.status !== 'in_progress') return;
  const v = mustGet<Vehicle>('vehicles', d.vehicle_id, 'Araç');
  if (v.status === 'rented') throw new HttpError(409, 'Araç kirada; iade alınmadan bakıma alınamaz');
}

export function createMaintenance(b: Body): Maintenance {
  required(b, [['vehicle_id', 'Araç']]);
  const id = tx(() => {
    const d = maintData(b);
    mustGet('vehicles', d.vehicle_id, 'Araç');
    checkInProgress(d);
    const newId = insertRow('maintenance', d);
    syncVehicleStatus(d.vehicle_id);
    return newId;
  });
  return mustGet<Maintenance>('maintenance', id);
}

export function updateMaintenance(id: number, b: Body): Maintenance {
  tx(() => {
    const old = mustGet<Maintenance>('maintenance', id, 'Bakım kaydı');
    const d = maintData({ ...old, ...b });
    if (d.status !== old.status) checkInProgress(d);
    if (d.status === 'completed' && !d.end_date) d.end_date = today();
    updateRow('maintenance', id, d);
    syncVehicleStatus(old.vehicle_id);
    if (d.vehicle_id !== old.vehicle_id) syncVehicleStatus(d.vehicle_id);
    if (d.status === 'completed' && d.km) run('UPDATE vehicles SET current_km = MAX(current_km, ?) WHERE id = ?', d.km, d.vehicle_id);
  });
  return mustGet<Maintenance>('maintenance', id);
}

export function deleteMaintenance(id: number) {
  const m = mustGet<Maintenance>('maintenance', id, 'Bakım kaydı');
  tx(() => {
    run('DELETE FROM maintenance WHERE id = ?', id);
    syncVehicleStatus(m.vehicle_id);
  });
  return { ok: true };
}

// ================= HASARLAR =================

export type DamageRow = Damage & { plate: string; brand: string; model: string; contract_no: string | null; customer_name: string | null };

export function listDamages(f: { status?: string; vehicle_id?: string } = {}): DamageRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.status)) {
    where.push('d.status = ?');
    params.push(str(f.status)!);
  }
  if (str(f.vehicle_id)) {
    where.push('d.vehicle_id = ?');
    params.push(num(f.vehicle_id));
  }
  return all<DamageRow>(
    `SELECT d.*, v.plate, v.brand, v.model, r.contract_no, c.first_name || ' ' || c.last_name AS customer_name
     FROM damages d JOIN vehicles v ON v.id = d.vehicle_id
     LEFT JOIN rentals r ON r.id = d.rental_id LEFT JOIN customers c ON c.id = r.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.reported_at DESC, d.id DESC`,
    ...params,
  );
}

function damageData(b: Body) {
  return {
    vehicle_id: num(b.vehicle_id),
    rental_id: optId(b.rental_id),
    reported_at: normDate(b.reported_at || today(), 'Tarih'),
    location: str(b.location),
    description: str(b.description),
    severity: oneOf(b.severity, ['minor', 'moderate', 'major'] as const, 'Önem', 'minor'),
    repair_cost: round2(Math.max(0, num(b.repair_cost))),
    customer_charge: round2(Math.max(0, num(b.customer_charge))),
    insurance_claim: bool(b.insurance_claim),
    status: oneOf(b.status, ['open', 'repaired', 'closed'] as const, 'Durum', 'open'),
  };
}

export function createDamage(b: Body): Damage {
  required(b, [['vehicle_id', 'Araç'], ['description', 'Açıklama']]);
  const d = damageData(b);
  mustGet('vehicles', d.vehicle_id, 'Araç');
  if (d.rental_id && mustGet<Rental>('rentals', d.rental_id, 'Kiralama').vehicle_id !== d.vehicle_id) {
    throw new HttpError(400, 'Kiralama bu araca ait değil');
  }
  return mustGet<Damage>('damages', insertRow('damages', d));
}

export function updateDamage(id: number, b: Body): Damage {
  const old = mustGet<Damage>('damages', id, 'Hasar kaydı');
  updateRow('damages', id, damageData({ ...old, ...b }));
  return mustGet<Damage>('damages', id);
}

export function deleteDamage(id: number) {
  mustGet('damages', id, 'Hasar kaydı');
  run('DELETE FROM damages WHERE id = ?', id);
  return { ok: true };
}

// ================= MASRAFLAR =================

export const EXPENSE_CATEGORIES = [
  'Yakıt', 'Yıkama/Temizlik', 'Vergi (MTV)', 'Sigorta', 'Kasko', 'Muayene', 'Otopark', 'Personel', 'Kira', 'Transfer', 'HGS yükleme',
  'Trafik cezası', 'Çekici / yol yardım', 'Kredi / leasing taksiti', 'Diğer',
] as const;

export type ExpenseRow = Expense & { plate: string | null };

export function listExpenses(f: { from?: string; to?: string; category?: string; vehicle_id?: string } = {}): ExpenseRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.from)) {
    where.push('e.expense_date >= ?');
    params.push(str(f.from)!);
  }
  if (str(f.to)) {
    where.push('e.expense_date <= ?');
    params.push(str(f.to)!);
  }
  if (str(f.category)) {
    where.push('e.category = ?');
    params.push(str(f.category)!);
  }
  if (str(f.vehicle_id)) {
    where.push('e.vehicle_id = ?');
    params.push(num(f.vehicle_id));
  }
  return all<ExpenseRow>(
    `SELECT e.*, v.plate FROM expenses e LEFT JOIN vehicles v ON v.id = e.vehicle_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.expense_date DESC, e.id DESC`,
    ...params,
  );
}

function expenseData(b: Body) {
  return {
    vehicle_id: optId(b.vehicle_id),
    category: oneOf(b.category, EXPENSE_CATEGORIES, 'Kategori', 'Diğer'),
    amount: round2(Math.max(0, num(b.amount))),
    expense_date: normDate(b.expense_date || today(), 'Tarih'),
    description: str(b.description),
  };
}

export function createExpense(b: Body, user: SessionUser): Expense {
  required(b, [['amount', 'Tutar']]);
  return mustGet<Expense>('expenses', insertRow('expenses', { ...expenseData(b), created_by: user.id }));
}

export function updateExpense(id: number, b: Body): Expense {
  const old = mustGet<Expense>('expenses', id, 'Masraf');
  updateRow('expenses', id, expenseData({ ...old, ...b }));
  return mustGet<Expense>('expenses', id);
}

export function deleteExpense(id: number) {
  mustGet('expenses', id, 'Masraf');
  run('DELETE FROM expenses WHERE id = ?', id);
  return { ok: true };
}

export const totalCosts = (from: string, to: string, vehicleId?: number) =>
  round2(
    scalar<number>(`SELECT COALESCE(SUM(amount),0) FROM expenses WHERE expense_date BETWEEN ? AND ?${vehicleId ? ' AND vehicle_id = ?' : ''}`,
      ...(vehicleId ? [from, to, vehicleId] : [from, to])) +
      scalar<number>(
        `SELECT COALESCE(SUM(cost),0) FROM maintenance WHERE status <> 'cancelled' AND start_date BETWEEN ? AND ?${vehicleId ? ' AND vehicle_id = ?' : ''}`,
        ...(vehicleId ? [from, to, vehicleId] : [from, to]),
      ),
  );
