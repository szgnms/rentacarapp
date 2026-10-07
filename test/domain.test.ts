import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db';
import { fmtDateTime, HttpError } from '../lib/core';
import { calcDays } from '../lib/rules';
import { login } from '../lib/auth';
import { createUser, saveBranch } from '../lib/domain/admin';
import { availableVehicles, createCustomer, createVehicle, getVehicle } from '../lib/domain/fleet';
import {
  checkinRental, checkoutReservation, createPayment, createReservation, createWalkInRental, cancelRental, extendRental, getRental,
  getReservation, previewCheckin, quote, transitionReservation,
} from '../lib/domain/bookings';
import { createMaintenance, updateMaintenance } from '../lib/domain/service';
import { calendar, dashboard, reports } from '../lib/domain/reports';
import { handler } from '../lib/api';
import type { Customer, SessionUser, Vehicle } from '../lib/types';

const at = (days: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return fmtDateTime(d);
};

/** Expects fn to throw an HttpError with the given status. */
function rejects(fn: () => unknown, status: number, msg?: RegExp) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof HttpError, `HttpError bekleniyordu: ${e}`);
    assert.equal(e.status, status, e.message);
    if (msg) assert.match(e.message, msg);
    return true;
  });
}

let admin: SessionUser;
let vehicle: Vehicle;
let vehicle2: Vehicle;
let customer: Customer;

before(() => {
  openDb(':memory:');
  admin = login('admin', 'admin123').user;
});

test('gün hesabı tolerans saatini uygular', () => {
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-02T10:00', 2), 1);
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-02T11:59', 2), 1);
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-02T12:30', 2), 2);
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-01T12:00', 2), 1);
  assert.throws(() => calcDays('2026-01-02T10:00', '2026-01-01T10:00', 2));
});

test('giriş ve route handler yetkilendirmesi', async () => {
  rejects(() => login('admin', 'yanlis'), 401);
  const route = handler(({ user }) => user);
  assert.equal((await route(new Request('http://x/api/me'))).status, 401);
  const { token } = login('admin', 'admin123');
  const ok = await route(new Request('http://x/api/me', { headers: { cookie: `sid=${token}` } }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).username, 'admin');
  const adminOnly = handler(() => 'ok', { admin: true });
  createUser({ username: 'staff1', full_name: 'Personel', password: 'secret1', role: 'staff' });
  const staff = login('staff1', 'secret1');
  assert.equal((await adminOnly(new Request('http://x', { headers: { authorization: `Bearer ${staff.token}` } }))).status, 403);
});

test('araç ve müşteri oluşturma + doğrulama', () => {
  vehicle = createVehicle({ plate: '34 tst 01', brand: 'Fiat', model: 'Egea', daily_rate: 1000, deposit_amount: 5000, current_km: 10000, km_limit_per_day: 200, extra_km_fee: 5 });
  assert.equal(vehicle.plate, '34 TST 01');
  rejects(() => createVehicle({ plate: '34 TST 01', brand: 'X', model: 'Y', daily_rate: 1 }), 409);
  vehicle2 = createVehicle({ plate: '34 TST 02', brand: 'Renault', model: 'Clio', daily_rate: 1500 });

  rejects(() => createCustomer({ first_name: 'Ali', last_name: 'Veli', phone: '0555', national_id: '123' }), 400);
  customer = createCustomer({ first_name: 'Ali', last_name: 'Veli', phone: '0555 555 55 55', birth_date: '1990-01-01', license_no: 'B1', license_date: '2010-01-01' });
});

test('fiyat teklifi: uzun dönem indirimi, ek hizmet, tek yön', () => {
  const branch2 = saveBranch(null, { name: 'Havalimanı' });
  const q = quote({ vehicle_id: vehicle.id, pickup_at: at(1), return_at: at(8), extras: [{ extra_id: 1, quantity: 1 }], pickup_branch_id: 1, return_branch_id: branch2.id, discount: 100 });
  assert.equal(q.days, 7);
  assert.equal(q.base_amount, 7000);
  assert.equal(q.long_term_discount, 700);
  assert.equal(q.extras[0].amount, 1050);
  assert.equal(q.one_way_fee, 1500);
  assert.equal(q.total_amount, 7000 - 700 + 1050 + 1500 - 100);
});

let reservationId: number;

test('rezervasyon oluşturma ve çakışma kontrolü', () => {
  const r = createReservation({ customer_id: customer.id, vehicle_id: vehicle.id, pickup_at: at(1), return_at: at(4), extras: [{ extra_id: 3, quantity: 1 }], prepayment: 1000 }, admin);
  reservationId = r.id;
  assert.match(r.code, /^RZ\d{4}-\d{5}$/);
  assert.equal(r.days, 3);
  assert.equal(r.total_amount, 3500);
  assert.equal(r.finance.paid, 1000);
  rejects(() => createReservation({ customer_id: customer.id, vehicle_id: vehicle.id, pickup_at: at(2), return_at: at(6) }, admin), 409);
  const avail = availableVehicles({ pickup_at: at(2), return_at: at(3) });
  assert.ok(!avail.some((v) => v.id === vehicle.id));
  assert.ok(avail.some((v) => v.id === vehicle2.id));
});

test('kara liste, genç sürücü ve eksik ehliyet engellenir', () => {
  const bad = createCustomer({ first_name: 'Kötü', last_name: 'Müşteri', phone: '1', blacklisted: true, blacklist_reason: 'Borç' });
  rejects(() => createReservation({ customer_id: bad.id, vehicle_id: vehicle2.id, pickup_at: at(10), return_at: at(12) }, admin), 422, /kara liste/i);
  const young = createCustomer({ first_name: 'Genç', last_name: 'Sürücü', phone: '2', birth_date: at(-365 * 19).slice(0, 10), license_no: 'X', license_date: at(-400).slice(0, 10) });
  rejects(() => createWalkInRental({ customer_id: young.id, vehicle_id: vehicle2.id, return_at: at(2) }, admin), 422);
  const noLicense = createCustomer({ first_name: 'Ehliyetsiz', last_name: 'K', phone: '3', birth_date: '1980-01-01' });
  rejects(() => createWalkInRental({ customer_id: noLicense.id, vehicle_id: vehicle2.id, return_at: at(2) }, admin), 422);
});

let rentalId: number;

test('rezervasyondan teslim (check-out)', () => {
  rejects(() => checkoutReservation(reservationId, { pickup_at: at(1), start_km: 9000 }, admin), 400);
  const r = checkoutReservation(reservationId, { pickup_at: at(1), start_km: 10050, start_fuel: 8, deposit_collected: 5000, payment_amount: 2500 }, admin);
  rentalId = r.id;
  assert.match(r.contract_no, /^KS\d{4}-\d{5}$/);
  assert.equal(r.total_amount, 3500);
  assert.equal(r.finance.paid, 3500, 'ön ödeme sözleşmeye aktarılmalı');
  assert.equal(r.finance.balance, 0);
  assert.equal(r.finance.deposit_held, 5000);
  const v = getVehicle(vehicle.id);
  assert.equal(v.status, 'rented');
  assert.equal(v.current_km, 10050);
  assert.equal(getReservation(reservationId).status, 'converted');
  rejects(() => checkoutReservation(reservationId, {}, admin), 409);
});

test('süre uzatma yeniden fiyatlar', () => {
  const r = extendRental(rentalId, { return_at: at(5) });
  assert.equal(r.days, 4);
  assert.equal(r.total_amount, 4500);
});

test('iade: gecikme, km aşımı, yakıt, hasar ve depozito mahsubu', () => {
  const body = {
    actual_return_at: at(6, 15), // 5 gün 5 saat → 6 gün (tolerans 2 saat), plan 4 gün
    end_km: 10050 + 1500, // limit 200 x 6 = 1200 → 300 km aşım
    end_fuel: 6,
    damages: [{ description: 'Tampon çizik', severity: 'minor', customer_charge: 750, repair_cost: 1200 }],
    extra_charges: [{ type: 'cleaning', amount: 250 }],
    deposit_action: 'offset',
  };
  const p = previewCheckin(rentalId, body);
  assert.equal(p.actual_days, 6);
  assert.equal(p.late_days, 2);
  const byType = Object.fromEntries(p.charges.map((c) => [c.type, c.amount]));
  assert.deepEqual(byType, { late_return: 2000, extra_km: 1500, fuel: 700, damage: 750, cleaning: 250 });
  assert.equal(p.new_total, 9700);

  const r = checkinRental(rentalId, body, admin);
  assert.equal(r.status, 'completed');
  assert.equal(r.total_amount, 9700);
  // Ödenen 3500, bakiye 6200 → depozitodan 5000 mahsup, kalan 1200
  assert.equal(r.finance.paid, 8500);
  assert.equal(r.finance.balance, 1200);
  assert.equal(r.finance.deposit_held, 0);
  assert.equal(r.damages.length, 1);
  const v = getVehicle(vehicle.id);
  assert.equal(v.status, 'available');
  assert.equal(v.current_km, 11550);

  createPayment({ rental_id: rentalId, type: 'payment', method: 'cash', amount: 1200 }, admin);
  assert.equal(getRental(rentalId).finance.balance, 0);
  rejects(() => createPayment({ rental_id: rentalId, type: 'deposit_out', amount: 10 }, admin), 400);
});

test('bakım engeli, kapıdan kiralama ve iptal', () => {
  const m = createMaintenance({ vehicle_id: vehicle2.id, type: 'repair', status: 'in_progress', cost: 1000 });
  assert.equal(getVehicle(vehicle2.id).status, 'maintenance');
  rejects(() => createWalkInRental({ customer_id: customer.id, vehicle_id: vehicle2.id, return_at: at(2) }, admin), 409);
  updateMaintenance(m.id, { status: 'completed' });
  assert.equal(getVehicle(vehicle2.id).status, 'available');

  const r = createWalkInRental({ customer_id: customer.id, vehicle_id: vehicle2.id, pickup_at: at(0), return_at: at(2), deposit_collected: 1000 }, admin);
  assert.equal(r.days, 2);
  assert.equal(r.finance.deposit_held, 1000);
  assert.equal(cancelRental(r.id, { reason: 'Test' }, admin).status, 'cancelled');
  assert.equal(getVehicle(vehicle2.id).status, 'available');
});

test('rezervasyon durum geçişleri', () => {
  const r = createReservation({ customer_id: customer.id, vehicle_id: vehicle2.id, pickup_at: at(20), return_at: at(22), status: 'pending' }, admin);
  assert.equal(r.status, 'pending');
  assert.equal(transitionReservation(r.id, 'confirm').status, 'confirmed');
  rejects(() => transitionReservation(r.id, 'confirm'), 409);
  const c = transitionReservation(r.id, 'cancel', 'Müşteri vazgeçti');
  assert.equal(c.status, 'cancelled');
  assert.equal(c.cancel_reason, 'Müşteri vazgeçti');
});

test('gösterge paneli, raporlar ve takvim', () => {
  const d = dashboard();
  assert.equal(d.fleet.total, 2);
  assert.equal(d.monthly.length, 6);
  const rep = reports({ from: at(-1).slice(0, 10), to: at(30).slice(0, 10) });
  assert.equal(rep.summary.rentals, 1);
  assert.ok(rep.by_vehicle.find((v) => v.id === vehicle.id)!.rented_days > 0);
  assert.ok(calendar({ days: '14' }).events.length > 0);
});
