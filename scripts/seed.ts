// Demo verisi oluşturur. Kullanım: npm run seed  (mevcut veritabanını SIFIRLAR; çalışan sunucuyu önce durdurun)
import fs from 'node:fs';
import path from 'node:path';
import { openDb, insertRow } from '../lib/db';
import { addDays, fmtDate, fmtDateTime, makeCode } from '../lib/core';
import { calcQuote, recalcRental, type ExtraSelection } from '../lib/rules';
import { hashPassword } from '../lib/password';
import type { Vehicle } from '../lib/types';

const file = process.env.DB_FILE || path.join(process.cwd(), 'data', 'rentacar.db');
for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.rmSync(f);
const db = openDb(file);
const getVehicle = (id: number) => db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id) as unknown as Vehicle;

const at = (dayOffset: number, hour = 10) => {
  const d = addDays(new Date(), dayOffset);
  d.setHours(hour, 0, 0, 0);
  return fmtDateTime(d);
};
const day = (offset: number) => fmtDate(addDays(new Date(), offset));

db.exec('BEGIN');
db.prepare("UPDATE branches SET name = 'İstanbul Merkez', city = 'İstanbul', address = 'Şişli', phone = '0212 000 00 00' WHERE id = 1").run();
const b2 = insertRow('branches', { name: 'Sabiha Gökçen Havalimanı', city: 'İstanbul', phone: '0216 000 00 00' });
const b3 = insertRow('branches', { name: 'Ankara Esenboğa', city: 'Ankara', phone: '0312 000 00 00' });

const vehicles: [string, string, string, number, string, string, string, number, number, number][] = [
  ['34 ABC 101', 'Fiat', 'Egea', 2023, 'Ekonomi', 'Dizel', 'Manuel', 1200, 5000, 45210],
  ['34 ABC 102', 'Renault', 'Clio', 2024, 'Ekonomi', 'Benzin', 'Otomatik', 1350, 5000, 18300],
  ['34 ABC 103', 'Toyota', 'Corolla', 2023, 'Orta', 'Hibrit', 'Otomatik', 1800, 7500, 32500],
  ['34 ABC 104', 'Volkswagen', 'Passat', 2022, 'Üst', 'Dizel', 'Otomatik', 2600, 10000, 67800],
  ['34 ABC 105', 'Hyundai', 'Tucson', 2024, 'SUV', 'Benzin', 'Otomatik', 2900, 10000, 12100],
  ['34 ABC 106', 'Ford', 'Tourneo Courier', 2023, 'Minivan', 'Dizel', 'Manuel', 1700, 7500, 28900],
  ['34 ABC 107', 'BMW', '520i', 2024, 'Lüks', 'Benzin', 'Otomatik', 5200, 25000, 9400],
  ['06 DEF 201', 'Peugeot', '2008', 2023, 'SUV', 'Benzin', 'Otomatik', 2200, 7500, 25400],
  ['06 DEF 202', 'Dacia', 'Sandero', 2024, 'Ekonomi', 'Benzin', 'Manuel', 1100, 4000, 8700],
  ['06 DEF 203', 'Honda', 'Civic', 2023, 'Orta', 'Benzin', 'Otomatik', 1900, 7500, 29900],
];
const vIds = vehicles.map(([plate, brand, model, year, category, fuel, trans, rate, dep, km], i) =>
  insertRow('vehicles', {
    plate, brand, model, year, category, fuel_type: fuel, transmission: trans, daily_rate: rate, deposit_amount: dep,
    current_km: km, km_limit_per_day: 300, extra_km_fee: 5, seats: category === 'Minivan' ? 7 : 5,
    branch_id: plate.startsWith('06') ? b3 : i % 3 === 0 ? b2 : 1,
    insurance_expiry: day(20 + i * 30), kasko_expiry: day(90 + i * 20), inspection_expiry: day(i === 3 ? -5 : 200 + i * 15),
    next_service_km: Math.ceil((km + 2000) / 15000) * 15000,
    color: ['Beyaz', 'Gri', 'Siyah', 'Kırmızı', 'Mavi'][i % 5],
  }),
);

const customers = [
  ['Ahmet', 'Yılmaz', '10000000146', '1985-04-12', '0532 111 11 11', 'ahmet@example.com', 'B-123456', '2005-06-01'],
  ['Ayşe', 'Demir', '10000000278', '1990-09-23', '0533 222 22 22', 'ayse@example.com', 'B-234567', '2010-03-15'],
  ['Mehmet', 'Kaya', '10000000300', '1978-01-30', '0534 333 33 33', 'mehmet@example.com', 'B-345678', '1998-11-20'],
  ['Zeynep', 'Çelik', '10000000432', '1995-12-05', '0535 444 44 44', 'zeynep@example.com', 'B-456789', '2015-07-07'],
  ['Can', 'Şahin', '10000000564', '1988-07-19', '0536 555 55 55', 'can@example.com', 'B-567890', '2008-02-28'],
  ['Elif', 'Aydın', '10000000696', '1992-03-08', '0537 666 66 66', 'elif@example.com', 'B-678901', '2012-09-12'],
  ['Burak', 'Öztürk', '10000000728', '1983-11-11', '0538 777 77 77', 'burak@example.com', 'B-789012', '2003-05-05'],
  ['Selin', 'Arslan', '10000000850', '1999-06-25', '0539 888 88 88', 'selin@example.com', 'B-890123', '2019-01-10'],
];
const cIds = customers.map(([first_name, last_name, national_id, birth_date, phone, email, license_no, license_date]) =>
  insertRow('customers', { first_name, last_name, national_id, birth_date, phone, email, license_no, license_date, license_class: 'B' }),
);
insertRow('customers', {
  type: 'corporate', first_name: 'Deniz', last_name: 'Koç', company_name: 'Örnek Lojistik A.Ş.', tax_office: 'Mecidiyeköy',
  tax_no: '1234567890', phone: '0212 999 99 99', email: 'filo@ornek.com.tr', birth_date: '1980-02-02',
  license_no: 'B-901234', license_date: '2000-01-01', license_class: 'B',
});
insertRow('customers', {
  first_name: 'Kemal', last_name: 'Kara', phone: '0540 000 00 00', blacklisted: 1,
  blacklist_reason: 'Ödenmemiş hasar bedeli', birth_date: '1975-05-05', license_no: 'B-000111', license_date: '1995-01-01',
});

interface SeedRental { v: number; c: number; from: string; to: string; returned: boolean; endKmAdd?: number; fuel?: number; pay?: boolean; extras?: ExtraSelection[] }

function addRental({ v, c, from, to, returned, endKmAdd = 800, fuel = 8, pay = true, extras = [] }: SeedRental) {
  const vehicle = getVehicle(vIds[v]);
  const q = calcQuote({ vehicle, pickup_at: from, return_at: to, extras });
  const id = insertRow('rentals', {
    contract_no: `TMP-${Math.random()}`, customer_id: cIds[c], vehicle_id: vehicle.id,
    pickup_branch_id: vehicle.branch_id, return_branch_id: vehicle.branch_id, pickup_at: from, planned_return_at: to,
    actual_return_at: returned ? to : null, start_km: vehicle.current_km, end_km: returned ? vehicle.current_km + endKmAdd : null,
    start_fuel: 8, end_fuel: returned ? fuel : null, days: q.days, daily_rate: q.daily_rate, base_amount: q.base_amount,
    long_term_discount: q.long_term_discount, extras_amount: q.extras_amount, one_way_fee: 0, discount: 0,
    total_amount: q.total_amount, deposit_amount: q.deposit_amount, status: returned ? 'completed' : 'active', created_by: 1,
  });
  db.prepare('UPDATE rentals SET contract_no = ? WHERE id = ?').run(makeCode('KS', id), id);
  for (const l of q.extras) insertRow('rental_extras', { rental_id: id, ...l });
  if (returned && fuel < 8) {
    insertRow('rental_charges', { rental_id: id, type: 'fuel', description: `Yakıt eksiği: ${8 - fuel}/8`, amount: (8 - fuel) * 350 });
  }
  recalcRental(id);
  const total = (db.prepare('SELECT total_amount FROM rentals WHERE id = ?').get(id) as { total_amount: number }).total_amount;
  if (pay) insertRow('payments', { customer_id: cIds[c], rental_id: id, type: 'payment', method: 'credit_card', amount: total, paid_at: from, created_by: 1 });
  else insertRow('payments', { customer_id: cIds[c], rental_id: id, type: 'payment', method: 'cash', amount: Math.round(total / 2), paid_at: from, created_by: 1 });
  insertRow('payments', { customer_id: cIds[c], rental_id: id, type: 'deposit_in', method: 'credit_card', amount: q.deposit_amount, paid_at: from, created_by: 1 });
  if (returned) {
    insertRow('payments', { customer_id: cIds[c], rental_id: id, type: 'deposit_out', method: 'credit_card', amount: q.deposit_amount, paid_at: to, description: 'Depozito iadesi', created_by: 1 });
    db.prepare('UPDATE vehicles SET current_km = ? WHERE id = ?').run(vehicle.current_km + endKmAdd, vehicle.id);
  } else {
    db.prepare("UPDATE vehicles SET status = 'rented' WHERE id = ?").run(vehicle.id);
  }
  return id;
}

// Geçmiş kiralamalar (son ~5 ay)
let ci = 0;
for (let m = 150; m > 10; m -= 9) {
  const v = (m / 9) % vIds.length | 0;
  const len = 2 + (m % 6);
  addRental({ v, c: ci++ % cIds.length, from: at(-m), to: at(-m + len), returned: true, fuel: m % 4 === 0 ? 6 : 8, extras: m % 3 ? [] : [{ extra_id: 4, quantity: 1 }] });
}
// Aktif kiralamalar
addRental({ v: 0, c: 1, from: at(-3), to: at(2), returned: false });
addRental({ v: 4, c: 2, from: at(-5), to: at(0, 9), returned: false, pay: false });
addRental({ v: 7, c: 3, from: at(-10), to: at(-1), returned: false, pay: false }); // gecikmiş

// Rezervasyonlar
function addReservation({ v, c, from, to, status = 'confirmed', extras = [] }: { v: number; c: number; from: string; to: string; status?: string; extras?: ExtraSelection[] }) {
  const vehicle = getVehicle(vIds[v]);
  const q = calcQuote({ vehicle, pickup_at: from, return_at: to, extras });
  const id = insertRow('reservations', {
    code: `TMP-${Math.random()}`, customer_id: cIds[c], vehicle_id: vehicle.id, pickup_branch_id: vehicle.branch_id,
    return_branch_id: vehicle.branch_id, pickup_at: from, return_at: to, days: q.days, daily_rate: q.daily_rate,
    base_amount: q.base_amount, long_term_discount: q.long_term_discount, extras_amount: q.extras_amount, one_way_fee: 0,
    discount: 0, total_amount: q.total_amount, deposit_amount: q.deposit_amount, status, source: 'Web', created_by: 1,
  });
  db.prepare('UPDATE reservations SET code = ? WHERE id = ?').run(makeCode('RZ', id), id);
  for (const l of q.extras) insertRow('reservation_extras', { reservation_id: id, ...l });
}
addReservation({ v: 1, c: 4, from: at(0, 14), to: at(3, 14), extras: [{ extra_id: 1, quantity: 1 }] });
addReservation({ v: 2, c: 5, from: at(1), to: at(8), status: 'pending' });
addReservation({ v: 6, c: 6, from: at(4), to: at(6), extras: [{ extra_id: 3, quantity: 1 }] });
addReservation({ v: 9, c: 7, from: at(7), to: at(40) });

// Bakım ve hasar
insertRow('maintenance', { vehicle_id: vIds[3], type: 'repair', description: 'Fren balatası değişimi', start_date: day(-1), km: 67800, cost: 4500, vendor: 'Yetkili Servis', status: 'in_progress' });
db.prepare("UPDATE vehicles SET status = 'maintenance' WHERE id = ?").run(vIds[3]);
insertRow('maintenance', { vehicle_id: vIds[5], type: 'periodic', description: '30.000 km bakımı', start_date: day(5), end_date: day(5), cost: 6000, vendor: 'Yetkili Servis', status: 'scheduled' });
insertRow('maintenance', { vehicle_id: vIds[0], type: 'tire', description: 'Kış lastiği takımı', start_date: day(-40), end_date: day(-40), cost: 12000, vendor: 'Lastikçi', status: 'completed' });
insertRow('damages', { vehicle_id: vIds[2], reported_at: day(-140), location: 'Sağ ön çamurluk', description: 'Çizik', severity: 'minor', repair_cost: 2500, customer_charge: 0, status: 'repaired' });
insertRow('damages', { vehicle_id: vIds[8], reported_at: day(-3), location: 'Arka tampon', description: 'Göçük', severity: 'moderate', repair_cost: 6000, status: 'open' });

// Masraflar
for (let i = 0; i < 6; i++) {
  insertRow('expenses', { category: 'Kira', amount: 45000, expense_date: day(-30 * i - 1), description: 'Ofis kirası', created_by: 1 });
  insertRow('expenses', { category: 'Yıkama/Temizlik', amount: 3500, expense_date: day(-30 * i - 5), created_by: 1 });
  insertRow('expenses', { vehicle_id: vIds[i], category: 'Yakıt', amount: 1500, expense_date: day(-30 * i - 10), created_by: 1 });
}

insertRow('users', {
  username: 'personel', full_name: 'Ofis Personeli', role: 'staff',
  password_hash: hashPassword('personel123'),
});
db.prepare("UPDATE settings SET value = 'Demo Rent A Car' WHERE key = 'company_name'").run();
db.exec('COMMIT');
console.log('Demo verisi oluşturuldu:', file);
console.log('Giriş: admin / admin123  veya  personel / personel123');
