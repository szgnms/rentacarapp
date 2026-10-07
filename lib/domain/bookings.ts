import { all, insertRow, one, run, tx, updateRow } from '../db';
import {
  HttpError, makeCode, mustGet, normDateTime, nowLocal, num, oneOf, optId, required, round2, str, today,
} from '../core';
import {
  CHARGE_TYPES, assertAvailable, assertCustomerOk, calcCheckin, calcQuote, parseExtras, paymentTotals, recalcRental,
  rentalFinance, type CheckinCalc,
} from '../rules';
import type {
  Body, BookingJoin, Customer, Damage, Finance, LineItem, Payment, PaymentMethod, Quote, Rental, RentalCharge,
  RentalFinance, Reservation, SessionUser, Vehicle,
} from '../types';

const METHODS = ['cash', 'credit_card', 'bank_transfer'] as const satisfies readonly PaymentMethod[];

// ---------- Fiyat teklifi ----------
export function quote(b: Body): Quote {
  const vehicle = mustGet<Vehicle>('vehicles', num(b.vehicle_id), 'Araç');
  return calcQuote({
    vehicle,
    pickup_at: normDateTime(b.pickup_at, 'Alış tarihi'),
    return_at: normDateTime(b.return_at, 'Dönüş tarihi'),
    extras: parseExtras(b.extras),
    discount: b.discount,
    daily_rate: b.daily_rate,
    pickup_branch_id: optId(b.pickup_branch_id),
    return_branch_id: optId(b.return_branch_id),
  });
}

function filterSql(f: Record<string, string | undefined>, dateCol: string, searchCols: string[]) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.from)) {
    where.push(`${dateCol} >= ?`);
    params.push(str(f.from)!);
  }
  if (str(f.to)) {
    where.push(`${dateCol} <= ?`);
    params.push(str(f.to) + 'T23:59');
  }
  if (str(f.q)) {
    where.push(`(${searchCols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
    params.push(...searchCols.map(() => `%${str(f.q)}%`));
  }
  return { where, params };
}

// ================= REZERVASYONLAR =================

export type ReservationRow = Reservation & BookingJoin & { rental_id: number | null };
export type ReservationDetail = ReservationRow & { extras: LineItem[]; payments: Payment[]; finance: Finance };

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

export function listReservations(f: Record<string, string | undefined> = {}): ReservationRow[] {
  const { where, params } = filterSql(f, 'r.pickup_at', ['r.code', "c.first_name || ' ' || c.last_name", 'v.plate']);
  if (str(f.status)) {
    where.push('r.status = ?');
    params.push(str(f.status)!);
  }
  if (str(f.customer_id)) {
    where.push('r.customer_id = ?');
    params.push(num(f.customer_id));
  }
  return all<ReservationRow>(`${RES_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.pickup_at DESC LIMIT 500`, ...params);
}

export function getReservation(id: number): ReservationDetail {
  const row = one<ReservationRow>(`${RES_SELECT} WHERE r.id = ?`, id);
  if (!row) throw new HttpError(404, 'Rezervasyon bulunamadı');
  return {
    ...row,
    extras: all<LineItem>('SELECT * FROM reservation_extras WHERE reservation_id = ?', id),
    payments: all<Payment>('SELECT * FROM payments WHERE reservation_id = ? ORDER BY paid_at', id),
    finance: paymentTotals('reservation_id', id),
  };
}

function buildReservation(b: Body, existing?: Reservation) {
  const customerId = num(b.customer_id ?? existing?.customer_id);
  const vehicleId = num(b.vehicle_id ?? existing?.vehicle_id);
  const pickup = normDateTime(b.pickup_at ?? existing?.pickup_at, 'Alış tarihi');
  const ret = normDateTime(b.return_at ?? existing?.return_at, 'Dönüş tarihi');
  if (ret <= pickup) throw new HttpError(400, 'Dönüş tarihi alış tarihinden sonra olmalıdır');
  if (!existing && pickup.slice(0, 10) < today()) throw new HttpError(400, 'Geçmiş tarihli rezervasyon oluşturulamaz');
  const vehicle = mustGet<Vehicle>('vehicles', vehicleId, 'Araç');
  assertCustomerOk(customerId, pickup);
  assertAvailable(vehicleId, pickup, ret, { excludeReservationId: existing?.id || 0 });
  const pb = optId(b.pickup_branch_id);
  const rb = optId(b.return_branch_id ?? b.pickup_branch_id);
  const q = calcQuote({
    vehicle, pickup_at: pickup, return_at: ret, extras: parseExtras(b.extras), discount: b.discount, daily_rate: b.daily_rate,
    pickup_branch_id: pb, return_branch_id: rb,
  });
  const data = {
    customer_id: customerId,
    vehicle_id: vehicleId,
    pickup_branch_id: pb,
    return_branch_id: rb,
    pickup_at: pickup,
    return_at: ret,
    days: q.days,
    daily_rate: q.daily_rate,
    base_amount: q.base_amount,
    long_term_discount: q.long_term_discount,
    extras_amount: q.extras_amount,
    one_way_fee: q.one_way_fee,
    discount: q.discount,
    total_amount: q.total_amount,
    deposit_amount: str(b.deposit_amount) === null ? q.deposit_amount : Math.max(0, num(b.deposit_amount)),
    source: str(b.source) || 'Ofis',
    notes: str(b.notes),
  };
  return { data, quote: q };
}

function saveLines(table: 'reservation_extras' | 'rental_extras', fk: 'reservation_id' | 'rental_id', id: number, lines: LineItem[]) {
  run(`DELETE FROM ${table} WHERE ${fk} = ?`, id);
  for (const l of lines) insertRow(table, { [fk]: id, extra_id: l.extra_id, name: l.name, quantity: l.quantity, amount: l.amount });
}

export function createReservation(b: Body, user: SessionUser): ReservationDetail {
  required(b, [['customer_id', 'Müşteri'], ['vehicle_id', 'Araç'], ['pickup_at', 'Alış tarihi'], ['return_at', 'Dönüş tarihi']]);
  const id = tx(() => {
    const { data, quote: q } = buildReservation(b);
    const newId = insertRow('reservations', {
      ...data,
      status: oneOf(b.status, ['pending', 'confirmed'] as const, 'Durum', 'confirmed'),
      code: `TMP-${Date.now()}-${Math.random()}`,
      created_by: user.id,
    });
    run('UPDATE reservations SET code = ? WHERE id = ?', makeCode('RZ', newId), newId);
    saveLines('reservation_extras', 'reservation_id', newId, q.extras);
    const pre = num(b.prepayment);
    if (pre > 0) {
      insertRow('payments', {
        customer_id: data.customer_id, reservation_id: newId, type: 'payment',
        method: oneOf(b.prepayment_method, METHODS, 'Ödeme yöntemi', 'credit_card'),
        amount: round2(pre), paid_at: nowLocal(), description: 'Rezervasyon ön ödemesi', created_by: user.id,
      });
    }
    return newId;
  });
  return getReservation(id);
}

export function updateReservation(id: number, b: Body): ReservationDetail {
  const existing = mustGet<Reservation>('reservations', id, 'Rezervasyon');
  if (!['pending', 'confirmed'].includes(existing.status)) throw new HttpError(409, 'Yalnızca bekleyen veya onaylı rezervasyonlar düzenlenebilir');
  tx(() => {
    const body: Body = {
      discount: existing.discount,
      daily_rate: existing.daily_rate,
      pickup_branch_id: existing.pickup_branch_id,
      return_branch_id: existing.return_branch_id,
      deposit_amount: existing.deposit_amount,
      source: existing.source,
      notes: existing.notes,
      ...b,
      extras: b.extras ?? all('SELECT extra_id, quantity FROM reservation_extras WHERE reservation_id = ?', id),
    };
    // Araç değiştiyse ve özel fiyat verilmediyse yeni aracın liste fiyatı kullanılır.
    if (b.vehicle_id && num(b.vehicle_id) !== existing.vehicle_id && b.daily_rate === undefined) body.daily_rate = null;
    const { data, quote: q } = buildReservation(body, existing);
    updateRow('reservations', id, data);
    saveLines('reservation_extras', 'reservation_id', id, q.extras);
    run('UPDATE payments SET customer_id = ? WHERE reservation_id = ?', data.customer_id, id);
  });
  return getReservation(id);
}

const TRANSITIONS = {
  confirm: { from: ['pending'], to: 'confirmed' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled' },
  'no-show': { from: ['pending', 'confirmed'], to: 'no_show' },
} as const;

export type ReservationAction = keyof typeof TRANSITIONS;

export function transitionReservation(id: number, action: ReservationAction, reason?: unknown): ReservationDetail {
  const t = TRANSITIONS[action];
  const row = mustGet<Reservation>('reservations', id, 'Rezervasyon');
  if (!(t.from as readonly string[]).includes(row.status)) throw new HttpError(409, `Bu işlem "${row.status}" durumundaki rezervasyona uygulanamaz`);
  const cancelReason = action === 'confirm' ? undefined : str(reason) || (action === 'no-show' ? 'Müşteri gelmedi' : null);
  updateRow('reservations', id, { status: t.to, cancel_reason: cancelReason });
  return getReservation(id);
}

// ================= KİRALAMALAR =================

export type RentalRow = Rental & BookingJoin & { reservation_code: string | null };
export type RentalListItem = RentalRow & { paid: number; balance: number; overdue: boolean };
export type RentalDetail = RentalRow & {
  customer: Customer;
  vehicle: Vehicle;
  extras: LineItem[];
  charges: RentalCharge[];
  payments: Payment[];
  damages: Damage[];
  finance: RentalFinance;
  overdue: boolean;
};

const RENTAL_SELECT = `
  SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
         v.plate, v.brand, v.model, v.category,
         pb.name AS pickup_branch_name, rb.name AS return_branch_name, res.code AS reservation_code
  FROM rentals r
  JOIN customers c ON c.id = r.customer_id
  JOIN vehicles v ON v.id = r.vehicle_id
  LEFT JOIN branches pb ON pb.id = r.pickup_branch_id
  LEFT JOIN branches rb ON rb.id = r.return_branch_id
  LEFT JOIN reservations res ON res.id = r.reservation_id`;

export function listRentals(f: Record<string, string | undefined> = {}): RentalListItem[] {
  const { where, params } = filterSql(f, 'r.pickup_at', ['r.contract_no', "c.first_name || ' ' || c.last_name", 'v.plate']);
  const now = nowLocal();
  const status = str(f.status);
  if (status === 'overdue') {
    where.push("r.status = 'active' AND r.planned_return_at < ?");
    params.push(now);
  } else if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  return all<RentalRow>(`${RENTAL_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.pickup_at DESC LIMIT 500`, ...params).map(
    (row) => {
      const fin = rentalFinance(row);
      return { ...row, paid: fin.paid, balance: row.status === 'cancelled' ? 0 : fin.balance, overdue: row.status === 'active' && row.planned_return_at < now };
    },
  );
}

export function getRental(id: number): RentalDetail {
  const row = one<RentalRow>(`${RENTAL_SELECT} WHERE r.id = ?`, id);
  if (!row) throw new HttpError(404, 'Kiralama bulunamadı');
  return {
    ...row,
    customer: mustGet<Customer>('customers', row.customer_id),
    vehicle: mustGet<Vehicle>('vehicles', row.vehicle_id),
    extras: all<LineItem>('SELECT * FROM rental_extras WHERE rental_id = ?', id),
    charges: all<RentalCharge>('SELECT * FROM rental_charges WHERE rental_id = ? ORDER BY id', id),
    payments: all<Payment>('SELECT * FROM payments WHERE rental_id = ? ORDER BY paid_at, id', id),
    damages: all<Damage>('SELECT * FROM damages WHERE rental_id = ?', id),
    finance: rentalFinance(row),
    overdue: row.status === 'active' && row.planned_return_at < nowLocal(),
  };
}

const STATUS_LABEL: Record<string, string> = { rented: 'kirada', maintenance: 'bakımda', out_of_service: 'hizmet dışı' };

function checkoutInputs(b: Body, vehicle: Vehicle) {
  const startKm = str(b.start_km) === null ? vehicle.current_km : Math.floor(num(b.start_km));
  if (startKm < vehicle.current_km) throw new HttpError(400, `Çıkış km (${startKm}) aracın mevcut km'sinden (${vehicle.current_km}) küçük olamaz`);
  const startFuel = str(b.start_fuel) === null ? 8 : Math.floor(num(b.start_fuel));
  if (!(startFuel >= 0 && startFuel <= 8)) throw new HttpError(400, 'Yakıt seviyesi 0-8 arası olmalıdır');
  if (vehicle.status !== 'available') throw new HttpError(409, `Araç şu anda ${STATUS_LABEL[vehicle.status] || vehicle.status}; teslim edilemez`);
  return { startKm, startFuel };
}

function insertRental(data: Record<string, string | number | null>, extras: LineItem[]): number {
  const id = insertRow('rentals', { ...data, contract_no: `TMP-${Date.now()}-${Math.random()}` });
  run('UPDATE rentals SET contract_no = ? WHERE id = ?', makeCode('KS', id), id);
  saveLines('rental_extras', 'rental_id', id, extras);
  return id;
}

function afterCheckout(rentalId: number, b: Body, customerId: number, vehicleId: number, startKm: number, user: SessionUser) {
  run("UPDATE vehicles SET status = 'rented', current_km = ? WHERE id = ?", startKm, vehicleId);
  const rental = mustGet<Rental>('rentals', rentalId);
  if (num(b.deposit_collected) > 0) {
    insertRow('payments', {
      customer_id: customerId, rental_id: rentalId, type: 'deposit_in',
      method: oneOf(b.deposit_method, METHODS, 'Depozito yöntemi', 'credit_card'),
      amount: round2(num(b.deposit_collected)), paid_at: rental.pickup_at, description: 'Teslimde alınan depozito', created_by: user.id,
    });
  }
  if (num(b.payment_amount) > 0) {
    insertRow('payments', {
      customer_id: customerId, rental_id: rentalId, type: 'payment',
      method: oneOf(b.payment_method, METHODS, 'Ödeme yöntemi', 'credit_card'),
      amount: round2(num(b.payment_amount)), paid_at: rental.pickup_at, description: 'Teslimde tahsilat', created_by: user.id,
    });
  }
  recalcRental(rentalId);
}

/** Rezervasyondan teslim (check-out). */
export function checkoutReservation(resId: number, b: Body, user: SessionUser): RentalDetail {
  const id = tx(() => {
    const rsv = mustGet<Reservation>('reservations', resId, 'Rezervasyon');
    if (!['pending', 'confirmed'].includes(rsv.status)) throw new HttpError(409, 'Yalnızca bekleyen/onaylı rezervasyon teslim edilebilir');
    const vehicleId = num(b.vehicle_id) || rsv.vehicle_id;
    const vehicle = mustGet<Vehicle>('vehicles', vehicleId, 'Araç');
    const pickup = normDateTime(b.pickup_at || nowLocal(), 'Teslim tarihi');
    if (pickup >= rsv.return_at) throw new HttpError(400, 'Teslim zamanı planlanan dönüşten önce olmalıdır');
    assertCustomerOk(rsv.customer_id, pickup, { strict: true });
    const { startKm, startFuel } = checkoutInputs(b, vehicle);
    assertAvailable(vehicleId, pickup, rsv.return_at, { excludeReservationId: rsv.id });
    const extras = all<LineItem>('SELECT extra_id, name, quantity, amount FROM reservation_extras WHERE reservation_id = ?', rsv.id);
    const rentalId = insertRental(
      {
        reservation_id: rsv.id, customer_id: rsv.customer_id, vehicle_id: vehicleId,
        pickup_branch_id: rsv.pickup_branch_id, return_branch_id: rsv.return_branch_id,
        pickup_at: pickup, planned_return_at: rsv.return_at, start_km: startKm, start_fuel: startFuel,
        days: rsv.days, daily_rate: rsv.daily_rate, base_amount: rsv.base_amount, long_term_discount: rsv.long_term_discount,
        extras_amount: rsv.extras_amount, one_way_fee: rsv.one_way_fee, discount: rsv.discount, total_amount: rsv.total_amount,
        deposit_amount: str(b.deposit_amount) === null ? rsv.deposit_amount : num(b.deposit_amount),
        additional_driver: str(b.additional_driver), checkout_notes: str(b.checkout_notes), created_by: user.id,
      },
      extras,
    );
    run("UPDATE reservations SET status = 'converted' WHERE id = ?", rsv.id);
    run('UPDATE payments SET rental_id = ? WHERE reservation_id = ?', rentalId, rsv.id);
    afterCheckout(rentalId, b, rsv.customer_id, vehicleId, startKm, user);
    return rentalId;
  });
  return getRental(id);
}

/** Rezervasyonsuz (kapıdan) kiralama. */
export function createWalkInRental(b: Body, user: SessionUser): RentalDetail {
  required(b, [['customer_id', 'Müşteri'], ['vehicle_id', 'Araç'], ['return_at', 'Dönüş tarihi']]);
  const id = tx(() => {
    const vehicle = mustGet<Vehicle>('vehicles', num(b.vehicle_id), 'Araç');
    const pickup = normDateTime(b.pickup_at || nowLocal(), 'Teslim tarihi');
    const ret = normDateTime(b.return_at, 'Dönüş tarihi');
    if (ret <= pickup) throw new HttpError(400, 'Dönüş tarihi teslim tarihinden sonra olmalıdır');
    assertCustomerOk(b.customer_id, pickup, { strict: true });
    const { startKm, startFuel } = checkoutInputs(b, vehicle);
    assertAvailable(vehicle.id, pickup, ret);
    const pb = optId(b.pickup_branch_id) ?? vehicle.branch_id;
    const rb = optId(b.return_branch_id) ?? pb;
    const q = calcQuote({
      vehicle, pickup_at: pickup, return_at: ret, extras: parseExtras(b.extras), discount: b.discount, daily_rate: b.daily_rate,
      pickup_branch_id: pb, return_branch_id: rb,
    });
    const rentalId = insertRental(
      {
        customer_id: num(b.customer_id), vehicle_id: vehicle.id, pickup_branch_id: pb, return_branch_id: rb,
        pickup_at: pickup, planned_return_at: ret, start_km: startKm, start_fuel: startFuel,
        days: q.days, daily_rate: q.daily_rate, base_amount: q.base_amount, long_term_discount: q.long_term_discount,
        extras_amount: q.extras_amount, one_way_fee: q.one_way_fee, discount: q.discount, total_amount: q.total_amount,
        deposit_amount: str(b.deposit_amount) === null ? q.deposit_amount : num(b.deposit_amount),
        additional_driver: str(b.additional_driver), checkout_notes: str(b.checkout_notes), created_by: user.id,
      },
      q.extras,
    );
    afterCheckout(rentalId, b, num(b.customer_id), vehicle.id, startKm, user);
    return rentalId;
  });
  return getRental(id);
}

function activeRental(id: number): Rental {
  const rental = mustGet<Rental>('rentals', id, 'Kiralama');
  if (rental.status !== 'active') throw new HttpError(409, 'Kiralama aktif değil');
  return rental;
}

/** Süre uzatma: müsaitlik kontrolü + yeniden fiyatlama. */
export function extendRental(id: number, b: Body): RentalDetail {
  tx(() => {
    const rental = activeRental(id);
    const newReturn = normDateTime(b.return_at, 'Yeni dönüş tarihi');
    if (newReturn <= rental.planned_return_at) throw new HttpError(400, 'Yeni dönüş tarihi mevcut dönüş tarihinden sonra olmalıdır');
    assertAvailable(rental.vehicle_id, rental.pickup_at, newReturn, { excludeRentalId: id });
    const q = calcQuote({
      vehicle: mustGet<Vehicle>('vehicles', rental.vehicle_id),
      pickup_at: rental.pickup_at,
      return_at: newReturn,
      extras: all('SELECT extra_id, quantity FROM rental_extras WHERE rental_id = ?', id),
      discount: rental.discount,
      daily_rate: b.daily_rate ?? rental.daily_rate,
      pickup_branch_id: rental.pickup_branch_id,
      return_branch_id: rental.return_branch_id,
    });
    updateRow('rentals', id, {
      planned_return_at: newReturn, days: q.days, daily_rate: q.daily_rate, base_amount: q.base_amount,
      long_term_discount: q.long_term_discount, extras_amount: q.extras_amount,
    });
    saveLines('rental_extras', 'rental_id', id, q.extras);
    recalcRental(id);
  });
  return getRental(id);
}

export function previewCheckin(id: number, b: Body): CheckinCalc {
  const rental = activeRental(id);
  return calcCheckin(rental, mustGet<Vehicle>('vehicles', rental.vehicle_id), b);
}

const truthy = (v: unknown) => v === true || v === 'true' || v === 'on';

/** İade (check-in). */
export function checkinRental(id: number, b: Body, user: SessionUser): RentalDetail {
  tx(() => {
    const rental = activeRental(id);
    const vehicle = mustGet<Vehicle>('vehicles', rental.vehicle_id);
    const calc = calcCheckin(rental, vehicle, b);
    const now = nowLocal();

    for (const c of calc.charges) insertRow('rental_charges', { rental_id: id, type: c.type, description: c.description, amount: c.amount });
    for (const d of calc.damages) {
      insertRow('damages', { vehicle_id: vehicle.id, rental_id: id, reported_at: calc.actual_return_at.slice(0, 10), ...d, status: 'open' });
    }
    const returnBranch = optId(b.return_branch_id) ?? rental.return_branch_id;
    updateRow('rentals', id, {
      actual_return_at: calc.actual_return_at, end_km: calc.end_km, end_fuel: calc.end_fuel, return_branch_id: returnBranch,
      checkin_notes: str(b.checkin_notes), status: 'completed', closed_by: user.id,
    });
    recalcRental(id);

    const toMaintenance = truthy(b.send_to_maintenance);
    run('UPDATE vehicles SET current_km = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ?',
      calc.end_km, toMaintenance ? 'maintenance' : 'available', returnBranch, vehicle.id);
    if (toMaintenance) {
      insertRow('maintenance', {
        vehicle_id: vehicle.id, type: calc.damages.length ? 'damage_repair' : 'other',
        description: str(b.maintenance_note) || `İade sonrası bakım (${rental.contract_no})`,
        start_date: today(), km: calc.end_km, status: 'in_progress',
      });
    }

    if (num(b.payment_amount) > 0) {
      insertRow('payments', {
        customer_id: rental.customer_id, rental_id: id, type: 'payment',
        method: oneOf(b.payment_method, METHODS, 'Ödeme yöntemi', 'credit_card'),
        amount: round2(num(b.payment_amount)), paid_at: now, description: 'İadede tahsilat', created_by: user.id,
      });
    }

    // Depozito: tamamını iade et / bakiyeye mahsup et, kalanı iade et / tut
    const fin = rentalFinance(mustGet<Rental>('rentals', id));
    const action = oneOf(b.deposit_action, ['none', 'return', 'offset'] as const, 'Depozito işlemi', 'none');
    if (fin.deposit_held > 0 && action !== 'none') {
      let remaining = fin.deposit_held;
      const base = { customer_id: rental.customer_id, rental_id: id, paid_at: now, created_by: user.id };
      if (action === 'offset' && fin.balance > 0) {
        const use = round2(Math.min(remaining, fin.balance));
        insertRow('payments', { ...base, type: 'deposit_out', method: 'deposit', amount: use, description: 'Depozitodan bakiyeye mahsup' });
        insertRow('payments', { ...base, type: 'payment', method: 'deposit', amount: use, description: 'Depozitodan mahsup' });
        remaining = round2(remaining - use);
      }
      if (remaining > 0) {
        const lastIn = one<{ method: string }>("SELECT method FROM payments WHERE rental_id = ? AND type = 'deposit_in' ORDER BY id DESC", id);
        insertRow('payments', { ...base, type: 'deposit_out', method: lastIn?.method || 'cash', amount: remaining, description: 'Depozito iadesi' });
      }
    }
  });
  return getRental(id);
}

export function cancelRental(id: number, b: Body, user: SessionUser): RentalDetail {
  tx(() => {
    const rental = activeRental(id);
    updateRow('rentals', id, { status: 'cancelled', checkin_notes: str(b.reason) || 'İptal edildi', closed_by: user.id });
    run("UPDATE vehicles SET status = 'available' WHERE id = ? AND status = 'rented'", rental.vehicle_id);
  });
  return getRental(id);
}

export function addCharge(id: number, b: Body): RentalDetail {
  const rental = mustGet<Rental>('rentals', id, 'Kiralama');
  if (rental.status === 'cancelled') throw new HttpError(409, 'İptal edilmiş kiralamaya ücret eklenemez');
  const amount = round2(num(b.amount));
  if (!(amount > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalıdır');
  tx(() => {
    insertRow('rental_charges', { rental_id: id, type: oneOf(b.type, CHARGE_TYPES, 'Ücret tipi', 'other'), description: str(b.description), amount });
    recalcRental(id);
  });
  return getRental(id);
}

export function deleteCharge(id: number, chargeId: number): RentalDetail {
  tx(() => {
    run('DELETE FROM rental_charges WHERE id = ? AND rental_id = ?', chargeId, id);
    recalcRental(id);
  });
  return getRental(id);
}

// ================= ÖDEMELER =================

export type PaymentRow = Payment & { customer_name: string; contract_no: string | null; reservation_code: string | null; created_by_name: string | null };

export function listPayments(f: Record<string, string | undefined> = {}): PaymentRow[] {
  const { where, params } = filterSql(f, 'p.paid_at', []);
  for (const k of ['type', 'method'] as const) {
    if (str(f[k])) {
      where.push(`p.${k} = ?`);
      params.push(str(f[k])!);
    }
  }
  return all<PaymentRow>(
    `SELECT p.*, c.first_name || ' ' || c.last_name AS customer_name, r.contract_no, res.code AS reservation_code, u.full_name AS created_by_name
     FROM payments p JOIN customers c ON c.id = p.customer_id
     LEFT JOIN rentals r ON r.id = p.rental_id
     LEFT JOIN reservations res ON res.id = p.reservation_id
     LEFT JOIN users u ON u.id = p.created_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.paid_at DESC, p.id DESC LIMIT 1000`,
    ...params,
  );
}

export function createPayment(b: Body, user: SessionUser): Payment {
  const amount = round2(num(b.amount));
  if (!(amount > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalıdır');
  const type = oneOf(b.type, ['payment', 'refund', 'deposit_in', 'deposit_out'] as const, 'İşlem tipi', 'payment');
  let customerId: number;
  let rentalId: number | null = null;
  let reservationId: number | null = null;
  if (num(b.rental_id)) {
    const rental = mustGet<Rental>('rentals', num(b.rental_id), 'Kiralama');
    rentalId = rental.id;
    customerId = rental.customer_id;
    const fin = rentalFinance(rental);
    if (type === 'deposit_out' && amount > fin.deposit_held + 0.001) throw new HttpError(400, `İade edilebilir depozito: ${fin.deposit_held}`);
    if (type === 'refund' && amount > fin.paid + 0.001) throw new HttpError(400, `İade tutarı ödenen tutarı (${fin.paid}) aşamaz`);
  } else if (num(b.reservation_id)) {
    const rsv = mustGet<Reservation>('reservations', num(b.reservation_id), 'Rezervasyon');
    reservationId = rsv.id;
    customerId = rsv.customer_id;
    if (type === 'deposit_in' || type === 'deposit_out') throw new HttpError(400, 'Depozito işlemleri kiralama üzerinden yapılır');
    if (type === 'refund' && amount > paymentTotals('reservation_id', rsv.id).paid + 0.001) throw new HttpError(400, 'İade tutarı ödenen tutarı aşamaz');
  } else {
    throw new HttpError(400, 'Ödeme bir kiralama veya rezervasyona bağlı olmalıdır');
  }
  const id = insertRow('payments', {
    customer_id: customerId, rental_id: rentalId, reservation_id: reservationId, type,
    method: oneOf(b.method, METHODS, 'Ödeme yöntemi', 'cash'), amount,
    paid_at: normDateTime(b.paid_at || nowLocal(), 'Ödeme tarihi'), description: str(b.description), created_by: user.id,
  });
  return mustGet<Payment>('payments', id);
}

export function deletePayment(id: number) {
  mustGet('payments', id, 'Ödeme');
  run('DELETE FROM payments WHERE id = ?', id);
  return { ok: true };
}
