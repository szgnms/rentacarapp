// İş kuralları: gün/fiyat hesabı, müsaitlik, müşteri uygunluğu, finans ve iade hesabı.
import { all, getSettings, one, run, scalar } from './db';
import { HttpError, num, nowLocal, normDateTime, parseDate, round2, yearsBetween } from './core';
import type {
  ChargeType, Conflict, Customer, Extra, Finance, LineItem, Quote, Rental, RentalFinance, Severity, Vehicle,
} from './types';

export const CHARGE_TYPES: readonly ChargeType[] = ['late_return', 'extra_km', 'fuel', 'damage', 'cleaning', 'traffic_fine', 'hgs', 'other'];

/** Kiralama gün sayısı: 24 saatlik bloklar, tolerans (grace) saatini aşan kısım yeni gün sayılır. */
export function calcDays(from: string, to: string, graceHours: number | string = 0): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) throw new HttpError(400, 'Tarih geçersiz');
  const hours = (b.getTime() - a.getTime()) / 3600000;
  if (hours <= 0) throw new HttpError(400, 'Dönüş tarihi alış tarihinden sonra olmalıdır');
  let days = Math.floor(hours / 24 + 1e-9);
  const rest = hours - days * 24;
  if (rest > num(graceHours) + 1e-9) days += 1;
  return Math.max(1, days);
}

export interface ExtraSelection {
  extra_id: number;
  quantity: number;
}

export function parseExtras(list: unknown): ExtraSelection[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && num(x.extra_id) > 0 && num(x.quantity, 1) > 0)
    .map((x) => ({ extra_id: num(x.extra_id), quantity: Math.floor(num(x.quantity, 1)) }));
}

export interface QuoteInput {
  vehicle: Pick<Vehicle, 'daily_rate' | 'deposit_amount'>;
  pickup_at: string;
  return_at: string;
  extras?: ExtraSelection[];
  discount?: unknown;
  daily_rate?: unknown;
  pickup_branch_id?: number | null;
  return_branch_id?: number | null;
}

export function calcQuote(p: QuoteInput): Quote {
  const s = getSettings();
  const days = calcDays(p.pickup_at, p.return_at, s.grace_hours);
  const dailyRate = p.daily_rate !== undefined && p.daily_rate !== null && p.daily_rate !== '' ? num(p.daily_rate) : num(p.vehicle.daily_rate);
  if (dailyRate < 0) throw new HttpError(400, 'Günlük fiyat negatif olamaz');

  const base = round2(dailyRate * days);
  const pct = days >= 30 ? num(s.monthly_discount_pct) : days >= 7 ? num(s.weekly_discount_pct) : 0;
  const longTerm = round2((base * pct) / 100);

  const lines: LineItem[] = [];
  for (const item of p.extras || []) {
    const qty = Math.max(1, Math.floor(num(item.quantity, 1)));
    const extra = one<Extra>('SELECT * FROM extras WHERE id = ?', num(item.extra_id));
    if (!extra) throw new HttpError(400, 'Ek hizmet bulunamadı');
    let unit = extra.price_type === 'daily' ? extra.price * days : extra.price;
    if (extra.max_price) unit = Math.min(unit, extra.max_price);
    lines.push({ extra_id: extra.id, name: extra.name, quantity: qty, amount: round2(unit * qty) });
  }
  const extrasAmount = round2(lines.reduce((a, l) => a + l.amount, 0));
  const oneWay = p.pickup_branch_id && p.return_branch_id && Number(p.pickup_branch_id) !== Number(p.return_branch_id) ? num(s.one_way_fee) : 0;
  const discount = round2(Math.max(0, num(p.discount)));
  const total = round2(base - longTerm + extrasAmount + oneWay - discount);
  if (total < 0) throw new HttpError(400, 'İndirim toplam tutardan büyük olamaz');

  return {
    days,
    daily_rate: dailyRate,
    base_amount: base,
    long_term_discount_pct: pct,
    long_term_discount: longTerm,
    extras: lines,
    extras_amount: extrasAmount,
    one_way_fee: oneWay,
    discount,
    total_amount: total,
    deposit_amount: num(p.vehicle.deposit_amount),
  };
}

// ---------- Müsaitlik ----------

export interface ConflictOptions {
  excludeReservationId?: number;
  excludeRentalId?: number;
}

/** Aracın verilen aralıkta çakışan kayıtlarını döndürür (boş dizi = müsait). */
export function findConflicts(vehicleId: number, from: string, to: string, opts: ConflictOptions = {}): Conflict[] {
  const { excludeReservationId = 0, excludeRentalId = 0 } = opts;
  const vehicle = one<Vehicle>('SELECT * FROM vehicles WHERE id = ?', vehicleId);
  if (!vehicle) throw new HttpError(404, 'Araç bulunamadı');
  const conflicts: Conflict[] = [];
  if (vehicle.status === 'out_of_service') conflicts.push({ type: 'status', message: 'Araç hizmet dışı' });

  for (const r of all<{ id: number; code: string; pickup_at: string; return_at: string }>(
    `SELECT id, code, pickup_at, return_at FROM reservations
     WHERE vehicle_id = ? AND status IN ('pending','confirmed') AND id <> ? AND pickup_at < ? AND return_at > ?`,
    vehicleId, excludeReservationId, to, from,
  )) {
    conflicts.push({ type: 'reservation', id: r.id, message: `Rezervasyon ${r.code} (${r.pickup_at} → ${r.return_at})` });
  }

  for (const r of all<{ id: number; contract_no: string; planned_return_at: string }>(
    `SELECT id, contract_no, planned_return_at FROM rentals
     WHERE vehicle_id = ? AND status = 'active' AND id <> ? AND pickup_at < ? AND MAX(planned_return_at, ?) > ?`,
    vehicleId, excludeRentalId, to, nowLocal(), from,
  )) {
    conflicts.push({ type: 'rental', id: r.id, message: `Aktif kiralama ${r.contract_no} (dönüş ${r.planned_return_at})` });
  }

  const maint = all<{ id: number; start_date: string; end_date: string | null }>(
    `SELECT id, start_date, end_date FROM maintenance
     WHERE vehicle_id = ? AND status IN ('scheduled','in_progress')
       AND start_date || 'T00:00' < ?
       AND (CASE
             WHEN end_date IS NOT NULL AND end_date <> '' THEN end_date || 'T23:59'
             WHEN status = 'in_progress' THEN '9999-12-31T23:59'
             ELSE start_date || 'T23:59' END) > ?`,
    vehicleId, to, from,
  );
  for (const m of maint) {
    conflicts.push({ type: 'maintenance', id: m.id, message: `Bakım (${m.start_date}${m.end_date ? ' → ' + m.end_date : ''})` });
  }
  if (vehicle.status === 'maintenance' && maint.length === 0) conflicts.push({ type: 'status', message: 'Araç bakımda' });
  return conflicts;
}

export function assertAvailable(vehicleId: number, from: string, to: string, opts?: ConflictOptions) {
  const c = findConflicts(vehicleId, from, to, opts);
  if (c.length) throw new HttpError(409, 'Araç seçilen tarihlerde müsait değil', c);
}

// ---------- Müşteri uygunluğu ----------

export function customerIssues(customer: Customer | undefined, atDate: string, { strict = false } = {}): string[] {
  if (!customer) return ['Müşteri bulunamadı'];
  const s = getSettings();
  const errors: string[] = [];
  if (customer.blacklisted) errors.push(`Müşteri kara listede${customer.blacklist_reason ? ': ' + customer.blacklist_reason : ''}`);
  if (customer.birth_date) {
    const age = yearsBetween(customer.birth_date, atDate);
    if (age !== null && age < num(s.min_driver_age)) errors.push(`Sürücü yaşı en az ${s.min_driver_age} olmalıdır (şu an ${age})`);
  } else if (strict) errors.push('Müşterinin doğum tarihi girilmemiş');
  if (customer.license_date) {
    const y = yearsBetween(customer.license_date, atDate);
    if (y !== null && y < num(s.min_license_years)) errors.push(`Ehliyet en az ${s.min_license_years} yıllık olmalıdır`);
  } else if (strict) errors.push('Müşterinin ehliyet tarihi girilmemiş');
  if (strict && !customer.license_no) errors.push('Müşterinin ehliyet numarası girilmemiş');
  return errors;
}

export function assertCustomerOk(customerId: unknown, atDate: string, opts?: { strict?: boolean }): Customer {
  const customer = one<Customer>('SELECT * FROM customers WHERE id = ?', num(customerId));
  if (!customer) throw new HttpError(404, 'Müşteri bulunamadı');
  const issues = customerIssues(customer, atDate, opts);
  if (issues.length) throw new HttpError(422, issues.join('; '), issues);
  return customer;
}

// ---------- Finans ----------

export function paymentTotals(by: 'rental_id' | 'reservation_id' | 'customer_id', id: number): Finance {
  const t = { payment: 0, refund: 0, deposit_in: 0, deposit_out: 0 };
  for (const r of all<{ type: keyof typeof t; total: number }>(
    `SELECT type, COALESCE(SUM(amount),0) AS total FROM payments WHERE ${by} = ? GROUP BY type`, id,
  )) t[r.type] = round2(r.total);
  return { ...t, paid: round2(t.payment - t.refund), deposit_held: round2(t.deposit_in - t.deposit_out) };
}

export function rentalFinance(rental: Pick<Rental, 'id' | 'total_amount'>): RentalFinance {
  const t = paymentTotals('rental_id', rental.id);
  return { ...t, total: rental.total_amount, balance: round2(rental.total_amount - t.paid) };
}

const chargesSum = (rentalId: number) => scalar<number>('SELECT COALESCE(SUM(amount),0) FROM rental_charges WHERE rental_id = ?', rentalId);

const subtotal = (r: Rental) => r.base_amount - r.long_term_discount + r.extras_amount + r.one_way_fee - r.discount;

export function recalcRental(rentalId: number) {
  const r = one<Rental>('SELECT * FROM rentals WHERE id = ?', rentalId);
  if (!r) return;
  const c = chargesSum(rentalId);
  run('UPDATE rentals SET charges_amount = ?, total_amount = ? WHERE id = ?', round2(c), round2(subtotal(r) + c), rentalId);
}

export interface CheckinInput {
  actual_return_at?: unknown;
  end_km?: unknown;
  end_fuel?: unknown;
  waive_late?: unknown;
  waive_km?: unknown;
  waive_fuel?: unknown;
  damages?: unknown;
  extra_charges?: unknown;
}

export interface CheckinDamage {
  description: string;
  location: string | null;
  severity: Severity;
  repair_cost: number;
  customer_charge: number;
}

export interface CheckinCalc {
  actual_return_at: string;
  end_km: number;
  end_fuel: number;
  km_driven: number;
  actual_days: number;
  late_days: number;
  charges: { type: ChargeType; description: string | null; amount: number }[];
  damages: CheckinDamage[];
  charges_total: number;
  new_total: number;
  paid: number;
  balance: number;
  deposit_held: number;
}

const truthy = (v: unknown) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';

/** İade (check-in) sırasında otomatik ek ücretleri hesaplar. */
export function calcCheckin(rental: Rental, vehicle: Vehicle, input: CheckinInput): CheckinCalc {
  const s = getSettings();
  const actualReturn = normDateTime(input.actual_return_at || nowLocal(), 'İade tarihi');
  if (actualReturn <= rental.pickup_at) throw new HttpError(400, 'İade tarihi teslim tarihinden sonra olmalıdır');
  const endKm = Math.floor(num(input.end_km, NaN));
  if (!Number.isFinite(endKm)) throw new HttpError(400, 'Dönüş kilometresi zorunludur');
  if (endKm < rental.start_km) throw new HttpError(400, `Dönüş km (${endKm}) çıkış km'sinden (${rental.start_km}) küçük olamaz`);
  const endFuel = Math.floor(num(input.end_fuel, NaN));
  if (!(endFuel >= 0 && endFuel <= 8)) throw new HttpError(400, 'Yakıt seviyesi 0-8 arası olmalıdır');

  const charges: CheckinCalc['charges'] = [];
  const actualDays = calcDays(rental.pickup_at, actualReturn, s.grace_hours);
  const lateDays = Math.max(0, actualDays - rental.days);
  if (lateDays > 0 && !truthy(input.waive_late)) {
    charges.push({
      type: 'late_return',
      description: `Geç iade: ${lateDays} gün x ${rental.daily_rate}`,
      amount: round2(lateDays * rental.daily_rate * num(s.late_fee_multiplier, 1)),
    });
  }
  const driven = endKm - rental.start_km;
  if (vehicle.km_limit_per_day > 0 && !truthy(input.waive_km)) {
    const allowed = vehicle.km_limit_per_day * Math.max(actualDays, rental.days);
    const over = driven - allowed;
    if (over > 0 && vehicle.extra_km_fee > 0) {
      charges.push({ type: 'extra_km', description: `Km aşımı: ${over} km (limit ${allowed} km)`, amount: round2(over * vehicle.extra_km_fee) });
    }
  }
  if (endFuel < rental.start_fuel && !truthy(input.waive_fuel)) {
    const diff = rental.start_fuel - endFuel;
    charges.push({ type: 'fuel', description: `Yakıt eksiği: ${diff}/8`, amount: round2(diff * num(s.fuel_price_per_eighth)) });
  }

  const rawDamages = Array.isArray(input.damages) ? (input.damages as Record<string, unknown>[]) : [];
  const damages: CheckinDamage[] = rawDamages
    .filter((d) => d && String(d.description ?? '').trim())
    .map((d) => ({
      description: String(d.description).trim(),
      location: d.location ? String(d.location) : null,
      severity: (['minor', 'moderate', 'major'] as const).includes(d.severity as Severity) ? (d.severity as Severity) : 'minor',
      repair_cost: round2(Math.max(0, num(d.repair_cost))),
      customer_charge: round2(Math.max(0, num(d.customer_charge))),
    }));
  for (const d of damages) {
    if (d.customer_charge > 0) charges.push({ type: 'damage', description: `Hasar: ${d.description}`, amount: d.customer_charge });
  }
  const rawCharges = Array.isArray(input.extra_charges) ? (input.extra_charges as Record<string, unknown>[]) : [];
  for (const c of rawCharges) {
    const amount = round2(num(c.amount));
    if (amount > 0) {
      charges.push({
        type: CHARGE_TYPES.includes(c.type as ChargeType) ? (c.type as ChargeType) : 'other',
        description: c.description ? String(c.description) : null,
        amount,
      });
    }
  }

  const chargesTotal = round2(charges.reduce((a, c) => a + c.amount, 0));
  const newTotal = round2(subtotal(rental) + chargesSum(rental.id) + chargesTotal);
  const fin = paymentTotals('rental_id', rental.id);
  return {
    actual_return_at: actualReturn,
    end_km: endKm,
    end_fuel: endFuel,
    km_driven: driven,
    actual_days: actualDays,
    late_days: lateDays,
    charges,
    damages,
    charges_total: chargesTotal,
    new_total: newTotal,
    paid: fin.paid,
    balance: round2(newTotal - fin.paid),
    deposit_held: fin.deposit_held,
  };
}
