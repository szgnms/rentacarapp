import { Router } from 'express';
import { getDb, tx, num } from '../db.js';
import { requireAdmin } from '../auth.js';
import {
  HttpError, calcQuote, assertAvailable, assertCustomerOk, normDateTime, nowLocal, makeCode, round2,
  paymentTotals, recalcRental, rentalFinance, calcCheckin, CHARGE_TYPES, today,
} from '../services.js';
import { str, required, oneOf, idParam, mustGet, insertRow, updateRow } from './util.js';

const r = Router();

const branchId = (v) => (str(v) === null ? null : num(v));

function parseExtras(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && num(x.extra_id) > 0 && num(x.quantity, 1) > 0)
    .map((x) => ({ extra_id: num(x.extra_id), quantity: Math.floor(num(x.quantity, 1)) }));
}

// ---------- Fiyat teklifi ----------
r.post('/quote', (req, res) => {
  const vehicle = mustGet(getDb(), 'vehicles', num(req.body.vehicle_id), 'Araç');
  const pickup = normDateTime(req.body.pickup_at, 'Alış tarihi');
  const ret = normDateTime(req.body.return_at, 'Dönüş tarihi');
  const quote = calcQuote({ ...req.body, vehicle, pickup_at: pickup, return_at: ret, extras: parseExtras(req.body.extras) });
  res.json(quote);
});

// ================= REZERVASYONLAR =================

const RES_SELECT = `
  SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
         v.plate, v.brand, v.model, v.category,
         pb.name AS pickup_branch_name, rb.name AS return_branch_name,
         (SELECT id FROM rentals WHERE reservation_id = r.id LIMIT 1) AS rental_id
  FROM reservations r
  JOIN customers c ON c.id = r.customer_id
  JOIN vehicles v ON v.id = r.vehicle_id
  LEFT JOIN branches pb ON pb.id = r.pickup_branch_id
  LEFT JOIN branches rb ON rb.id = r.return_branch_id`;

r.get('/reservations', (req, res) => {
  const where = [];
  const params = [];
  if (str(req.query.status)) {
    where.push('r.status = ?');
    params.push(str(req.query.status));
  }
  if (str(req.query.from)) {
    where.push('r.pickup_at >= ?');
    params.push(str(req.query.from));
  }
  if (str(req.query.to)) {
    where.push('r.pickup_at <= ?');
    params.push(str(req.query.to) + 'T23:59');
  }
  if (str(req.query.q)) {
    const q = `%${str(req.query.q)}%`;
    where.push(`(r.code LIKE ? OR c.first_name || ' ' || c.last_name LIKE ? OR v.plate LIKE ?)`);
    params.push(q, q, q);
  }
  if (str(req.query.customer_id)) {
    where.push('r.customer_id = ?');
    params.push(num(req.query.customer_id));
  }
  const rows = getDb()
    .prepare(`${RES_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.pickup_at DESC LIMIT 500`)
    .all(...params);
  res.json(rows);
});

function loadReservation(id) {
  const db = getDb();
  const row = db.prepare(`${RES_SELECT} WHERE r.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Rezervasyon bulunamadı');
  row.extras = db.prepare('SELECT * FROM reservation_extras WHERE reservation_id = ?').all(id);
  row.payments = db.prepare('SELECT * FROM payments WHERE reservation_id = ? ORDER BY paid_at').all(id);
  row.finance = paymentTotals('reservation_id', id);
  return row;
}

r.get('/reservations/:id', (req, res) => res.json(loadReservation(idParam(req))));

function buildReservation(body, existing) {
  const db = getDb();
  const customerId = num(body.customer_id ?? existing?.customer_id);
  const vehicleId = num(body.vehicle_id ?? existing?.vehicle_id);
  const pickup = normDateTime(body.pickup_at ?? existing?.pickup_at, 'Alış tarihi');
  const ret = normDateTime(body.return_at ?? existing?.return_at, 'Dönüş tarihi');
  if (ret <= pickup) throw new HttpError(400, 'Dönüş tarihi alış tarihinden sonra olmalıdır');
  if (!existing && pickup.slice(0, 10) < today()) throw new HttpError(400, 'Geçmiş tarihli rezervasyon oluşturulamaz');
  const vehicle = mustGet(db, 'vehicles', vehicleId, 'Araç');
  assertCustomerOk(customerId, pickup);
  assertAvailable(vehicleId, pickup, ret, { excludeReservationId: existing?.id || 0 });
  const quote = calcQuote({
    vehicle,
    pickup_at: pickup,
    return_at: ret,
    extras: parseExtras(body.extras),
    discount: body.discount,
    daily_rate: body.daily_rate,
    pickup_branch_id: branchId(body.pickup_branch_id),
    return_branch_id: branchId(body.return_branch_id),
  });
  const data = {
    customer_id: customerId,
    vehicle_id: vehicleId,
    pickup_branch_id: branchId(body.pickup_branch_id),
    return_branch_id: branchId(body.return_branch_id ?? body.pickup_branch_id),
    pickup_at: pickup,
    return_at: ret,
    days: quote.days,
    daily_rate: quote.daily_rate,
    base_amount: quote.base_amount,
    long_term_discount: quote.long_term_discount,
    extras_amount: quote.extras_amount,
    one_way_fee: quote.one_way_fee,
    discount: quote.discount,
    total_amount: quote.total_amount,
    deposit_amount: str(body.deposit_amount) === null ? quote.deposit_amount : Math.max(0, num(body.deposit_amount)),
    source: str(body.source) || 'Ofis',
    notes: str(body.notes),
  };
  return { data, quote };
}

function saveReservationExtras(resId, lines) {
  const db = getDb();
  db.prepare('DELETE FROM reservation_extras WHERE reservation_id = ?').run(resId);
  const ins = db.prepare('INSERT INTO reservation_extras(reservation_id, extra_id, name, quantity, amount) VALUES (?,?,?,?,?)');
  for (const l of lines) ins.run(resId, l.extra_id, l.name, l.quantity, l.amount);
}

r.post('/reservations', (req, res) => {
  required(req.body, [['customer_id', 'Müşteri'], ['vehicle_id', 'Araç'], ['pickup_at', 'Alış tarihi'], ['return_at', 'Dönüş tarihi']]);
  const id = tx(() => {
    const { data, quote } = buildReservation(req.body);
    data.status = oneOf(req.body.status, ['pending', 'confirmed'], 'Durum', 'confirmed');
    data.code = `TMP-${Date.now()}-${Math.random()}`;
    data.created_by = req.user.id;
    const newId = insertRow(getDb(), 'reservations', data);
    getDb().prepare('UPDATE reservations SET code = ? WHERE id = ?').run(makeCode('RZ', newId), newId);
    saveReservationExtras(newId, quote.extras);
    // Ön ödeme
    const pre = num(req.body.prepayment);
    if (pre > 0) {
      insertRow(getDb(), 'payments', {
        customer_id: data.customer_id,
        reservation_id: newId,
        type: 'payment',
        method: oneOf(req.body.prepayment_method, ['cash', 'credit_card', 'bank_transfer'], 'Ödeme yöntemi', 'credit_card'),
        amount: round2(pre),
        paid_at: nowLocal(),
        description: 'Rezervasyon ön ödemesi',
        created_by: req.user.id,
      });
    }
    return newId;
  });
  res.status(201).json(loadReservation(id));
});

r.put('/reservations/:id', (req, res) => {
  const id = idParam(req);
  const existing = mustGet(getDb(), 'reservations', id, 'Rezervasyon');
  if (!['pending', 'confirmed'].includes(existing.status)) throw new HttpError(409, 'Yalnızca bekleyen veya onaylı rezervasyonlar düzenlenebilir');
  tx(() => {
    const extras = req.body.extras ?? getDb().prepare('SELECT extra_id, quantity FROM reservation_extras WHERE reservation_id = ?').all(id);
    const body = {
      discount: existing.discount,
      daily_rate: existing.daily_rate,
      pickup_branch_id: existing.pickup_branch_id,
      return_branch_id: existing.return_branch_id,
      deposit_amount: existing.deposit_amount,
      source: existing.source,
      notes: existing.notes,
      ...req.body,
      extras,
    };
    if (req.body.vehicle_id && num(req.body.vehicle_id) !== existing.vehicle_id && req.body.daily_rate === undefined) {
      body.daily_rate = null; // yeni aracın liste fiyatı
    }
    const { data, quote } = buildReservation(body, existing);
    updateRow(getDb(), 'reservations', id, data);
    saveReservationExtras(id, quote.extras);
    getDb().prepare('UPDATE payments SET customer_id = ? WHERE reservation_id = ?').run(data.customer_id, id);
  });
  res.json(loadReservation(id));
});

function transition(id, from, to, extra = {}) {
  const row = mustGet(getDb(), 'reservations', id, 'Rezervasyon');
  if (!from.includes(row.status)) throw new HttpError(409, `Bu işlem "${row.status}" durumundaki rezervasyona uygulanamaz`);
  updateRow(getDb(), 'reservations', id, { status: to, ...extra });
}

r.post('/reservations/:id/confirm', (req, res) => {
  const id = idParam(req);
  transition(id, ['pending'], 'confirmed');
  res.json(loadReservation(id));
});

r.post('/reservations/:id/cancel', (req, res) => {
  const id = idParam(req);
  transition(id, ['pending', 'confirmed'], 'cancelled', { cancel_reason: str(req.body.reason) });
  res.json(loadReservation(id));
});

r.post('/reservations/:id/no-show', (req, res) => {
  const id = idParam(req);
  transition(id, ['pending', 'confirmed'], 'no_show', { cancel_reason: str(req.body.reason) || 'Müşteri gelmedi' });
  res.json(loadReservation(id));
});

// ================= KİRALAMALAR (SÖZLEŞMELER) =================

const RENTAL_SELECT = `
  SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
         v.plate, v.brand, v.model, v.category,
         pb.name AS pickup_branch_name, rb.name AS return_branch_name,
         res.code AS reservation_code
  FROM rentals r
  JOIN customers c ON c.id = r.customer_id
  JOIN vehicles v ON v.id = r.vehicle_id
  LEFT JOIN branches pb ON pb.id = r.pickup_branch_id
  LEFT JOIN branches rb ON rb.id = r.return_branch_id
  LEFT JOIN reservations res ON res.id = r.reservation_id`;

r.get('/rentals', (req, res) => {
  const where = [];
  const params = [];
  const status = str(req.query.status);
  if (status === 'overdue') {
    where.push("r.status = 'active' AND r.planned_return_at < ?");
    params.push(nowLocal());
  } else if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  if (str(req.query.q)) {
    const q = `%${str(req.query.q)}%`;
    where.push(`(r.contract_no LIKE ? OR c.first_name || ' ' || c.last_name LIKE ? OR v.plate LIKE ?)`);
    params.push(q, q, q);
  }
  if (str(req.query.from)) {
    where.push('r.pickup_at >= ?');
    params.push(str(req.query.from));
  }
  if (str(req.query.to)) {
    where.push('r.pickup_at <= ?');
    params.push(str(req.query.to) + 'T23:59');
  }
  const rows = getDb()
    .prepare(`${RENTAL_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.pickup_at DESC LIMIT 500`)
    .all(...params);
  const now = nowLocal();
  for (const row of rows) {
    const f = rentalFinance(row);
    row.paid = f.paid;
    row.balance = row.status === 'cancelled' ? 0 : f.balance;
    row.overdue = row.status === 'active' && row.planned_return_at < now;
  }
  res.json(rows);
});

function loadRental(id) {
  const db = getDb();
  const row = db.prepare(`${RENTAL_SELECT} WHERE r.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Kiralama bulunamadı');
  row.customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(row.customer_id);
  row.vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(row.vehicle_id);
  row.extras = db.prepare('SELECT * FROM rental_extras WHERE rental_id = ?').all(id);
  row.charges = db.prepare('SELECT * FROM rental_charges WHERE rental_id = ? ORDER BY id').all(id);
  row.payments = db.prepare('SELECT * FROM payments WHERE rental_id = ? ORDER BY paid_at, id').all(id);
  row.damages = db.prepare('SELECT * FROM damages WHERE rental_id = ?').all(id);
  row.finance = rentalFinance(row);
  row.overdue = row.status === 'active' && row.planned_return_at < nowLocal();
  return row;
}

r.get('/rentals/:id', (req, res) => res.json(loadRental(idParam(req))));

function validateCheckoutInputs(body, vehicle) {
  const startKm = str(body.start_km) === null ? vehicle.current_km : Math.floor(num(body.start_km));
  if (startKm < vehicle.current_km) throw new HttpError(400, `Çıkış km (${startKm}) aracın mevcut km'sinden (${vehicle.current_km}) küçük olamaz`);
  const startFuel = str(body.start_fuel) === null ? 8 : Math.floor(num(body.start_fuel));
  if (!(startFuel >= 0 && startFuel <= 8)) throw new HttpError(400, 'Yakıt seviyesi 0-8 arası olmalıdır');
  if (vehicle.status !== 'available') {
    const labels = { rented: 'kirada', maintenance: 'bakımda', out_of_service: 'hizmet dışı' };
    throw new HttpError(409, `Araç şu anda ${labels[vehicle.status] || vehicle.status}; teslim edilemez`);
  }
  return { startKm, startFuel };
}

function afterCheckout(rentalId, body, customerId, vehicleId, startKm, userId) {
  const db = getDb();
  db.prepare("UPDATE vehicles SET status = 'rented', current_km = ? WHERE id = ?").run(startKm, vehicleId);
  const rental = db.prepare('SELECT * FROM rentals WHERE id = ?').get(rentalId);
  if (num(body.deposit_collected) > 0) {
    insertRow(db, 'payments', {
      customer_id: customerId,
      rental_id: rentalId,
      type: 'deposit_in',
      method: oneOf(body.deposit_method, ['cash', 'credit_card', 'bank_transfer'], 'Depozito yöntemi', 'credit_card'),
      amount: round2(num(body.deposit_collected)),
      paid_at: rental.pickup_at,
      description: 'Teslimde alınan depozito',
      created_by: userId,
    });
  }
  if (num(body.payment_amount) > 0) {
    insertRow(db, 'payments', {
      customer_id: customerId,
      rental_id: rentalId,
      type: 'payment',
      method: oneOf(body.payment_method, ['cash', 'credit_card', 'bank_transfer'], 'Ödeme yöntemi', 'credit_card'),
      amount: round2(num(body.payment_amount)),
      paid_at: rental.pickup_at,
      description: 'Teslimde tahsilat',
      created_by: userId,
    });
  }
}

function insertRental(data, extras) {
  const db = getDb();
  data.contract_no = `TMP-${Date.now()}-${Math.random()}`;
  const id = insertRow(db, 'rentals', data);
  db.prepare('UPDATE rentals SET contract_no = ? WHERE id = ?').run(makeCode('KS', id), id);
  const ins = db.prepare('INSERT INTO rental_extras(rental_id, extra_id, name, quantity, amount) VALUES (?,?,?,?,?)');
  for (const l of extras) ins.run(id, l.extra_id, l.name, l.quantity, l.amount);
  return id;
}

/** Rezervasyondan teslim (check-out). */
r.post('/reservations/:id/checkout', (req, res) => {
  const resId = idParam(req);
  const id = tx(() => {
    const db = getDb();
    const rsv = mustGet(db, 'reservations', resId, 'Rezervasyon');
    if (!['pending', 'confirmed'].includes(rsv.status)) throw new HttpError(409, 'Yalnızca bekleyen/onaylı rezervasyon teslim edilebilir');
    const vehicleId = num(req.body.vehicle_id) || rsv.vehicle_id;
    const vehicle = mustGet(db, 'vehicles', vehicleId, 'Araç');
    const pickup = normDateTime(req.body.pickup_at || nowLocal(), 'Teslim tarihi');
    if (pickup >= rsv.return_at) throw new HttpError(400, 'Teslim zamanı planlanan dönüşten önce olmalıdır');
    assertCustomerOk(rsv.customer_id, pickup, { strict: true });
    const { startKm, startFuel } = validateCheckoutInputs(req.body, vehicle);
    assertAvailable(vehicleId, pickup, rsv.return_at, { excludeReservationId: rsv.id });
    const extras = db.prepare('SELECT extra_id, name, quantity, amount FROM reservation_extras WHERE reservation_id = ?').all(rsv.id);
    const rentalId = insertRental(
      {
        reservation_id: rsv.id,
        customer_id: rsv.customer_id,
        vehicle_id: vehicleId,
        pickup_branch_id: rsv.pickup_branch_id,
        return_branch_id: rsv.return_branch_id,
        pickup_at: pickup,
        planned_return_at: rsv.return_at,
        start_km: startKm,
        start_fuel: startFuel,
        days: rsv.days,
        daily_rate: rsv.daily_rate,
        base_amount: rsv.base_amount,
        long_term_discount: rsv.long_term_discount,
        extras_amount: rsv.extras_amount,
        one_way_fee: rsv.one_way_fee,
        discount: rsv.discount,
        total_amount: rsv.total_amount,
        deposit_amount: str(req.body.deposit_amount) === null ? rsv.deposit_amount : num(req.body.deposit_amount),
        additional_driver: str(req.body.additional_driver),
        checkout_notes: str(req.body.checkout_notes),
        created_by: req.user.id,
      },
      extras,
    );
    db.prepare("UPDATE reservations SET status = 'converted' WHERE id = ?").run(rsv.id);
    db.prepare('UPDATE payments SET rental_id = ? WHERE reservation_id = ?').run(rentalId, rsv.id);
    afterCheckout(rentalId, req.body, rsv.customer_id, vehicleId, startKm, req.user.id);
    recalcRental(rentalId);
    return rentalId;
  });
  res.status(201).json(loadRental(id));
});

/** Rezervasyonsuz (kapıdan) kiralama. */
r.post('/rentals', (req, res) => {
  required(req.body, [['customer_id', 'Müşteri'], ['vehicle_id', 'Araç'], ['return_at', 'Dönüş tarihi']]);
  const id = tx(() => {
    const db = getDb();
    const vehicle = mustGet(db, 'vehicles', num(req.body.vehicle_id), 'Araç');
    const pickup = normDateTime(req.body.pickup_at || nowLocal(), 'Teslim tarihi');
    const ret = normDateTime(req.body.return_at, 'Dönüş tarihi');
    if (ret <= pickup) throw new HttpError(400, 'Dönüş tarihi teslim tarihinden sonra olmalıdır');
    assertCustomerOk(req.body.customer_id, pickup, { strict: true });
    const { startKm, startFuel } = validateCheckoutInputs(req.body, vehicle);
    assertAvailable(vehicle.id, pickup, ret);
    const pb = branchId(req.body.pickup_branch_id) ?? vehicle.branch_id;
    const rb = branchId(req.body.return_branch_id) ?? pb;
    const q = calcQuote({
      vehicle, pickup_at: pickup, return_at: ret, extras: parseExtras(req.body.extras),
      discount: req.body.discount, daily_rate: req.body.daily_rate, pickup_branch_id: pb, return_branch_id: rb,
    });
    const rentalId = insertRental(
      {
        customer_id: num(req.body.customer_id),
        vehicle_id: vehicle.id,
        pickup_branch_id: pb,
        return_branch_id: rb,
        pickup_at: pickup,
        planned_return_at: ret,
        start_km: startKm,
        start_fuel: startFuel,
        days: q.days,
        daily_rate: q.daily_rate,
        base_amount: q.base_amount,
        long_term_discount: q.long_term_discount,
        extras_amount: q.extras_amount,
        one_way_fee: q.one_way_fee,
        discount: q.discount,
        total_amount: q.total_amount,
        deposit_amount: str(req.body.deposit_amount) === null ? q.deposit_amount : num(req.body.deposit_amount),
        additional_driver: str(req.body.additional_driver),
        checkout_notes: str(req.body.checkout_notes),
        created_by: req.user.id,
      },
      q.extras,
    );
    afterCheckout(rentalId, req.body, num(req.body.customer_id), vehicle.id, startKm, req.user.id);
    recalcRental(rentalId);
    return rentalId;
  });
  res.status(201).json(loadRental(id));
});

function activeRental(id) {
  const rental = mustGet(getDb(), 'rentals', id, 'Kiralama');
  if (rental.status !== 'active') throw new HttpError(409, 'Kiralama aktif değil');
  return rental;
}

/** Süre uzatma. */
r.post('/rentals/:id/extend', (req, res) => {
  const id = idParam(req);
  tx(() => {
    const db = getDb();
    const rental = activeRental(id);
    const newReturn = normDateTime(req.body.return_at, 'Yeni dönüş tarihi');
    if (newReturn <= rental.planned_return_at) throw new HttpError(400, 'Yeni dönüş tarihi mevcut dönüş tarihinden sonra olmalıdır');
    assertAvailable(rental.vehicle_id, rental.pickup_at, newReturn, { excludeRentalId: id });
    const vehicle = mustGet(db, 'vehicles', rental.vehicle_id);
    const extras = db.prepare('SELECT extra_id, quantity FROM rental_extras WHERE rental_id = ?').all(id);
    const q = calcQuote({
      vehicle, pickup_at: rental.pickup_at, return_at: newReturn, extras,
      discount: rental.discount, daily_rate: req.body.daily_rate ?? rental.daily_rate,
      pickup_branch_id: rental.pickup_branch_id, return_branch_id: rental.return_branch_id,
    });
    updateRow(db, 'rentals', id, {
      planned_return_at: newReturn,
      days: q.days,
      daily_rate: q.daily_rate,
      base_amount: q.base_amount,
      long_term_discount: q.long_term_discount,
      extras_amount: q.extras_amount,
    });
    db.prepare('DELETE FROM rental_extras WHERE rental_id = ?').run(id);
    const ins = db.prepare('INSERT INTO rental_extras(rental_id, extra_id, name, quantity, amount) VALUES (?,?,?,?,?)');
    for (const l of q.extras) ins.run(id, l.extra_id, l.name, l.quantity, l.amount);
    recalcRental(id);
  });
  res.json(loadRental(id));
});

/** İade ön izleme: otomatik ek ücretleri hesaplar, kaydetmez. */
r.post('/rentals/:id/checkin/preview', (req, res) => {
  const id = idParam(req);
  const rental = activeRental(id);
  const vehicle = mustGet(getDb(), 'vehicles', rental.vehicle_id);
  res.json(calcCheckin(rental, vehicle, req.body));
});

/** İade (check-in). */
r.post('/rentals/:id/checkin', (req, res) => {
  const id = idParam(req);
  const result = tx(() => {
    const db = getDb();
    const rental = activeRental(id);
    const vehicle = mustGet(db, 'vehicles', rental.vehicle_id);
    const calc = calcCheckin(rental, vehicle, req.body);
    const now = nowLocal();

    for (const c of calc.charges) {
      insertRow(db, 'rental_charges', { rental_id: id, type: c.type, description: c.description, amount: c.amount });
    }
    for (const d of calc.damages) {
      insertRow(db, 'damages', { vehicle_id: vehicle.id, rental_id: id, reported_at: calc.actual_return_at.slice(0, 10), ...d, status: 'open' });
    }
    const returnBranch = branchId(req.body.return_branch_id) ?? rental.return_branch_id;
    updateRow(db, 'rentals', id, {
      actual_return_at: calc.actual_return_at,
      end_km: calc.end_km,
      end_fuel: calc.end_fuel,
      return_branch_id: returnBranch,
      checkin_notes: str(req.body.checkin_notes),
      status: 'completed',
      closed_by: req.user.id,
    });
    recalcRental(id);

    const toMaintenance = req.body.send_to_maintenance === true || req.body.send_to_maintenance === 'true';
    db.prepare('UPDATE vehicles SET current_km = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ?').run(
      calc.end_km, toMaintenance ? 'maintenance' : 'available', returnBranch, vehicle.id,
    );
    if (toMaintenance) {
      insertRow(db, 'maintenance', {
        vehicle_id: vehicle.id,
        type: calc.damages.length ? 'damage_repair' : 'other',
        description: str(req.body.maintenance_note) || `İade sonrası bakım (${rental.contract_no})`,
        start_date: today(),
        km: calc.end_km,
        status: 'in_progress',
      });
    }

    // Tahsilat
    if (num(req.body.payment_amount) > 0) {
      insertRow(db, 'payments', {
        customer_id: rental.customer_id, rental_id: id, type: 'payment',
        method: oneOf(req.body.payment_method, ['cash', 'credit_card', 'bank_transfer'], 'Ödeme yöntemi', 'credit_card'),
        amount: round2(num(req.body.payment_amount)), paid_at: now, description: 'İadede tahsilat', created_by: req.user.id,
      });
    }

    // Depozito işlemi
    const fin = rentalFinance(db.prepare('SELECT * FROM rentals WHERE id = ?').get(id));
    const action = oneOf(req.body.deposit_action, ['none', 'return', 'offset'], 'Depozito işlemi', 'none');
    if (fin.deposit_held > 0 && action !== 'none') {
      let remaining = fin.deposit_held;
      if (action === 'offset' && fin.balance > 0) {
        const use = round2(Math.min(remaining, fin.balance));
        insertRow(db, 'payments', {
          customer_id: rental.customer_id, rental_id: id, type: 'deposit_out', method: 'deposit',
          amount: use, paid_at: now, description: 'Depozitodan bakiyeye mahsup', created_by: req.user.id,
        });
        insertRow(db, 'payments', {
          customer_id: rental.customer_id, rental_id: id, type: 'payment', method: 'deposit',
          amount: use, paid_at: now, description: 'Depozitodan mahsup', created_by: req.user.id,
        });
        remaining = round2(remaining - use);
      }
      if (remaining > 0) {
        const lastIn = db.prepare("SELECT method FROM payments WHERE rental_id = ? AND type = 'deposit_in' ORDER BY id DESC").get(id);
        insertRow(db, 'payments', {
          customer_id: rental.customer_id, rental_id: id, type: 'deposit_out', method: lastIn?.method || 'cash',
          amount: remaining, paid_at: now, description: 'Depozito iadesi', created_by: req.user.id,
        });
      }
    }
    return id;
  });
  res.json(loadRental(result));
});

r.post('/rentals/:id/cancel', requireAdmin, (req, res) => {
  const id = idParam(req);
  tx(() => {
    const rental = activeRental(id);
    updateRow(getDb(), 'rentals', id, { status: 'cancelled', checkin_notes: str(req.body.reason) || 'İptal edildi', closed_by: req.user.id });
    getDb().prepare("UPDATE vehicles SET status = 'available' WHERE id = ? AND status = 'rented'").run(rental.vehicle_id);
  });
  res.json(loadRental(id));
});

// Ek ücretler (ör. sonradan gelen trafik cezası, HGS)
r.post('/rentals/:id/charges', (req, res) => {
  const id = idParam(req);
  const rental = mustGet(getDb(), 'rentals', id, 'Kiralama');
  if (rental.status === 'cancelled') throw new HttpError(409, 'İptal edilmiş kiralamaya ücret eklenemez');
  const amount = round2(num(req.body.amount));
  if (!(amount > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalıdır');
  tx(() => {
    insertRow(getDb(), 'rental_charges', {
      rental_id: id, type: oneOf(req.body.type, CHARGE_TYPES, 'Ücret tipi', 'other'), description: str(req.body.description), amount,
    });
    recalcRental(id);
  });
  res.status(201).json(loadRental(id));
});

r.delete('/rentals/:id/charges/:chargeId', requireAdmin, (req, res) => {
  const id = idParam(req);
  tx(() => {
    getDb().prepare('DELETE FROM rental_charges WHERE id = ? AND rental_id = ?').run(num(req.params.chargeId), id);
    recalcRental(id);
  });
  res.json(loadRental(id));
});

// ================= ÖDEMELER =================

r.get('/payments', (req, res) => {
  const where = [];
  const params = [];
  if (str(req.query.from)) {
    where.push('p.paid_at >= ?');
    params.push(str(req.query.from));
  }
  if (str(req.query.to)) {
    where.push('p.paid_at <= ?');
    params.push(str(req.query.to) + 'T23:59');
  }
  for (const f of ['type', 'method']) {
    if (str(req.query[f])) {
      where.push(`p.${f} = ?`);
      params.push(str(req.query[f]));
    }
  }
  const rows = getDb()
    .prepare(
      `SELECT p.*, c.first_name || ' ' || c.last_name AS customer_name, r.contract_no, res.code AS reservation_code,
              u.full_name AS created_by_name
       FROM payments p JOIN customers c ON c.id = p.customer_id
       LEFT JOIN rentals r ON r.id = p.rental_id
       LEFT JOIN reservations res ON res.id = p.reservation_id
       LEFT JOIN users u ON u.id = p.created_by
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.paid_at DESC, p.id DESC LIMIT 1000`,
    )
    .all(...params);
  res.json(rows);
});

r.post('/payments', (req, res) => {
  const db = getDb();
  const amount = round2(num(req.body.amount));
  if (!(amount > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalıdır');
  const type = oneOf(req.body.type, ['payment', 'refund', 'deposit_in', 'deposit_out'], 'İşlem tipi', 'payment');
  let customerId = num(req.body.customer_id);
  let rentalId = null;
  let reservationId = null;
  if (num(req.body.rental_id)) {
    const rental = mustGet(db, 'rentals', num(req.body.rental_id), 'Kiralama');
    rentalId = rental.id;
    customerId = rental.customer_id;
    const fin = rentalFinance(rental);
    if (type === 'deposit_out' && amount > fin.deposit_held + 0.001) throw new HttpError(400, `İade edilebilir depozito: ${fin.deposit_held}`);
    if (type === 'refund' && amount > fin.paid + 0.001) throw new HttpError(400, `İade tutarı ödenen tutarı (${fin.paid}) aşamaz`);
  } else if (num(req.body.reservation_id)) {
    const rsv = mustGet(db, 'reservations', num(req.body.reservation_id), 'Rezervasyon');
    reservationId = rsv.id;
    customerId = rsv.customer_id;
    if (['deposit_in', 'deposit_out'].includes(type)) throw new HttpError(400, 'Depozito işlemleri kiralama üzerinden yapılır');
    if (type === 'refund' && amount > paymentTotals('reservation_id', rsv.id).paid + 0.001) {
      throw new HttpError(400, 'İade tutarı ödenen tutarı aşamaz');
    }
  } else {
    throw new HttpError(400, 'Ödeme bir kiralama veya rezervasyona bağlı olmalıdır');
  }
  const id = insertRow(db, 'payments', {
    customer_id: customerId,
    rental_id: rentalId,
    reservation_id: reservationId,
    type,
    method: oneOf(req.body.method, ['cash', 'credit_card', 'bank_transfer'], 'Ödeme yöntemi', 'cash'),
    amount,
    paid_at: normDateTime(req.body.paid_at || nowLocal(), 'Ödeme tarihi'),
    description: str(req.body.description),
    created_by: req.user.id,
  });
  res.status(201).json(mustGet(db, 'payments', id));
});

r.delete('/payments/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  mustGet(getDb(), 'payments', id, 'Ödeme');
  getDb().prepare('DELETE FROM payments WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default r;
