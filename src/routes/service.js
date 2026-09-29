import { Router } from 'express';
import { getDb, tx, num } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError, normDate, round2, today, nowLocal, fmtDate, addDays, parseDate } from '../services.js';
import { str, bool, required, oneOf, idParam, mustGet, insertRow, updateRow } from './util.js';

const r = Router();

// ================= BAKIM =================

const MAINT_TYPES = ['periodic', 'repair', 'tire', 'inspection', 'damage_repair', 'other'];
const MAINT_STATUS = ['scheduled', 'in_progress', 'completed', 'cancelled'];

r.get('/maintenance', (req, res) => {
  const where = [];
  const params = [];
  if (str(req.query.status)) {
    where.push('m.status = ?');
    params.push(str(req.query.status));
  }
  if (str(req.query.vehicle_id)) {
    where.push('m.vehicle_id = ?');
    params.push(num(req.query.vehicle_id));
  }
  res.json(
    getDb()
      .prepare(
        `SELECT m.*, v.plate, v.brand, v.model FROM maintenance m JOIN vehicles v ON v.id = m.vehicle_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.start_date DESC, m.id DESC`,
      )
      .all(...params),
  );
});

/** Bakım durumuna göre araç durumunu senkronize eder. */
function syncVehicleStatus(vehicleId) {
  const db = getDb();
  const v = db.prepare('SELECT status FROM vehicles WHERE id = ?').get(vehicleId);
  if (!v || v.status === 'rented' || v.status === 'out_of_service') return;
  const open = db.prepare("SELECT 1 FROM maintenance WHERE vehicle_id = ? AND status = 'in_progress' LIMIT 1").get(vehicleId);
  db.prepare('UPDATE vehicles SET status = ? WHERE id = ?').run(open ? 'maintenance' : 'available', vehicleId);
}

function maintData(b) {
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

function checkInProgress(d) {
  if (d.status !== 'in_progress') return;
  const v = mustGet(getDb(), 'vehicles', d.vehicle_id, 'Araç');
  if (v.status === 'rented') throw new HttpError(409, 'Araç kirada; iade alınmadan bakıma alınamaz');
}

r.post('/maintenance', (req, res) => {
  required(req.body, [['vehicle_id', 'Araç']]);
  const id = tx(() => {
    const d = maintData(req.body);
    mustGet(getDb(), 'vehicles', d.vehicle_id, 'Araç');
    checkInProgress(d);
    const newId = insertRow(getDb(), 'maintenance', d);
    syncVehicleStatus(d.vehicle_id);
    return newId;
  });
  res.status(201).json(mustGet(getDb(), 'maintenance', id));
});

r.put('/maintenance/:id', (req, res) => {
  const id = idParam(req);
  tx(() => {
    const old = mustGet(getDb(), 'maintenance', id, 'Bakım kaydı');
    const d = maintData({ ...old, ...req.body });
    if (d.status !== old.status) checkInProgress(d);
    if (d.status === 'completed' && !d.end_date) d.end_date = today();
    updateRow(getDb(), 'maintenance', id, d);
    syncVehicleStatus(old.vehicle_id);
    if (d.vehicle_id !== old.vehicle_id) syncVehicleStatus(d.vehicle_id);
    if (d.status === 'completed' && d.km) {
      getDb().prepare('UPDATE vehicles SET current_km = MAX(current_km, ?) WHERE id = ?').run(d.km, d.vehicle_id);
    }
  });
  res.json(mustGet(getDb(), 'maintenance', id));
});

r.delete('/maintenance/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const m = mustGet(getDb(), 'maintenance', id, 'Bakım kaydı');
  tx(() => {
    getDb().prepare('DELETE FROM maintenance WHERE id = ?').run(id);
    syncVehicleStatus(m.vehicle_id);
  });
  res.json({ ok: true });
});

// ================= HASARLAR =================

r.get('/damages', (req, res) => {
  const where = [];
  const params = [];
  if (str(req.query.status)) {
    where.push('d.status = ?');
    params.push(str(req.query.status));
  }
  if (str(req.query.vehicle_id)) {
    where.push('d.vehicle_id = ?');
    params.push(num(req.query.vehicle_id));
  }
  res.json(
    getDb()
      .prepare(
        `SELECT d.*, v.plate, v.brand, v.model, r.contract_no, c.first_name || ' ' || c.last_name AS customer_name
         FROM damages d JOIN vehicles v ON v.id = d.vehicle_id
         LEFT JOIN rentals r ON r.id = d.rental_id LEFT JOIN customers c ON c.id = r.customer_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.reported_at DESC, d.id DESC`,
      )
      .all(...params),
  );
});

function damageData(b) {
  return {
    vehicle_id: num(b.vehicle_id),
    rental_id: str(b.rental_id) === null ? null : num(b.rental_id),
    reported_at: normDate(b.reported_at || today(), 'Tarih'),
    location: str(b.location),
    description: str(b.description),
    severity: oneOf(b.severity, ['minor', 'moderate', 'major'], 'Önem', 'minor'),
    repair_cost: round2(Math.max(0, num(b.repair_cost))),
    customer_charge: round2(Math.max(0, num(b.customer_charge))),
    insurance_claim: bool(b.insurance_claim),
    status: oneOf(b.status, ['open', 'repaired', 'closed'], 'Durum', 'open'),
  };
}

r.post('/damages', (req, res) => {
  required(req.body, [['vehicle_id', 'Araç'], ['description', 'Açıklama']]);
  const d = damageData(req.body);
  mustGet(getDb(), 'vehicles', d.vehicle_id, 'Araç');
  if (d.rental_id) {
    const rent = mustGet(getDb(), 'rentals', d.rental_id, 'Kiralama');
    if (rent.vehicle_id !== d.vehicle_id) throw new HttpError(400, 'Kiralama bu araca ait değil');
  }
  const id = insertRow(getDb(), 'damages', d);
  res.status(201).json(mustGet(getDb(), 'damages', id));
});

r.put('/damages/:id', (req, res) => {
  const id = idParam(req);
  const old = mustGet(getDb(), 'damages', id, 'Hasar kaydı');
  updateRow(getDb(), 'damages', id, damageData({ ...old, ...req.body }));
  res.json(mustGet(getDb(), 'damages', id));
});

r.delete('/damages/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  mustGet(getDb(), 'damages', id, 'Hasar kaydı');
  getDb().prepare('DELETE FROM damages WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ================= MASRAFLAR =================

export const EXPENSE_CATEGORIES = ['Yakıt', 'Yıkama/Temizlik', 'Vergi (MTV)', 'Sigorta', 'Kasko', 'Muayene', 'Otopark', 'Personel', 'Kira', 'Diğer'];

r.get('/expenses', (req, res) => {
  const where = [];
  const params = [];
  if (str(req.query.from)) {
    where.push('e.expense_date >= ?');
    params.push(str(req.query.from));
  }
  if (str(req.query.to)) {
    where.push('e.expense_date <= ?');
    params.push(str(req.query.to));
  }
  if (str(req.query.category)) {
    where.push('e.category = ?');
    params.push(str(req.query.category));
  }
  if (str(req.query.vehicle_id)) {
    where.push('e.vehicle_id = ?');
    params.push(num(req.query.vehicle_id));
  }
  res.json(
    getDb()
      .prepare(
        `SELECT e.*, v.plate FROM expenses e LEFT JOIN vehicles v ON v.id = e.vehicle_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.expense_date DESC, e.id DESC`,
      )
      .all(...params),
  );
});

function expenseData(b) {
  return {
    vehicle_id: str(b.vehicle_id) === null ? null : num(b.vehicle_id),
    category: oneOf(b.category, EXPENSE_CATEGORIES, 'Kategori', 'Diğer'),
    amount: round2(Math.max(0, num(b.amount))),
    expense_date: normDate(b.expense_date || today(), 'Tarih'),
    description: str(b.description),
  };
}

r.post('/expenses', (req, res) => {
  required(req.body, [['amount', 'Tutar']]);
  const id = insertRow(getDb(), 'expenses', { ...expenseData(req.body), created_by: req.user.id });
  res.status(201).json(mustGet(getDb(), 'expenses', id));
});

r.put('/expenses/:id', (req, res) => {
  const id = idParam(req);
  const old = mustGet(getDb(), 'expenses', id, 'Masraf');
  updateRow(getDb(), 'expenses', id, expenseData({ ...old, ...req.body }));
  res.json(mustGet(getDb(), 'expenses', id));
});

r.delete('/expenses/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  mustGet(getDb(), 'expenses', id, 'Masraf');
  getDb().prepare('DELETE FROM expenses WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ================= GÖSTERGE PANELİ =================

r.get('/dashboard', (req, res) => {
  const db = getDb();
  const now = nowLocal();
  const t = today();
  const in30 = fmtDate(addDays(new Date(), 30));
  const monthStart = t.slice(0, 8) + '01';

  const fleet = db.prepare('SELECT status, COUNT(*) AS n FROM vehicles GROUP BY status').all();
  const fleetMap = { available: 0, rented: 0, maintenance: 0, out_of_service: 0 };
  for (const f of fleet) fleetMap[f.status] = f.n;
  const totalFleet = Object.values(fleetMap).reduce((a, b) => a + b, 0);
  const activeFleet = totalFleet - fleetMap.out_of_service;

  const pickupsToday = db
    .prepare(
      `SELECT r.id, r.code, r.pickup_at, r.status, v.plate, v.brand, v.model, c.first_name || ' ' || c.last_name AS customer_name
       FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('pending','confirmed') AND substr(r.pickup_at,1,10) <= ? ORDER BY r.pickup_at`,
    )
    .all(t);
  const returnsToday = db
    .prepare(
      `SELECT r.id, r.contract_no, r.planned_return_at, v.plate, v.brand, v.model, c.first_name || ' ' || c.last_name AS customer_name, c.phone
       FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN customers c ON c.id = r.customer_id
       WHERE r.status = 'active' AND substr(r.planned_return_at,1,10) <= ? ORDER BY r.planned_return_at`,
    )
    .all(t)
    .map((x) => ({ ...x, overdue: x.planned_return_at < now }));

  const alerts = [];
  const docs = db
    .prepare(
      `SELECT id, plate, brand, model, insurance_expiry, kasko_expiry, inspection_expiry, current_km, next_service_km
       FROM vehicles WHERE status <> 'out_of_service'`,
    )
    .all();
  const labels = { insurance_expiry: 'Trafik sigortası', kasko_expiry: 'Kasko', inspection_expiry: 'Muayene' };
  for (const v of docs) {
    for (const [k, label] of Object.entries(labels)) {
      if (v[k] && v[k] <= in30) {
        alerts.push({
          vehicle_id: v.id, plate: v.plate, level: v[k] < t ? 'danger' : 'warning',
          message: `${label} ${v[k] < t ? 'süresi dolmuş' : 'bitiyor'}: ${v[k]}`,
        });
      }
    }
    if (v.next_service_km && v.current_km >= v.next_service_km - 1000) {
      alerts.push({
        vehicle_id: v.id, plate: v.plate, level: v.current_km >= v.next_service_km ? 'danger' : 'warning',
        message: `Periyodik bakım km'si ${v.current_km >= v.next_service_km ? 'geçti' : 'yaklaşıyor'} (${v.current_km} / ${v.next_service_km})`,
      });
    }
  }

  const revenue = (from, to) => {
    const rows = db
      .prepare(`SELECT type, COALESCE(SUM(amount),0) AS t FROM payments WHERE paid_at >= ? AND paid_at <= ? AND type IN ('payment','refund') GROUP BY type`)
      .all(from, to + 'T23:59');
    let x = 0;
    for (const row of rows) x += row.type === 'payment' ? row.t : -row.t;
    return round2(x);
  };

  const receivables = db
    .prepare(
      `SELECT COALESCE(SUM(r.total_amount - COALESCE((SELECT SUM(CASE WHEN type='payment' THEN amount WHEN type='refund' THEN -amount ELSE 0 END)
        FROM payments WHERE rental_id = r.id),0)),0) AS t FROM rentals r WHERE r.status <> 'cancelled'`,
    )
    .get().t;

  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const ms = fmtDate(d).slice(0, 8) + '01';
    const me = fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const exp =
      db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE expense_date BETWEEN ? AND ?').get(ms, me).t +
      db.prepare(`SELECT COALESCE(SUM(cost),0) AS t FROM maintenance WHERE status <> 'cancelled' AND start_date BETWEEN ? AND ?`).get(ms, me).t;
    monthly.push({ month: ms.slice(0, 7), revenue: revenue(ms, me), expenses: round2(exp) });
  }

  res.json({
    fleet: { ...fleetMap, total: totalFleet, utilization: activeFleet ? Math.round((fleetMap.rented / activeFleet) * 100) : 0 },
    counts: {
      active_rentals: db.prepare("SELECT COUNT(*) AS n FROM rentals WHERE status = 'active'").get().n,
      overdue_rentals: db.prepare("SELECT COUNT(*) AS n FROM rentals WHERE status = 'active' AND planned_return_at < ?").get(now).n,
      upcoming_reservations: db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status IN ('pending','confirmed')").get().n,
      pending_reservations: db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status = 'pending'").get().n,
      customers: db.prepare('SELECT COUNT(*) AS n FROM customers').get().n,
      open_damages: db.prepare("SELECT COUNT(*) AS n FROM damages WHERE status = 'open'").get().n,
    },
    revenue: { today: revenue(t, t), month: revenue(monthStart, t) },
    receivables: round2(receivables),
    pickups_today: pickupsToday,
    returns_today: returnsToday,
    alerts,
    monthly,
  });
});

// ================= RAPORLAR =================

r.get('/reports', (req, res) => {
  const db = getDb();
  const to = normDate(req.query.to || today(), 'Bitiş');
  const from = normDate(req.query.from || to.slice(0, 8) + '01', 'Başlangıç');
  const toT = to + 'T23:59';
  const periodDays = Math.max(1, Math.round((parseDate(to) - parseDate(from)) / 86400000) + 1);

  const pay = db
    .prepare(`SELECT type, method, COALESCE(SUM(amount),0) AS t, COUNT(*) AS n FROM payments WHERE paid_at BETWEEN ? AND ? GROUP BY type, method`)
    .all(from, toT);
  let collected = 0;
  const byMethod = {};
  for (const p of pay) {
    if (p.type === 'payment') {
      collected += p.t;
      byMethod[p.method] = round2((byMethod[p.method] || 0) + p.t);
    } else if (p.type === 'refund') {
      collected -= p.t;
      byMethod[p.method] = round2((byMethod[p.method] || 0) - p.t);
    }
  }

  const rentalStats = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS billed, COALESCE(SUM(days),0) AS days,
              COALESCE(SUM(charges_amount),0) AS charges, COALESCE(SUM(extras_amount),0) AS extras
       FROM rentals WHERE status <> 'cancelled' AND pickup_at BETWEEN ? AND ?`,
    )
    .get(from, toT);

  const expenses = db
    .prepare('SELECT category, COALESCE(SUM(amount),0) AS t FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY t DESC')
    .all(from, to);
  const maintCost = db
    .prepare(`SELECT COALESCE(SUM(cost),0) AS t FROM maintenance WHERE status <> 'cancelled' AND start_date BETWEEN ? AND ?`)
    .get(from, to).t;
  const totalExpenses = round2(expenses.reduce((a, e) => a + e.t, 0) + maintCost);

  // Araç bazında: dönemle kesişen kiralama günleri (doluluk)
  const vehicles = db.prepare('SELECT id, plate, brand, model, category FROM vehicles ORDER BY plate').all();
  const periodStart = parseDate(from);
  const periodEnd = parseDate(toT);
  const byVehicle = vehicles.map((v) => {
    const rentals = db
      .prepare(
        `SELECT pickup_at, COALESCE(actual_return_at, planned_return_at) AS end_at, total_amount
         FROM rentals WHERE vehicle_id = ? AND status <> 'cancelled' AND pickup_at <= ? AND COALESCE(actual_return_at, planned_return_at) >= ?`,
      )
      .all(v.id, toT, from);
    let ms = 0;
    let revenue = 0;
    for (const rr of rentals) {
      const a = Math.max(parseDate(rr.pickup_at), periodStart);
      const b = Math.min(parseDate(rr.end_at), periodEnd);
      if (b > a) ms += b - a;
      if (rr.pickup_at >= from && rr.pickup_at <= toT) revenue += rr.total_amount;
    }
    const cost =
      db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE vehicle_id = ? AND expense_date BETWEEN ? AND ?').get(v.id, from, to).t +
      db.prepare(`SELECT COALESCE(SUM(cost),0) AS t FROM maintenance WHERE vehicle_id = ? AND status <> 'cancelled' AND start_date BETWEEN ? AND ?`).get(v.id, from, to).t;
    const rentedDays = round2(ms / 86400000);
    return {
      ...v,
      rentals: rentals.length,
      rented_days: rentedDays,
      utilization: Math.min(100, Math.round((rentedDays / periodDays) * 100)),
      revenue: round2(revenue),
      cost: round2(cost),
      profit: round2(revenue - cost),
    };
  });

  const byCategory = {};
  for (const v of byVehicle) {
    const c = (byCategory[v.category] ||= { category: v.category, vehicles: 0, revenue: 0, rented_days: 0 });
    c.vehicles += 1;
    c.revenue = round2(c.revenue + v.revenue);
    c.rented_days = round2(c.rented_days + v.rented_days);
  }

  const topCustomers = db
    .prepare(
      `SELECT c.id, c.first_name || ' ' || c.last_name AS name, COUNT(r.id) AS rentals, COALESCE(SUM(r.total_amount),0) AS total
       FROM rentals r JOIN customers c ON c.id = r.customer_id
       WHERE r.status <> 'cancelled' AND r.pickup_at BETWEEN ? AND ?
       GROUP BY c.id ORDER BY total DESC LIMIT 10`,
    )
    .all(from, toT);

  const reservationStats = db
    .prepare('SELECT status, COUNT(*) AS n FROM reservations WHERE pickup_at BETWEEN ? AND ? GROUP BY status')
    .all(from, toT);

  const fleetUtil = byVehicle.length ? Math.round(byVehicle.reduce((a, v) => a + v.utilization, 0) / byVehicle.length) : 0;

  res.json({
    from,
    to,
    period_days: periodDays,
    summary: {
      collected: round2(collected),
      billed: round2(rentalStats.billed),
      rentals: rentalStats.n,
      rented_days: rentalStats.days,
      avg_daily_revenue: rentalStats.days ? round2(rentalStats.billed / rentalStats.days) : 0,
      extras: round2(rentalStats.extras),
      charges: round2(rentalStats.charges),
      expenses: totalExpenses,
      maintenance_cost: round2(maintCost),
      net_profit: round2(collected - totalExpenses),
      fleet_utilization: fleetUtil,
    },
    by_method: byMethod,
    expenses_by_category: [...expenses.map((e) => ({ category: e.category, total: round2(e.t) })), { category: 'Bakım/Onarım', total: round2(maintCost) }],
    by_vehicle: byVehicle,
    by_category: Object.values(byCategory),
    top_customers: topCustomers,
    reservation_stats: reservationStats,
  });
});

// ================= TAKVİM =================

r.get('/calendar', (req, res) => {
  const db = getDb();
  const start = normDate(req.query.from || today(), 'Başlangıç');
  const days = Math.min(62, Math.max(1, Math.floor(num(req.query.days, 14))));
  const end = fmtDate(addDays(parseDate(start), days));
  const vehicles = db.prepare("SELECT id, plate, brand, model, category, status FROM vehicles ORDER BY category, plate").all();
  const events = [];
  const now = nowLocal();
  for (const r2 of db
    .prepare(
      `SELECT r.id, r.vehicle_id, r.code AS label, r.pickup_at AS start, r.return_at AS end, r.status,
              c.first_name || ' ' || c.last_name AS customer_name
       FROM reservations r JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('pending','confirmed') AND r.pickup_at < ? AND r.return_at > ?`,
    )
    .all(end, start)) events.push({ ...r2, kind: 'reservation' });
  for (const r2 of db
    .prepare(
      `SELECT r.id, r.vehicle_id, r.contract_no AS label, r.pickup_at AS start,
              CASE WHEN r.status = 'active' THEN MAX(r.planned_return_at, ?) ELSE r.actual_return_at END AS end,
              r.status, r.planned_return_at, c.first_name || ' ' || c.last_name AS customer_name
       FROM rentals r JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('active','completed') AND r.pickup_at < ?
         AND (CASE WHEN r.status = 'active' THEN MAX(r.planned_return_at, ?) ELSE r.actual_return_at END) > ?`,
    )
    .all(now, end, now, start)) events.push({ ...r2, kind: 'rental', overdue: r2.status === 'active' && r2.planned_return_at < now });
  for (const m of db
    .prepare(
      `SELECT id, vehicle_id, type AS label, start_date || 'T00:00' AS start,
              COALESCE(NULLIF(end_date,''), CASE WHEN status = 'in_progress' THEN ? ELSE start_date END) || 'T23:59' AS end, status
       FROM maintenance WHERE status IN ('scheduled','in_progress','completed') AND start_date < ?`,
    )
    .all(end, end)) if (m.end > start) events.push({ ...m, kind: 'maintenance' });
  res.json({ from: start, days, vehicles, events });
});

export default r;
