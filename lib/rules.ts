// İş kuralları: gün/fiyat hesabı, müsaitlik, müşteri uygunluğu, finans ve iade hesabı.
import { all, getSettings, one, run, scalar } from './db';
import { HttpError, fmtDateTime, num, nowLocal, normDateTime, parseDate, round2, today, yearsBetween } from './core';
import type {
  ChargeType, Conflict, Customer, Extra, Finance, LineItem, Quote, Rental, RentalFinance, Severity, Vehicle,
} from './types';

export const CHARGE_TYPES: readonly ChargeType[] = [
  'late_return', 'extra_km', 'fuel', 'damage', 'cleaning', 'traffic_fine', 'hgs', 'missing_equipment', 'different_branch', 'service_fee', 'other',
];

/** Araç grupları (küçükten büyüğe; upgrade önerisi bu sırayı izler). */
export const CATEGORIES = ['Ekonomi', 'Orta', 'Üst', 'SUV', 'Minivan', 'Lüks', 'Ticari'] as const;

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

// ---------- Fiyat tabloları ----------

export const DAY_BANDS = [
  ['band_1_3', '1–3 gün', 1, 3],
  ['band_4_7', '4–7 gün', 4, 7],
  ['band_8_14', '8–14 gün', 8, 14],
  ['band_15_29', '15–29 gün', 15, 29],
  ['band_30', '30+ gün', 30, Infinity],
] as const;

export type BandKey = (typeof DAY_BANDS)[number][0];
export const bandFor = (days: number): BandKey => DAY_BANDS.find(([, , a, b]) => days >= a && days <= b)![0];

export interface RatePlan {
  id: number;
  name: string;
  category: string;
  season_id: number | null;
  channel: string | null;
  band_1_3: number;
  band_4_7: number;
  band_8_14: number;
  band_15_29: number;
  band_30: number;
  active: number;
}

/** Grup + alış tarihi + kanal için en özel fiyat planı (sezon > genel, kanala özel > tüm kanallar). */
export function findRatePlan(category: string, pickupDate: string, channel?: string | null): (RatePlan & { season_name: string | null }) | undefined {
  return one(
    `SELECT rp.*, s.name AS season_name FROM rate_plans rp LEFT JOIN seasons s ON s.id = rp.season_id
     WHERE rp.active = 1 AND rp.category = ? AND (rp.channel IS NULL OR rp.channel = ?)
       AND (rp.season_id IS NULL OR (s.start_date <= ? AND s.end_date >= ?))
     ORDER BY (rp.season_id IS NOT NULL) DESC, COALESCE(s.priority, 0) DESC, (rp.channel IS NOT NULL) DESC, rp.id DESC LIMIT 1`,
    category, channel ?? '', pickupDate, pickupDate,
  );
}

/** Grubun liste fiyatı (fiyat planı yoksa): gruptaki aktif araçların en düşük günlük fiyatı. */
function categoryListRate(category: string): { daily_rate: number; deposit_amount: number } {
  return (
    one<{ daily_rate: number; deposit_amount: number }>(
      `SELECT MIN(daily_rate) AS daily_rate, MAX(deposit_amount) AS deposit_amount FROM vehicles
       WHERE category = ? AND status NOT IN ('sold','for_sale','out_of_service')`,
      category,
    ) ?? { daily_rate: 0, deposit_amount: 0 }
  );
}

export interface Coupon {
  id: number;
  code: string;
  description: string | null;
  type: 'percent' | 'amount';
  value: number;
  valid_from: string | null;
  valid_to: string | null;
  min_days: number;
  early_booking_days: number;
  category: string | null;
  max_uses: number;
  used_count: number;
  active: number;
}

export function validateCoupon(code: string, ctx: { days: number; pickup_at: string; category: string | null }): Coupon {
  const c = one<Coupon>('SELECT * FROM coupons WHERE UPPER(code) = UPPER(?)', code.trim());
  if (!c || !c.active) throw new HttpError(400, 'Kupon kodu geçersiz');
  const t = today();
  if (c.valid_from && t < c.valid_from) throw new HttpError(400, 'Kupon henüz geçerli değil');
  if (c.valid_to && t > c.valid_to) throw new HttpError(400, 'Kuponun süresi dolmuş');
  if (c.max_uses && c.used_count >= c.max_uses) throw new HttpError(400, 'Kupon kullanım limiti dolmuş');
  if (c.min_days && ctx.days < c.min_days) throw new HttpError(400, `Kupon en az ${c.min_days} günlük kiralamada geçerli`);
  if (c.category && ctx.category && c.category !== ctx.category) throw new HttpError(400, `Kupon yalnızca ${c.category} grubunda geçerli`);
  if (c.early_booking_days) {
    const lead = (parseDate(ctx.pickup_at)!.getTime() - Date.now()) / 86400000;
    if (lead < c.early_booking_days) throw new HttpError(400, `Erken rezervasyon kuponu: alıştan en az ${c.early_booking_days} gün önce kullanılmalı`);
  }
  return c;
}

export interface DepositRule {
  id: number;
  category: string | null;
  driver_age_under: number | null;
  license_years_under: number | null;
  amount: number;
  note: string | null;
}

/** Segment/yaş/ehliyet yaşı kurallarına göre depozito; araç depozitosundan düşük olamaz. */
export function depositFor(category: string | null, base: number, customer: Customer | null | undefined, at: string): { amount: number; rule: string | null } {
  const age = customer?.birth_date ? yearsBetween(customer.birth_date, at) : null;
  const lic = customer?.license_date ? yearsBetween(customer.license_date, at) : null;
  let amount = base;
  let rule: string | null = null;
  for (const r of all<DepositRule>('SELECT * FROM deposit_rules')) {
    if (r.category && r.category !== category) continue;
    if (r.driver_age_under !== null && !(age !== null && age < r.driver_age_under)) continue;
    if (r.license_years_under !== null && !(lic !== null && lic < r.license_years_under)) continue;
    if (r.amount > amount) {
      amount = r.amount;
      rule = r.note || `Depozito kuralı #${r.id}`;
    }
  }
  return { amount, rule };
}

export interface QuoteInput {
  /** Araç grubu (rezervasyon araç ataması olmadan yapılabilir). */
  category?: string | null;
  vehicle?: Pick<Vehicle, 'daily_rate' | 'deposit_amount' | 'category'> | null;
  pickup_at: string;
  return_at: string;
  extras?: ExtraSelection[];
  discount?: unknown;
  /** Elle girilen günlük fiyat (fiyat tablosunu geçersiz kılar). */
  daily_rate?: unknown;
  pickup_branch_id?: number | null;
  return_branch_id?: number | null;
  channel?: string | null;
  coupon_code?: unknown;
  customer?: Customer | null;
}

export function calcQuote(p: QuoteInput): Quote {
  const s = getSettings();
  const category = p.category || p.vehicle?.category || null;
  if (!category && !p.vehicle) throw new HttpError(400, 'Araç veya araç grubu seçilmelidir');
  const days = calcDays(p.pickup_at, p.return_at, s.grace_hours);
  const pickupDate = p.pickup_at.slice(0, 10);
  const list = p.vehicle ?? categoryListRate(category!);

  // 1) Günlük fiyat: elle > fiyat planı (sezon/kanal/gün bandı) > liste fiyatı + uzun dönem indirimi
  let rateSource: Quote['rate_source'] = 'list';
  let dailyRate = num(list.daily_rate);
  let plan: ReturnType<typeof findRatePlan>;
  if (p.daily_rate !== undefined && p.daily_rate !== null && p.daily_rate !== '') {
    dailyRate = num(p.daily_rate);
    rateSource = 'manual';
  } else if (category && (plan = findRatePlan(category, pickupDate, p.channel))) {
    dailyRate = plan[bandFor(days)];
    rateSource = 'plan';
  }
  if (dailyRate < 0) throw new HttpError(400, 'Günlük fiyat negatif olamaz');
  const base = round2(dailyRate * days);
  const pct = rateSource === 'list' ? (days >= 30 ? num(s.monthly_discount_pct) : days >= 7 ? num(s.weekly_discount_pct) : 0) : 0;
  const longTerm = round2((base * pct) / 100);

  // 2) Kanal fiyat farkı (kanala özel plan kullanılmadıysa)
  const channel = p.channel ? one<{ markup_pct: number }>('SELECT markup_pct FROM channels WHERE code = ? AND active = 1', p.channel) : undefined;
  const markupPct = rateSource !== 'manual' && channel && !(plan?.channel) ? channel.markup_pct : 0;
  const markup = round2(((base - longTerm) * markupPct) / 100);

  // 3) Ek hizmetler
  const lines: LineItem[] = [];
  let unlimitedKm = false;
  for (const item of p.extras || []) {
    const qty = Math.max(1, Math.floor(num(item.quantity, 1)));
    const extra = one<Extra>('SELECT * FROM extras WHERE id = ?', num(item.extra_id));
    if (!extra) throw new HttpError(400, 'Ek hizmet bulunamadı');
    if (extra.code === 'unlimited_km') unlimitedKm = true;
    let unit = extra.price_type === 'daily' ? extra.price * days : extra.price;
    if (extra.max_price) unit = Math.min(unit, extra.max_price);
    lines.push({ extra_id: extra.id, name: extra.name, quantity: qty, amount: round2(unit * qty) });
  }
  const extrasAmount = round2(lines.reduce((a, l) => a + l.amount, 0));

  // 4) Tek yön ve genç sürücü
  const oneWay = p.pickup_branch_id && p.return_branch_id && Number(p.pickup_branch_id) !== Number(p.return_branch_id) ? num(s.one_way_fee) : 0;
  const age = p.customer?.birth_date ? yearsBetween(p.customer.birth_date, p.pickup_at) : null;
  const youngFee = age !== null && age < num(s.young_driver_age) ? round2(num(s.young_driver_fee_daily) * days) : 0;

  // 5) Kupon / kampanya ve manuel indirim
  let coupon: Coupon | null = null;
  let couponDiscount = 0;
  const rentalPart = base - longTerm + markup;
  if (p.coupon_code && String(p.coupon_code).trim()) {
    coupon = validateCoupon(String(p.coupon_code), { days, pickup_at: p.pickup_at, category });
    couponDiscount = round2(coupon.type === 'percent' ? (rentalPart * coupon.value) / 100 : Math.min(coupon.value, rentalPart));
  }
  const discount = round2(Math.max(0, num(p.discount)));
  const total = round2(rentalPart + extrasAmount + oneWay + youngFee - couponDiscount - discount);
  if (total < 0) throw new HttpError(400, 'İndirim toplam tutardan büyük olamaz');
  const deposit = depositFor(category, num(list.deposit_amount), p.customer, p.pickup_at);

  return {
    days,
    category,
    rate_source: rateSource,
    rate_plan_id: rateSource === 'plan' ? plan!.id : null,
    rate_plan_name: rateSource === 'plan' ? `${plan!.name}${plan!.season_name ? ` (${plan!.season_name})` : ''}` : null,
    channel: p.channel ?? null,
    channel_markup_pct: markupPct,
    channel_markup: markup,
    daily_rate: dailyRate,
    base_amount: base,
    long_term_discount_pct: pct,
    long_term_discount: longTerm,
    extras: lines,
    extras_amount: extrasAmount,
    one_way_fee: oneWay,
    young_driver_fee: youngFee,
    coupon_id: coupon?.id ?? null,
    coupon_code: coupon?.code ?? null,
    coupon_discount: couponDiscount,
    unlimited_km: unlimitedKm,
    discount,
    total_amount: total,
    deposit_amount: deposit.amount,
    deposit_rule: deposit.rule,
  };
}

// ---------- Müsaitlik ----------

export interface ConflictOptions {
  excludeReservationId?: number;
  excludeRentalId?: number;
}

const BLOCKING_STATUS = ['out_of_service', 'damaged', 'for_sale', 'sold'];
const STATUS_TEXT: Record<string, string> = {
  out_of_service: 'Araç hizmet dışı', damaged: 'Araç hasarlı', for_sale: 'Araç satılık', sold: 'Araç satıldı',
};

/** Aracın verilen aralıkta çakışan kayıtlarını döndürür (boş dizi = müsait). */
export function findConflicts(vehicleId: number, from: string, to: string, opts: ConflictOptions = {}): Conflict[] {
  const { excludeReservationId = 0, excludeRentalId = 0 } = opts;
  const vehicle = one<Vehicle>('SELECT * FROM vehicles WHERE id = ?', vehicleId);
  if (!vehicle) throw new HttpError(404, 'Araç bulunamadı');
  const conflicts: Conflict[] = [];
  if (BLOCKING_STATUS.includes(vehicle.status)) conflicts.push({ type: 'status', message: STATUS_TEXT[vehicle.status] });

  for (const r of all<{ id: number; code: string; pickup_at: string; return_at: string }>(
    `SELECT id, code, pickup_at, return_at FROM reservations
     WHERE vehicle_id = ? AND status IN ('pending','confirmed') AND id <> ? AND pickup_at < ? AND return_at > ?`,
    vehicleId, excludeReservationId, to, from,
  )) conflicts.push({ type: 'reservation', id: r.id, message: `Rezervasyon ${r.code} (${r.pickup_at} → ${r.return_at})` });

  // Gecikmiş (dönüşü geçmiş ama iade alınmamış) sözleşme aracı en az 24 saat daha dolu sayılır.
  const now = nowLocal();
  const overdueUntil = fmtDateTime(new Date(Date.now() + 24 * 3600000));
  for (const r of all<{ id: number; contract_no: string; planned_return_at: string }>(
    `SELECT id, contract_no, planned_return_at FROM rentals
     WHERE vehicle_id = ? AND status IN ('draft','active') AND id <> ? AND pickup_at < ?
       AND (CASE WHEN planned_return_at < ? THEN ? ELSE planned_return_at END) > ?`,
    vehicleId, excludeRentalId, to, now, overdueUntil, from,
  )) conflicts.push({ type: 'rental', id: r.id, message: `Sözleşme ${r.contract_no} (dönüş ${r.planned_return_at}${r.planned_return_at < now ? ' — gecikmiş, iade alınmadı' : ''})` });

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
  for (const m of maint) conflicts.push({ type: 'maintenance', id: m.id, message: `Bakım (${m.start_date}${m.end_date ? ' → ' + m.end_date : ''})` });
  if (vehicle.status === 'maintenance' && maint.length === 0) conflicts.push({ type: 'status', message: 'Araç serviste' });

  const transfer = one<{ id: number }>(
    `SELECT id FROM vehicle_transfers WHERE vehicle_id = ? AND status IN ('requested','in_transit')
       AND COALESCE(planned_at, created_at) < ?`, vehicleId, to,
  );
  if (transfer) conflicts.push({ type: 'status', id: transfer.id, message: 'Araç şube transferinde' });
  return conflicts;
}

export function assertAvailable(vehicleId: number, from: string, to: string, opts?: ConflictOptions) {
  const c = findConflicts(vehicleId, from, to, opts);
  if (c.length) throw new HttpError(409, 'Araç seçilen tarihlerde müsait değil', c);
}

/**
 * Grup bazlı müsaitlik (overbooking kontrolü): gruptaki müsait araç sayısı −
 * aynı dönemde araç atanmamış (grup) rezervasyonlar.
 */
export function groupAvailability(category: string, from: string, to: string, opts: ConflictOptions = {}) {
  const vehicles = all<{ id: number }>(`SELECT id FROM vehicles WHERE category = ? AND status NOT IN ('sold','for_sale','out_of_service')`, category);
  const free = vehicles.filter((v) => findConflicts(v.id, from, to, opts).length === 0).length;
  const unassigned = scalar<number>(
    `SELECT COUNT(*) FROM reservations WHERE vehicle_id IS NULL AND category = ? AND status IN ('pending','confirmed')
       AND id <> ? AND pickup_at < ? AND return_at > ?`,
    category, opts.excludeReservationId ?? 0, to, from,
  );
  return { total: vehicles.length, free, unassigned, available: free - unassigned };
}

// ---------- Müşteri uygunluğu ----------

export function customerIssues(customer: Customer | undefined, atDate: string, { strict = false } = {}): string[] {
  if (!customer) return ['Müşteri bulunamadı'];
  const s = getSettings();
  const errors: string[] = [];
  if (customer.anonymized_at) errors.push('Müşteri kaydı anonimleştirilmiş');
  if (customer.blacklisted) errors.push(`Müşteri kara listede${customer.blacklist_reason ? ': ' + customer.blacklist_reason : ''}`);
  if (customer.birth_date) {
    const age = yearsBetween(customer.birth_date, atDate);
    if (age !== null && age < num(s.min_driver_age)) errors.push(`Sürücü yaşı en az ${s.min_driver_age} olmalıdır (şu an ${age})`);
  } else if (strict) errors.push('Müşterinin doğum tarihi girilmemiş');
  if (customer.license_date) {
    const y = yearsBetween(customer.license_date, atDate);
    if (y !== null && y < num(s.min_license_years)) errors.push(`Ehliyet en az ${s.min_license_years} yıllık olmalıdır`);
  } else if (strict) errors.push('Müşterinin ehliyet tarihi girilmemiş');
  if (customer.license_expiry && customer.license_expiry < atDate.slice(0, 10)) errors.push(`Ehliyetin geçerlilik süresi dolmuş (${customer.license_expiry})`);
  if (strict && !customer.license_no) errors.push('Müşterinin ehliyet numarası girilmemiş');
  return errors;
}

/** Engellemeyen uyarılar (risk, kredi limiti). */
export function customerWarnings(customer: Customer, openBalance = 0): string[] {
  const w: string[] = [];
  if (customer.risk_score >= 70) w.push(`Yüksek risk skoru (${customer.risk_score})${customer.risk_note ? ': ' + customer.risk_note : ''}`);
  else if (customer.risk_score >= 40) w.push(`Orta risk skoru (${customer.risk_score})`);
  if (customer.credit_limit > 0 && openBalance > customer.credit_limit) w.push(`Açık bakiye kredi limitini aşıyor (${openBalance} / ${customer.credit_limit})`);
  return w;
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

type Priced = Pick<Rental, 'base_amount' | 'long_term_discount' | 'extras_amount' | 'one_way_fee' | 'young_driver_fee' | 'channel_markup' | 'coupon_discount' | 'discount'>;
export const subtotal = (r: Priced) =>
  r.base_amount - r.long_term_discount + r.channel_markup + r.extras_amount + r.one_way_fee + r.young_driver_fee - r.coupon_discount - r.discount;

export function recalcRental(rentalId: number) {
  const r = one<Rental>('SELECT * FROM rentals WHERE id = ?', rentalId);
  if (!r) return;
  const c = chargesSum(rentalId);
  run('UPDATE rentals SET charges_amount = ?, total_amount = ? WHERE id = ?', round2(c), round2(subtotal(r) + c), rentalId);
}

// ---------- İade (check-in) hesabı ----------

/** Ayarlardaki "Ad:ücret" satırlarından ekipman listesi. */
export function equipmentItems(): { name: string; fee: number }[] {
  return getSettings()
    .equipment_items.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf(':');
      return i > 0 ? { name: l.slice(0, i).trim(), fee: num(l.slice(i + 1)) } : { name: l, fee: 0 };
    });
}

export const CLEANLINESS = ['clean', 'normal', 'dirty', 'very_dirty'] as const;

export interface CheckinInput {
  actual_return_at?: unknown;
  end_km?: unknown;
  end_fuel?: unknown;
  cleanliness?: unknown;
  missing_equipment?: unknown;
  return_branch_id?: unknown;
  waive_late?: unknown;
  waive_km?: unknown;
  waive_fuel?: unknown;
  waive_cleaning?: unknown;
  damages?: unknown;
  extra_charges?: unknown;
}

export interface CheckinDamage {
  description: string;
  location: string | null;
  severity: Severity;
  repair_cost: number;
  customer_charge: number;
  mark_id?: number;
}

export interface CheckinCalc {
  actual_return_at: string;
  end_km: number;
  end_fuel: number;
  km_driven: number;
  actual_days: number;
  late_days: number;
  late_hours: number;
  charges: { type: ChargeType; description: string | null; amount: number; damage_index?: number }[];
  damages: CheckinDamage[];
  charges_total: number;
  new_total: number;
  paid: number;
  balance: number;
  deposit_held: number;
}

const truthy = (v: unknown) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';

export function calcCheckin(rental: Rental, vehicle: Vehicle, input: CheckinInput): CheckinCalc {
  const s = getSettings();
  const actualReturn = normDateTime(input.actual_return_at || nowLocal(), 'İade tarihi');
  if (actualReturn < rental.pickup_at) throw new HttpError(400, 'İade tarihi teslim tarihinden önce olamaz');
  const endKm = Math.floor(num(input.end_km, NaN));
  if (!Number.isFinite(endKm)) throw new HttpError(400, 'Dönüş kilometresi zorunludur');
  if (endKm < rental.start_km) throw new HttpError(400, `Dönüş km (${endKm}) çıkış km'sinden (${rental.start_km}) küçük olamaz`);
  const endFuel = Math.floor(num(input.end_fuel, NaN));
  if (!(endFuel >= 0 && endFuel <= 8)) throw new HttpError(400, 'Yakıt seviyesi 0-8 arası olmalıdır');

  const charges: CheckinCalc['charges'] = [];
  const actualDays = actualReturn > rental.pickup_at ? calcDays(rental.pickup_at, actualReturn, s.grace_hours) : 1;
  const lateDays = Math.max(0, actualDays - rental.days);
  const lateHoursRaw = (parseDate(actualReturn)!.getTime() - parseDate(rental.planned_return_at)!.getTime()) / 3600000 - num(s.grace_hours);
  const lateHours = Math.max(0, Math.ceil(lateHoursRaw - 1e-9));

  // Geç iade: günlük veya saatlik mod
  if (!truthy(input.waive_late)) {
    if (s.late_fee_mode === 'hourly' && lateHours > 0) {
      const fullDays = Math.floor(lateHours / 24);
      const hours = lateHours - fullDays * 24;
      const hourly = Math.min(rental.daily_rate, (rental.daily_rate * num(s.late_fee_hourly_pct)) / 100 * hours);
      const amount = round2(fullDays * rental.daily_rate * num(s.late_fee_multiplier, 1) + hourly);
      if (amount > 0) charges.push({ type: 'late_return', description: `Geç iade: ${lateHours} saat`, amount });
    } else if (s.late_fee_mode !== 'hourly' && lateDays > 0) {
      charges.push({
        type: 'late_return',
        description: `Geç iade: ${lateDays} gün x ${rental.daily_rate}`,
        amount: round2(lateDays * rental.daily_rate * num(s.late_fee_multiplier, 1)),
      });
    }
  }

  // Km aşımı (sınırsız km ek hizmeti yoksa)
  const driven = endKm - rental.start_km;
  const unlimited = !!one(`SELECT 1 FROM rental_extras re JOIN extras e ON e.id = re.extra_id WHERE re.rental_id = ? AND e.code = 'unlimited_km'`, rental.id);
  if (vehicle.km_limit_per_day > 0 && !unlimited && !truthy(input.waive_km)) {
    const allowed = vehicle.km_limit_per_day * Math.max(actualDays, rental.days);
    const over = driven - allowed;
    if (over > 0 && vehicle.extra_km_fee > 0) {
      charges.push({ type: 'extra_km', description: `Km aşımı: ${over} km (limit ${allowed} km)`, amount: round2(over * vehicle.extra_km_fee) });
    }
  }

  // Yakıt farkı: litre × birim fiyat + servis bedeli
  if (endFuel < rental.start_fuel && !truthy(input.waive_fuel)) {
    const diff = rental.start_fuel - endFuel;
    const liters = round2((diff / 8) * (vehicle.fuel_capacity || 50));
    charges.push({
      type: 'fuel',
      description: `Yakıt eksiği: ${diff}/8 ≈ ${liters} L × ${s.fuel_price_per_liter} + servis ${s.fuel_service_fee}`,
      amount: round2(liters * num(s.fuel_price_per_liter) + num(s.fuel_service_fee)),
    });
  }

  // Temizlik
  const cleanliness = CLEANLINESS.includes(input.cleanliness as (typeof CLEANLINESS)[number]) ? input.cleanliness : 'normal';
  if ((cleanliness === 'dirty' || cleanliness === 'very_dirty') && !truthy(input.waive_cleaning)) {
    const mult = cleanliness === 'very_dirty' ? 2 : 1;
    charges.push({ type: 'cleaning', description: cleanliness === 'very_dirty' ? 'Ağır kirlilik / koku' : 'Temizlik bedeli', amount: round2(num(s.cleaning_fee) * mult) });
  }

  // Farklı şube iadesi (tek yön ücreti önceden alınmadıysa)
  const returnBranch = num(input.return_branch_id) || rental.return_branch_id;
  if (returnBranch && rental.return_branch_id && returnBranch !== rental.return_branch_id && !rental.one_way_fee) {
    charges.push({ type: 'different_branch', description: 'Planlanandan farklı şubeye iade', amount: num(s.different_branch_fee) });
  }

  // Kayıp ekipman
  const missing = Array.isArray(input.missing_equipment) ? (input.missing_equipment as unknown[]).map(String) : [];
  for (const item of equipmentItems()) {
    if (missing.includes(item.name) && item.fee > 0) charges.push({ type: 'missing_equipment', description: `Kayıp ekipman: ${item.name}`, amount: item.fee });
  }

  // Hasarlar
  const rawDamages = Array.isArray(input.damages) ? (input.damages as Record<string, unknown>[]) : [];
  const damages: CheckinDamage[] = rawDamages
    .filter((d) => d && String(d.description ?? '').trim())
    .map((d) => ({
      description: String(d.description).trim(),
      location: d.location ? String(d.location) : null,
      severity: (['minor', 'moderate', 'major'] as const).includes(d.severity as Severity) ? (d.severity as Severity) : 'minor',
      repair_cost: round2(Math.max(0, num(d.repair_cost))),
      customer_charge: round2(Math.max(0, num(d.customer_charge))),
      mark_id: num(d.mark_id) || undefined,
    }));
  damages.forEach((d, i) => {
    if (d.customer_charge > 0) charges.push({ type: 'damage', description: `Hasar: ${d.description}`, amount: d.customer_charge, damage_index: i });
  });

  // Diğer ek ücretler
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
    late_hours: lateHours,
    charges,
    damages,
    charges_total: chargesTotal,
    new_total: newTotal,
    paid: fin.paid,
    balance: round2(newTotal - fin.paid),
    deposit_held: fin.deposit_held,
  };
}
