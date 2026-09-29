import { getDb, getSettings, num } from './db.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------- Tarih yardımcıları ----------
// Tarihler yerel saatle "YYYY-MM-DDTHH:MM" biçiminde saklanır.

export function parseDate(s) {
  if (!s) return null;
  let str = String(s).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += 'T00:00';
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');

export function fmtDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const nowLocal = () => fmtDateTime(new Date());
export const today = () => fmtDate(new Date());

/** Normalizes user input to "YYYY-MM-DDTHH:MM" or throws. */
export function normDateTime(s, field = 'Tarih') {
  const d = parseDate(s);
  if (!d) throw new HttpError(400, `${field} geçersiz`);
  return fmtDateTime(d);
}

export function normDate(s, field = 'Tarih', optional = false) {
  if (optional && (s === undefined || s === null || s === '')) return null;
  const d = parseDate(s);
  if (!d) throw new HttpError(400, `${field} geçersiz`);
  return fmtDate(d);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Kiralama gün sayısı: 24 saatlik bloklar, tolerans (grace) saatini aşan kısım yeni gün sayılır. */
export function calcDays(from, to, graceHours = 0) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) throw new HttpError(400, 'Tarih geçersiz');
  const hours = (b - a) / 3600000;
  if (hours <= 0) throw new HttpError(400, 'Dönüş tarihi alış tarihinden sonra olmalıdır');
  let days = Math.floor(hours / 24 + 1e-9);
  const rest = hours - days * 24;
  if (rest > num(graceHours) + 1e-9) days += 1;
  return Math.max(1, days);
}

export function yearsBetween(fromDate, toDate) {
  const a = parseDate(fromDate);
  const b = parseDate(toDate);
  if (!a || !b) return null;
  let years = b.getFullYear() - a.getFullYear();
  const m = b.getMonth() - a.getMonth();
  if (m < 0 || (m === 0 && b.getDate() < a.getDate())) years -= 1;
  return years;
}

// ---------- Kodlar ----------

export function makeCode(prefix, id) {
  return `${prefix}${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;
}

// ---------- Fiyatlandırma ----------

/**
 * Fiyat teklifi hesaplar.
 * @param {object} p
 *  vehicle, pickup_at, return_at, extras: [{extra_id, quantity}], discount,
 *  pickup_branch_id, return_branch_id, daily_rate (opsiyonel özel fiyat)
 */
export function calcQuote(p) {
  const s = getSettings();
  const db = getDb();
  const vehicle = p.vehicle;
  const days = calcDays(p.pickup_at, p.return_at, s.grace_hours);
  const dailyRate = p.daily_rate !== undefined && p.daily_rate !== null && p.daily_rate !== ''
    ? num(p.daily_rate)
    : num(vehicle.daily_rate);
  if (dailyRate < 0) throw new HttpError(400, 'Günlük fiyat negatif olamaz');

  const base = round2(dailyRate * days);
  let pct = 0;
  if (days >= 30) pct = num(s.monthly_discount_pct);
  else if (days >= 7) pct = num(s.weekly_discount_pct);
  const longTerm = round2((base * pct) / 100);

  const lines = [];
  for (const item of p.extras || []) {
    const qty = Math.max(1, Math.floor(num(item.quantity, 1)));
    const extra = db.prepare('SELECT * FROM extras WHERE id = ?').get(num(item.extra_id));
    if (!extra) throw new HttpError(400, 'Ek hizmet bulunamadı');
    let unit = extra.price_type === 'daily' ? extra.price * days : extra.price;
    if (extra.max_price) unit = Math.min(unit, extra.max_price);
    lines.push({ extra_id: extra.id, name: extra.name, quantity: qty, amount: round2(unit * qty) });
  }
  const extrasAmount = round2(lines.reduce((a, l) => a + l.amount, 0));

  const oneWay =
    p.pickup_branch_id && p.return_branch_id && Number(p.pickup_branch_id) !== Number(p.return_branch_id)
      ? num(s.one_way_fee)
      : 0;
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
    deposit_amount: num(vehicle.deposit_amount),
  };
}

// ---------- Müsaitlik ----------

/** Aracın verilen aralıkta çakışan kayıtlarını döndürür (boş dizi = müsait). */
export function findConflicts(vehicleId, from, to, { excludeReservationId = 0, excludeRentalId = 0 } = {}) {
  const db = getDb();
  const conflicts = [];
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) throw new HttpError(404, 'Araç bulunamadı');
  if (vehicle.status === 'out_of_service') conflicts.push({ type: 'status', message: 'Araç hizmet dışı' });

  const res = db
    .prepare(
      `SELECT id, code, pickup_at, return_at FROM reservations
       WHERE vehicle_id = ? AND status IN ('pending','confirmed') AND id <> ?
         AND pickup_at < ? AND return_at > ?`,
    )
    .all(vehicleId, excludeReservationId, to, from);
  for (const r of res) {
    conflicts.push({ type: 'reservation', id: r.id, message: `Rezervasyon ${r.code} (${r.pickup_at} → ${r.return_at})` });
  }

  const rentals = db
    .prepare(
      `SELECT id, contract_no, pickup_at, planned_return_at FROM rentals
       WHERE vehicle_id = ? AND status = 'active' AND id <> ?
         AND pickup_at < ? AND MAX(planned_return_at, ?) > ?`,
    )
    .all(vehicleId, excludeRentalId, to, nowLocal(), from);
  for (const r of rentals) {
    conflicts.push({ type: 'rental', id: r.id, message: `Aktif kiralama ${r.contract_no} (dönüş ${r.planned_return_at})` });
  }

  const maint = db
    .prepare(
      `SELECT id, type, start_date, end_date, status FROM maintenance
       WHERE vehicle_id = ? AND status IN ('scheduled','in_progress')
         AND start_date || 'T00:00' < ?
         AND (CASE
               WHEN end_date IS NOT NULL AND end_date <> '' THEN end_date || 'T23:59'
               WHEN status = 'in_progress' THEN '9999-12-31T23:59'
               ELSE start_date || 'T23:59' END) > ?`,
    )
    .all(vehicleId, to, from);
  for (const m of maint) {
    conflicts.push({ type: 'maintenance', id: m.id, message: `Bakım (${m.start_date}${m.end_date ? ' → ' + m.end_date : ''})` });
  }
  if (vehicle.status === 'maintenance' && maint.length === 0) {
    conflicts.push({ type: 'status', message: 'Araç bakımda' });
  }
  return conflicts;
}

export function assertAvailable(vehicleId, from, to, opts) {
  const c = findConflicts(vehicleId, from, to, opts);
  if (c.length) throw new HttpError(409, 'Araç seçilen tarihlerde müsait değil', c);
}

// ---------- Müşteri uygunluğu ----------

export function customerIssues(customer, atDate, { strict = false } = {}) {
  const s = getSettings();
  const errors = [];
  if (!customer) return ['Müşteri bulunamadı'];
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

export function assertCustomerOk(customerId, atDate, opts) {
  const customer = getDb().prepare('SELECT * FROM customers WHERE id = ?').get(num(customerId));
  if (!customer) throw new HttpError(404, 'Müşteri bulunamadı');
  const issues = customerIssues(customer, atDate, opts);
  if (issues.length) throw new HttpError(422, issues.join('; '), issues);
  return customer;
}

// ---------- Finans ----------

export function paymentTotals(where, id) {
  const rows = getDb()
    .prepare(`SELECT type, COALESCE(SUM(amount),0) AS total FROM payments WHERE ${where} = ? GROUP BY type`)
    .all(id);
  const t = { payment: 0, refund: 0, deposit_in: 0, deposit_out: 0 };
  for (const r of rows) t[r.type] = round2(r.total);
  return {
    paid: round2(t.payment - t.refund),
    deposit_held: round2(t.deposit_in - t.deposit_out),
    ...t,
  };
}

export function recalcRental(rentalId) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM rentals WHERE id = ?').get(rentalId);
  const { c } = db.prepare('SELECT COALESCE(SUM(amount),0) AS c FROM rental_charges WHERE rental_id = ?').get(rentalId);
  const total = round2(r.base_amount - r.long_term_discount + r.extras_amount + r.one_way_fee - r.discount + c);
  db.prepare('UPDATE rentals SET charges_amount = ?, total_amount = ? WHERE id = ?').run(round2(c), total, rentalId);
}

export function rentalFinance(rental) {
  const t = paymentTotals('rental_id', rental.id);
  return { ...t, total: rental.total_amount, balance: round2(rental.total_amount - t.paid) };
}

/**
 * İade (check-in) sırasında otomatik ek ücretleri hesaplar.
 */
export function calcCheckin(rental, vehicle, input) {
  const s = getSettings();
  const actualReturn = normDateTime(input.actual_return_at || nowLocal(), 'İade tarihi');
  if (actualReturn <= rental.pickup_at) throw new HttpError(400, 'İade tarihi teslim tarihinden sonra olmalıdır');
  const endKm = Math.floor(num(input.end_km, NaN));
  if (!Number.isFinite(endKm)) throw new HttpError(400, 'Dönüş kilometresi zorunludur');
  if (endKm < rental.start_km) throw new HttpError(400, `Dönüş km (${endKm}) çıkış km'sinden (${rental.start_km}) küçük olamaz`);
  const endFuel = Math.floor(num(input.end_fuel, NaN));
  if (!(endFuel >= 0 && endFuel <= 8)) throw new HttpError(400, 'Yakıt seviyesi 0-8 arası olmalıdır');

  const charges = [];
  const actualDays = calcDays(rental.pickup_at, actualReturn, s.grace_hours);
  const lateDays = Math.max(0, actualDays - rental.days);
  if (lateDays > 0 && !input.waive_late) {
    charges.push({
      type: 'late_return',
      description: `Geç iade: ${lateDays} gün x ${rental.daily_rate}`,
      amount: round2(lateDays * rental.daily_rate * num(s.late_fee_multiplier, 1)),
    });
  }
  const driven = endKm - rental.start_km;
  if (vehicle.km_limit_per_day > 0 && !input.waive_km) {
    const allowed = vehicle.km_limit_per_day * Math.max(actualDays, rental.days);
    const over = driven - allowed;
    if (over > 0 && vehicle.extra_km_fee > 0) {
      charges.push({
        type: 'extra_km',
        description: `Km aşımı: ${over} km (limit ${allowed} km)`,
        amount: round2(over * vehicle.extra_km_fee),
      });
    }
  }
  if (endFuel < rental.start_fuel && !input.waive_fuel) {
    const diff = rental.start_fuel - endFuel;
    charges.push({
      type: 'fuel',
      description: `Yakıt eksiği: ${diff}/8`,
      amount: round2(diff * num(s.fuel_price_per_eighth)),
    });
  }
  const damages = (input.damages || [])
    .filter((d) => d && String(d.description || '').trim())
    .map((d) => ({
      description: String(d.description).trim(),
      location: d.location || null,
      severity: ['minor', 'moderate', 'major'].includes(d.severity) ? d.severity : 'minor',
      repair_cost: round2(Math.max(0, num(d.repair_cost))),
      customer_charge: round2(Math.max(0, num(d.customer_charge))),
    }));
  for (const d of damages) {
    if (d.customer_charge > 0) charges.push({ type: 'damage', description: `Hasar: ${d.description}`, amount: d.customer_charge });
  }
  for (const c of input.extra_charges || []) {
    const amount = round2(num(c.amount));
    if (amount > 0) charges.push({ type: CHARGE_TYPES.includes(c.type) ? c.type : 'other', description: c.description || null, amount });
  }

  const existing = getDb().prepare('SELECT COALESCE(SUM(amount),0) AS c FROM rental_charges WHERE rental_id = ?').get(rental.id).c;
  const chargesTotal = round2(charges.reduce((a, c) => a + c.amount, 0));
  const newTotal = round2(rental.base_amount - rental.long_term_discount + rental.extras_amount + rental.one_way_fee - rental.discount + existing + chargesTotal);
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

export const CHARGE_TYPES = ['late_return', 'extra_km', 'fuel', 'damage', 'cleaning', 'traffic_fine', 'hgs', 'other'];
