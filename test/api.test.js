import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { calcDays, fmtDateTime } from '../src/services.js';

let server;
let base;
let token;

const at = (days, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return fmtDateTime(d);
};

async function call(method, path, body, tk = token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

before(async () => {
  openDb(':memory:');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' }, null);
  assert.equal(login.status, 200);
  token = login.data.token;
});

after(() => server.close());

test('gün hesabı tolerans saatini uygular', () => {
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-02T10:00', 2), 1);
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-02T11:59', 2), 1);
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-02T12:30', 2), 2);
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-01T12:00', 2), 1);
  assert.throws(() => calcDays('2026-01-02T10:00', '2026-01-01T10:00', 2));
});

test('yetkisiz erişim reddedilir', async () => {
  const r = await call('GET', '/vehicles', null, null);
  assert.equal(r.status, 401);
  const bad = await call('POST', '/auth/login', { username: 'admin', password: 'yanlis' }, null);
  assert.equal(bad.status, 401);
});

let vehicle;
let vehicle2;
let customer;

test('araç ve müşteri oluşturma + doğrulama', async () => {
  let r = await call('POST', '/vehicles', { plate: '34 tst 01', brand: 'Fiat', model: 'Egea', daily_rate: 1000, deposit_amount: 5000, current_km: 10000, km_limit_per_day: 200, extra_km_fee: 5 });
  assert.equal(r.status, 201);
  vehicle = r.data;
  assert.equal(vehicle.plate, '34 TST 01');
  r = await call('POST', '/vehicles', { plate: '34 TST 01', brand: 'X', model: 'Y', daily_rate: 1 });
  assert.equal(r.status, 409, 'aynı plaka reddedilmeli');
  r = await call('POST', '/vehicles', { plate: '34 TST 02', brand: 'Renault', model: 'Clio', daily_rate: 1500 });
  vehicle2 = r.data;

  r = await call('POST', '/customers', { first_name: 'Ali', last_name: 'Veli', phone: '0555', national_id: '123' });
  assert.equal(r.status, 400, 'geçersiz TC reddedilmeli');
  r = await call('POST', '/customers', {
    first_name: 'Ali', last_name: 'Veli', phone: '0555 555 55 55', birth_date: '1990-01-01', license_no: 'B1', license_date: '2010-01-01',
  });
  assert.equal(r.status, 201);
  customer = r.data;
});

test('fiyat teklifi: uzun dönem indirimi, ek hizmet, tek yön', async () => {
  const branch2 = (await call('POST', '/branches', { name: 'Havalimanı' })).data;
  const r = await call('POST', '/quote', {
    vehicle_id: vehicle.id, pickup_at: at(1), return_at: at(8), extras: [{ extra_id: 1, quantity: 1 }], pickup_branch_id: 1, return_branch_id: branch2.id, discount: 100,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.days, 7);
  assert.equal(r.data.base_amount, 7000);
  assert.equal(r.data.long_term_discount, 700); // %10
  assert.equal(r.data.extras[0].amount, 1050); // 150 x 7
  assert.equal(r.data.one_way_fee, 1500);
  assert.equal(r.data.total_amount, 7000 - 700 + 1050 + 1500 - 100);
});

let reservation;

test('rezervasyon oluşturma ve çakışma kontrolü', async () => {
  let r = await call('POST', '/reservations', {
    customer_id: customer.id, vehicle_id: vehicle.id, pickup_at: at(1), return_at: at(4), extras: [{ extra_id: 3, quantity: 1 }], prepayment: 1000,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  reservation = r.data;
  assert.match(reservation.code, /^RZ\d{4}-\d{5}$/);
  assert.equal(reservation.days, 3);
  assert.equal(reservation.total_amount, 3000 + 500);
  assert.equal(reservation.finance.paid, 1000);

  r = await call('POST', '/reservations', { customer_id: customer.id, vehicle_id: vehicle.id, pickup_at: at(2), return_at: at(6) });
  assert.equal(r.status, 409, 'çakışan rezervasyon reddedilmeli');

  r = await call('GET', `/vehicles/available?pickup_at=${at(2)}&return_at=${at(3)}`);
  assert.ok(!r.data.some((v) => v.id === vehicle.id));
  assert.ok(r.data.some((v) => v.id === vehicle2.id));
});

test('kara listedeki müşteri rezervasyon yapamaz', async () => {
  const c = (await call('POST', '/customers', { first_name: 'Kötü', last_name: 'Müşteri', phone: '1', blacklisted: true, blacklist_reason: 'Borç' })).data;
  const r = await call('POST', '/reservations', { customer_id: c.id, vehicle_id: vehicle2.id, pickup_at: at(10), return_at: at(12) });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /kara liste/i);
});

test('genç sürücü / eksik ehliyet teslimde reddedilir', async () => {
  const young = (await call('POST', '/customers', { first_name: 'Genç', last_name: 'Sürücü', phone: '2', birth_date: at(-365 * 19).slice(0, 10), license_no: 'X', license_date: at(-400).slice(0, 10) })).data;
  let r = await call('POST', '/rentals', { customer_id: young.id, vehicle_id: vehicle2.id, return_at: at(2) });
  assert.equal(r.status, 422);
  const noLicense = (await call('POST', '/customers', { first_name: 'Ehliyetsiz', last_name: 'K', phone: '3', birth_date: '1980-01-01' })).data;
  r = await call('POST', '/rentals', { customer_id: noLicense.id, vehicle_id: vehicle2.id, return_at: at(2) });
  assert.equal(r.status, 422);
});

let rental;

test('rezervasyondan teslim (check-out)', async () => {
  let r = await call('POST', `/reservations/${reservation.id}/checkout`, {
    pickup_at: at(1), start_km: 9000, start_fuel: 8,
  });
  assert.equal(r.status, 400, 'araç km altına düşülemez');
  r = await call('POST', `/reservations/${reservation.id}/checkout`, {
    pickup_at: at(1), start_km: 10050, start_fuel: 8, deposit_collected: 5000, payment_amount: 2500,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  rental = r.data;
  assert.match(rental.contract_no, /^KS\d{4}-\d{5}$/);
  assert.equal(rental.total_amount, 3500);
  assert.equal(rental.finance.paid, 3500, 'ön ödeme sözleşmeye aktarılmalı');
  assert.equal(rental.finance.balance, 0);
  assert.equal(rental.finance.deposit_held, 5000);

  const v = (await call('GET', `/vehicles/${vehicle.id}`)).data;
  assert.equal(v.status, 'rented');
  assert.equal(v.current_km, 10050);
  const res = (await call('GET', `/reservations/${reservation.id}`)).data;
  assert.equal(res.status, 'converted');

  r = await call('POST', `/reservations/${reservation.id}/checkout`, {});
  assert.equal(r.status, 409, 'aynı rezervasyon iki kez teslim edilemez');
});

test('süre uzatma yeniden fiyatlar', async () => {
  const r = await call('POST', `/rentals/${rental.id}/extend`, { return_at: at(5) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.days, 4);
  assert.equal(r.data.total_amount, 4000 + 500);
});

test('iade (check-in): gecikme, km aşımı, yakıt, hasar ve depozito mahsubu', async () => {
  const body = {
    actual_return_at: at(6, 15), // 1 gün + 5 saat gecikme → 5 gün (tolerans 2 saat)
    end_km: 10050 + 1500, // limit 200 x 6 = 1200 → 300 km aşım
    end_fuel: 6,
    damages: [{ description: 'Tampon çizik', severity: 'minor', customer_charge: 750, repair_cost: 1200 }],
    extra_charges: [{ type: 'cleaning', amount: 250 }],
    deposit_action: 'offset',
  };
  const p = await call('POST', `/rentals/${rental.id}/checkin/preview`, body);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.actual_days, 6);
  assert.equal(p.data.late_days, 2);
  const byType = Object.fromEntries(p.data.charges.map((c) => [c.type, c.amount]));
  assert.equal(byType.late_return, 2000);
  assert.equal(byType.extra_km, 1500);
  assert.equal(byType.fuel, 700);
  assert.equal(byType.damage, 750);
  assert.equal(byType.cleaning, 250);
  assert.equal(p.data.new_total, 4500 + 2000 + 1500 + 700 + 750 + 250);

  const r = await call('POST', `/rentals/${rental.id}/checkin`, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'completed');
  assert.equal(r.data.total_amount, 9700);
  // Ödenen 3500, bakiye 6200 → depozitodan 5000 mahsup, kalan bakiye 1200
  assert.equal(r.data.finance.paid, 8500);
  assert.equal(r.data.finance.balance, 1200);
  assert.equal(r.data.finance.deposit_held, 0);
  assert.equal(r.data.damages.length, 1);

  const v = (await call('GET', `/vehicles/${vehicle.id}`)).data;
  assert.equal(v.status, 'available');
  assert.equal(v.current_km, 11550);

  const pay = await call('POST', '/payments', { rental_id: rental.id, type: 'payment', method: 'cash', amount: 1200 });
  assert.equal(pay.status, 201);
  const after = (await call('GET', `/rentals/${rental.id}`)).data;
  assert.equal(after.finance.balance, 0);
});

test('kapıdan kiralama, bakım engeli ve iptal', async () => {
  let r = await call('POST', '/maintenance', { vehicle_id: vehicle2.id, type: 'repair', status: 'in_progress', cost: 1000 });
  assert.equal(r.status, 201);
  let v = (await call('GET', `/vehicles/${vehicle2.id}`)).data;
  assert.equal(v.status, 'maintenance');
  r = await call('POST', '/rentals', { customer_id: customer.id, vehicle_id: vehicle2.id, return_at: at(2) });
  assert.equal(r.status, 409, 'bakımdaki araç kiralanamaz');

  const m = v.maintenance[0];
  r = await call('PUT', `/maintenance/${m.id}`, { status: 'completed' });
  assert.equal(r.status, 200);
  v = (await call('GET', `/vehicles/${vehicle2.id}`)).data;
  assert.equal(v.status, 'available');

  r = await call('POST', '/rentals', { customer_id: customer.id, vehicle_id: vehicle2.id, return_at: at(2), deposit_collected: 1000 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.days, 2);
  r = await call('POST', `/rentals/${r.data.id}/cancel`, { reason: 'Test' });
  assert.equal(r.data.status, 'cancelled');
  v = (await call('GET', `/vehicles/${vehicle2.id}`)).data;
  assert.equal(v.status, 'available');
});

test('rezervasyon iptali ve depozito iadesi sınırı', async () => {
  let r = await call('POST', '/reservations', { customer_id: customer.id, vehicle_id: vehicle2.id, pickup_at: at(20), return_at: at(22), status: 'pending' });
  assert.equal(r.data.status, 'pending');
  r = await call('POST', `/reservations/${r.data.id}/confirm`);
  assert.equal(r.data.status, 'confirmed');
  r = await call('POST', `/reservations/${r.data.id}/cancel`, { reason: 'Müşteri vazgeçti' });
  assert.equal(r.data.status, 'cancelled');
  r = await call('POST', '/payments', { rental_id: rental.id, type: 'deposit_out', amount: 10 });
  assert.equal(r.status, 400, 'tutulmayan depozito iade edilemez');
});

test('personel kullanıcı yönetici işlemlerini yapamaz', async () => {
  await call('POST', '/users', { username: 'staff1', full_name: 'Personel', password: 'secret1', role: 'staff' });
  const login = await call('POST', '/auth/login', { username: 'staff1', password: 'secret1' }, null);
  const st = login.data.token;
  assert.equal((await call('GET', '/users', null, st)).status, 403);
  assert.equal((await call('DELETE', `/vehicles/${vehicle.id}`, null, st)).status, 403);
  assert.equal((await call('GET', '/vehicles', null, st)).status, 200);
});

test('gösterge paneli, raporlar ve takvim', async () => {
  const d = await call('GET', '/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.data.fleet.total, 2);
  const rep = await call('GET', `/reports?from=${at(-1).slice(0, 10)}&to=${at(30).slice(0, 10)}`);
  assert.equal(rep.status, 200);
  assert.equal(rep.data.summary.rentals, 1);
  assert.ok(rep.data.by_vehicle.find((v) => v.id === vehicle.id).rented_days > 0);
  const cal = await call('GET', '/calendar?days=14');
  assert.equal(cal.status, 200);
  assert.ok(cal.data.events.length > 0);
});
