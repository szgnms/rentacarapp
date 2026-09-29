import { Router } from 'express';
import { getDb, num } from '../db.js';
import { requireAdmin } from '../auth.js';
import {
  HttpError, findConflicts, normDateTime, normDate, calcQuote, paymentTotals, round2, customerIssues, nowLocal,
} from '../services.js';
import { str, bool, required, oneOf, idParam, mustGet, updateRow, insertRow } from './util.js';

const r = Router();

export const CATEGORIES = ['Ekonomi', 'Orta', 'Üst', 'SUV', 'Minivan', 'Lüks', 'Ticari'];
export const FUEL_TYPES = ['Benzin', 'Dizel', 'LPG', 'Hibrit', 'Elektrik'];
export const TRANSMISSIONS = ['Manuel', 'Otomatik'];

r.get('/meta', (req, res) => res.json({ categories: CATEGORIES, fuel_types: FUEL_TYPES, transmissions: TRANSMISSIONS }));

// ================= ARAÇLAR =================

const VEHICLE_LIST_SQL = `
  SELECT v.*, b.name AS branch_name,
    (SELECT contract_no FROM rentals WHERE vehicle_id = v.id AND status = 'active' LIMIT 1) AS active_contract,
    (SELECT planned_return_at FROM rentals WHERE vehicle_id = v.id AND status = 'active' LIMIT 1) AS active_return_at
  FROM vehicles v LEFT JOIN branches b ON b.id = v.branch_id`;

r.get('/vehicles', (req, res) => {
  const where = [];
  const params = [];
  if (str(req.query.q)) {
    where.push('(v.plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ?)');
    const q = `%${str(req.query.q)}%`;
    params.push(q, q, q);
  }
  for (const f of ['status', 'category', 'fuel_type', 'transmission']) {
    if (str(req.query[f])) {
      where.push(`v.${f} = ?`);
      params.push(str(req.query[f]));
    }
  }
  if (str(req.query.branch_id)) {
    where.push('v.branch_id = ?');
    params.push(num(req.query.branch_id));
  }
  const sql = `${VEHICLE_LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.plate`;
  res.json(getDb().prepare(sql).all(...params));
});

/** Tarih aralığında müsait araçlar ve fiyat teklifleri. */
r.get('/vehicles/available', (req, res) => {
  const from = normDateTime(req.query.pickup_at, 'Alış tarihi');
  const to = normDateTime(req.query.return_at, 'Dönüş tarihi');
  if (to <= from) throw new HttpError(400, 'Dönüş tarihi alış tarihinden sonra olmalıdır');
  const where = ["v.status <> 'out_of_service'"];
  const params = [];
  if (str(req.query.category)) {
    where.push('v.category = ?');
    params.push(str(req.query.category));
  }
  if (str(req.query.transmission)) {
    where.push('v.transmission = ?');
    params.push(str(req.query.transmission));
  }
  const vehicles = getDb().prepare(`${VEHICLE_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY v.daily_rate, v.plate`).all(...params);
  const excl = {
    excludeReservationId: num(req.query.exclude_reservation_id),
    excludeRentalId: num(req.query.exclude_rental_id),
  };
  const out = [];
  for (const v of vehicles) {
    const conflicts = findConflicts(v.id, from, to, excl);
    if (conflicts.length && !req.query.include_unavailable) continue;
    const q = calcQuote({ vehicle: v, pickup_at: from, return_at: to });
    out.push({ ...v, available: conflicts.length === 0, conflicts, quote: q });
  }
  res.json(out);
});

r.get('/vehicles/:id', (req, res) => {
  const id = idParam(req);
  const db = getDb();
  const v = db.prepare(`${VEHICLE_LIST_SQL} WHERE v.id = ?`).get(id);
  if (!v) throw new HttpError(404, 'Araç bulunamadı');
  v.rentals = db
    .prepare(
      `SELECT r.id, r.contract_no, r.pickup_at, r.planned_return_at, r.actual_return_at, r.status, r.total_amount,
              r.start_km, r.end_km, c.first_name || ' ' || c.last_name AS customer_name
       FROM rentals r JOIN customers c ON c.id = r.customer_id WHERE r.vehicle_id = ? ORDER BY r.pickup_at DESC`,
    )
    .all(id);
  v.reservations = db
    .prepare(
      `SELECT r.id, r.code, r.pickup_at, r.return_at, r.status, r.total_amount,
              c.first_name || ' ' || c.last_name AS customer_name
       FROM reservations r JOIN customers c ON c.id = r.customer_id
       WHERE r.vehicle_id = ? AND r.status IN ('pending','confirmed') ORDER BY r.pickup_at`,
    )
    .all(id);
  v.maintenance = db.prepare('SELECT * FROM maintenance WHERE vehicle_id = ? ORDER BY start_date DESC').all(id);
  v.damages = db.prepare('SELECT * FROM damages WHERE vehicle_id = ? ORDER BY reported_at DESC').all(id);
  v.expenses = db.prepare('SELECT * FROM expenses WHERE vehicle_id = ? ORDER BY expense_date DESC').all(id);
  const income = db
    .prepare(`SELECT COALESCE(SUM(total_amount),0) AS t, COALESCE(SUM(days),0) AS d FROM rentals WHERE vehicle_id = ? AND status <> 'cancelled'`)
    .get(id);
  const costs =
    db.prepare(`SELECT COALESCE(SUM(cost),0) AS t FROM maintenance WHERE vehicle_id = ? AND status <> 'cancelled'`).get(id).t +
    db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE vehicle_id = ?').get(id).t;
  v.stats = { revenue: round2(income.t), rented_days: income.d, costs: round2(costs), profit: round2(income.t - costs) };
  res.json(v);
});

function vehicleData(b, partial = false) {
  const d = {
    plate: str(b.plate)?.toUpperCase().replace(/\s+/g, ' '),
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

r.post('/vehicles', (req, res) => {
  required(req.body, [['plate', 'Plaka'], ['brand', 'Marka'], ['model', 'Model'], ['daily_rate', 'Günlük fiyat']]);
  const db = getDb();
  const data = vehicleData(req.body);
  if (db.prepare('SELECT 1 FROM vehicles WHERE plate = ?').get(data.plate)) throw new HttpError(409, 'Bu plaka zaten kayıtlı');
  data.status = req.body.status === 'out_of_service' ? 'out_of_service' : 'available';
  const id = insertRow(db, 'vehicles', data);
  res.status(201).json(mustGet(db, 'vehicles', id));
});

r.put('/vehicles/:id', (req, res) => {
  const id = idParam(req);
  const db = getDb();
  const v = mustGet(db, 'vehicles', id, 'Araç');
  const data = vehicleData(req.body, true);
  if (data.plate && data.plate !== v.plate && db.prepare('SELECT 1 FROM vehicles WHERE plate = ? AND id <> ?').get(data.plate, id)) {
    throw new HttpError(409, 'Bu plaka zaten kayıtlı');
  }
  // Durum yalnızca müsait <-> hizmet dışı arasında elle değiştirilebilir.
  if (req.body.status && req.body.status !== v.status) {
    if (!['available', 'out_of_service'].includes(req.body.status) || !['available', 'out_of_service'].includes(v.status)) {
      throw new HttpError(400, 'Araç durumu kiralama/bakım işlemleriyle yönetilir; yalnızca "Müsait" ve "Hizmet dışı" arasında elle geçiş yapılabilir');
    }
    data.status = req.body.status;
  }
  updateRow(db, 'vehicles', id, data);
  res.json(mustGet(db, 'vehicles', id));
});

r.delete('/vehicles/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const db = getDb();
  mustGet(db, 'vehicles', id, 'Araç');
  const used =
    db.prepare('SELECT 1 FROM rentals WHERE vehicle_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM reservations WHERE vehicle_id = ? LIMIT 1').get(id);
  if (used) throw new HttpError(409, 'Kiralama/rezervasyon geçmişi olan araç silinemez; "Hizmet dışı" yapabilirsiniz');
  db.prepare('DELETE FROM maintenance WHERE vehicle_id = ?').run(id);
  db.prepare('DELETE FROM damages WHERE vehicle_id = ?').run(id);
  db.prepare('UPDATE expenses SET vehicle_id = NULL WHERE vehicle_id = ?').run(id);
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ================= MÜŞTERİLER =================

r.get('/customers', (req, res) => {
  const where = [];
  const params = [];
  if (str(req.query.q)) {
    const q = `%${str(req.query.q)}%`;
    where.push(`(c.first_name || ' ' || c.last_name LIKE ? OR c.company_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?
                 OR c.national_id LIKE ? OR c.passport_no LIKE ? OR c.license_no LIKE ?)`);
    params.push(q, q, q, q, q, q, q);
  }
  if (req.query.blacklisted !== undefined && req.query.blacklisted !== '') {
    where.push('c.blacklisted = ?');
    params.push(bool(req.query.blacklisted));
  }
  const rows = getDb()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM rentals WHERE customer_id = c.id AND status <> 'cancelled') AS rental_count,
        (SELECT COALESCE(SUM(total_amount),0) FROM rentals WHERE customer_id = c.id AND status <> 'cancelled') AS total_spent
       FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.first_name, c.last_name LIMIT 500`,
    )
    .all(...params);
  res.json(rows);
});

r.get('/customers/:id', (req, res) => {
  const id = idParam(req);
  const db = getDb();
  const c = mustGet(db, 'customers', id, 'Müşteri');
  c.rentals = db
    .prepare(
      `SELECT r.id, r.contract_no, r.pickup_at, r.planned_return_at, r.actual_return_at, r.status, r.total_amount,
              v.plate, v.brand, v.model
       FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.customer_id = ? ORDER BY r.pickup_at DESC`,
    )
    .all(id);
  for (const rent of c.rentals) {
    const t = paymentTotals('rental_id', rent.id);
    rent.paid = t.paid;
    rent.balance = rent.status === 'cancelled' ? 0 : round2(rent.total_amount - t.paid);
  }
  c.reservations = db
    .prepare(
      `SELECT r.id, r.code, r.pickup_at, r.return_at, r.status, r.total_amount, v.plate, v.brand, v.model
       FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.customer_id = ? ORDER BY r.pickup_at DESC`,
    )
    .all(id);
  c.payments = db.prepare('SELECT * FROM payments WHERE customer_id = ? ORDER BY paid_at DESC, id DESC').all(id);
  c.balance = round2(c.rentals.reduce((a, x) => a + x.balance, 0));
  c.issues = customerIssues(c, nowLocal(), { strict: true });
  res.json(c);
});

function customerData(b) {
  const type = oneOf(b.type, ['individual', 'corporate'], 'Müşteri tipi', 'individual');
  const email = str(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-posta adresi geçersiz');
  const nid = str(b.national_id);
  if (nid && !/^\d{11}$/.test(nid)) throw new HttpError(400, 'T.C. kimlik numarası 11 haneli olmalıdır');
  return {
    type,
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

r.post('/customers', (req, res) => {
  required(req.body, [['first_name', 'Ad'], ['last_name', 'Soyad'], ['phone', 'Telefon']]);
  const db = getDb();
  const data = customerData(req.body);
  if (data.national_id && db.prepare('SELECT 1 FROM customers WHERE national_id = ?').get(data.national_id)) {
    throw new HttpError(409, 'Bu T.C. kimlik numarası ile kayıtlı müşteri var');
  }
  const id = insertRow(db, 'customers', data);
  res.status(201).json(mustGet(db, 'customers', id));
});

r.put('/customers/:id', (req, res) => {
  const id = idParam(req);
  const db = getDb();
  mustGet(db, 'customers', id, 'Müşteri');
  required(req.body, [['first_name', 'Ad'], ['last_name', 'Soyad'], ['phone', 'Telefon']]);
  const data = customerData(req.body);
  if (data.national_id && db.prepare('SELECT 1 FROM customers WHERE national_id = ? AND id <> ?').get(data.national_id, id)) {
    throw new HttpError(409, 'Bu T.C. kimlik numarası ile kayıtlı başka müşteri var');
  }
  updateRow(db, 'customers', id, data);
  res.json(mustGet(db, 'customers', id));
});

r.delete('/customers/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const db = getDb();
  mustGet(db, 'customers', id, 'Müşteri');
  const used =
    db.prepare('SELECT 1 FROM rentals WHERE customer_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM reservations WHERE customer_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM payments WHERE customer_id = ? LIMIT 1').get(id);
  if (used) throw new HttpError(409, 'İşlem geçmişi olan müşteri silinemez');
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default r;
