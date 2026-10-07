// Demo verisi: şubeler, roller, fiyat tabloları, araçlar, müşteriler, sözleşmeler, rezervasyonlar, HGS/ceza, iş emirleri.
// Boş (yeni oluşturulmuş) veritabanında çalıştırılmalıdır.
import crypto from 'node:crypto';
import { all, insertRow, one, run } from './db';
import { addDays, fmtDate, fmtDateTime, makeCode, mapSeq } from './core';
import { calcQuote, recalcRental, rentalFinance } from './rules';
import { hashPassword } from './password';
import { importTolls } from './domain/tolls';
import { issueInvoiceForRental } from './domain/finance';
import { withContext } from './context';
import type { Customer, Rental, Vehicle } from './types';

type ExtraSelection = { extra_id: number; quantity: number };

export async function seedDemo() {
  const get = async <T,>(sql: string, ...p: (string | number | null)[]) => (await one<T>(sql, ...p)) as T;
  const exec = (sql: string, ...p: (string | number | null)[]) => run(sql, ...p);
  const getVehicle = (id: number) => get<Vehicle>('SELECT * FROM vehicles WHERE id = ?', id);
  const getCustomer = (id: number) => get<Customer>('SELECT * FROM customers WHERE id = ?', id);
  const extraId = async (code: string) => (await get<{ id: number }>('SELECT id FROM extras WHERE code = ? OR name = ?', code, code)).id;
  const token = () => crypto.randomBytes(18).toString('base64url');

  const at = (dayOffset: number, hour = 10, minute = 0) => {
    const d = addDays(new Date(), dayOffset);
    d.setHours(hour, minute, 0, 0);
    return fmtDateTime(d);
  };
  const day = (offset: number) => fmtDate(addDays(new Date(), offset));

  /** Geçerli T.C. kimlik numarası üretir (algoritma kontrollü). */
  const tckn = (seed: number) => {
    const d = String(100000000 + seed * 7919).slice(0, 9).split('').map(Number);
    d[0] = d[0] || 1;
    const d10 = ((((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10) + 10) % 10;
    const d11 = (d.reduce((a, x) => a + x, 0) + d10) % 10;
    return [...d, d10, d11].join('');
  };

  // ---------- Şubeler & kullanıcılar ----------
  await exec("UPDATE branches SET name = 'İstanbul Merkez', city = 'İstanbul', address = 'Büyükdere Cad. No:1 Şişli', phone = '0212 000 00 00' WHERE id = 1");
  const b2 = await insertRow('branches', { name: 'Sabiha Gökçen Havalimanı', city: 'İstanbul', address: 'SAW Dış Hatlar Geliş', phone: '0216 000 00 00' });
  const b3 = await insertRow('branches', { name: 'Ankara Esenboğa', city: 'Ankara', address: 'ESB İç Hatlar', phone: '0312 000 00 00' });

  const users: [string, string, string, number | null, number][] = [
    ['mudur', 'Bölge Müdürü', 'branch_manager', null, 25],
    ['rezervasyon', 'Çağrı Merkezi', 'reservation', null, 10],
    ['saha', 'Saha Personeli (SAW)', 'field', b2, 5],
    ['muhasebe', 'Muhasebe', 'accounting', null, 0],
    ['filo', 'Filo Sorumlusu', 'fleet', null, 0],
    ['personel', 'Ofis Personeli', 'staff', 1, 10],
  ];
  const uid: Record<string, number> = { admin: 1 };
  for (const [username, full_name, role, branch_id, limit] of users) {
    uid[username] = await insertRow('users', { username, full_name, role, branch_id, discount_limit_pct: limit, password_hash: hashPassword(`${username}123`) });
  }

  // ---------- Fiyatlandırma ----------
  const summer = await insertRow('seasons', { name: 'Yaz sezonu', start_date: `${day(0).slice(0, 4)}-06-01`, end_date: `${day(0).slice(0, 4)}-09-15`, priority: 10 });
  const holiday = await insertRow('seasons', { name: 'Yılbaşı', start_date: `${day(0).slice(0, 4)}-12-20`, end_date: `${Number(day(0).slice(0, 4)) + 1}-01-05`, priority: 20 });
  const plans: [string, number, number, number, number, number][] = [
    ['Ekonomi', 1250, 1150, 1050, 950, 850],
    ['Orta', 1850, 1700, 1550, 1400, 1250],
    ['Üst', 2700, 2500, 2300, 2100, 1900],
    ['SUV', 2950, 2750, 2550, 2350, 2150],
    ['Minivan', 1800, 1650, 1500, 1350, 1200],
    ['Lüks', 5400, 5100, 4800, 4500, 4200],
  ];
  for (const [category, a, b, c, d, e] of plans) {
    await insertRow('rate_plans', { name: `${category} standart`, category, band_1_3: a, band_4_7: b, band_8_14: c, band_15_29: d, band_30: e });
    await insertRow('rate_plans', { name: `${category} yaz`, category, season_id: summer, band_1_3: a * 1.3, band_4_7: b * 1.3, band_8_14: c * 1.3, band_15_29: d * 1.3, band_30: e * 1.3 });
  }
  await insertRow('rate_plans', { name: 'Ekonomi yılbaşı', category: 'Ekonomi', season_id: holiday, band_1_3: 1700, band_4_7: 1600, band_8_14: 1500, band_15_29: 1300, band_30: 1100 });
  await insertRow('rate_plans', { name: 'Ekonomi web', category: 'Ekonomi', channel: 'Web', band_1_3: 1150, band_4_7: 1050, band_8_14: 950, band_15_29: 880, band_30: 800 });
  await insertRow('coupons', { code: 'ERKEN10', description: 'Erken rezervasyon %10', type: 'percent', value: 10, early_booking_days: 14 });
  await insertRow('coupons', { code: 'HAFTA500', description: '7+ gün 500 ₺ indirim', type: 'amount', value: 500, min_days: 7, max_uses: 100 });
  await insertRow('coupons', { code: 'SUVYAZ', description: 'SUV grubunda %15', type: 'percent', value: 15, category: 'SUV', valid_to: day(60) });
  await insertRow('deposit_rules', { category: 'Lüks', amount: 30000, note: 'Lüks segment provizyonu' });
  await insertRow('deposit_rules', { driver_age_under: 25, amount: 10000, note: 'Genç sürücü depozitosu' });
  await insertRow('deposit_rules', { license_years_under: 3, amount: 8000, note: 'Yeni ehliyet depozitosu' });
  const ag1 = await insertRow('agencies', { name: 'Tatil Dünyası Turizm', contact_name: 'Seda Uç', phone: '0212 444 00 00', email: 'b2b@tatildunyasi.example', tax_no: '9876543210', commission_pct: 12 });
  const ag2 = await insertRow('agencies', { name: 'RentBroker.com', contact_name: 'API Desk', email: 'ops@rentbroker.example', commission_pct: 15 });

  // ---------- Araçlar ----------
  const vehicles: [string, string, string, number, string, string, string, number, number, number, string][] = [
    ['34 ABC 101', 'Fiat', 'Egea', 2023, 'Ekonomi', 'Dizel', 'Manuel', 1200, 5000, 45210, 'CDMR'],
    ['34 ABC 102', 'Renault', 'Clio', 2024, 'Ekonomi', 'Benzin', 'Otomatik', 1350, 5000, 18300, 'EDAR'],
    ['34 ABC 103', 'Toyota', 'Corolla', 2023, 'Orta', 'Hibrit', 'Otomatik', 1800, 7500, 32500, 'IDAH'],
    ['34 ABC 104', 'Volkswagen', 'Passat', 2022, 'Üst', 'Dizel', 'Otomatik', 2600, 10000, 67800, 'SDAR'],
    ['34 ABC 105', 'Hyundai', 'Tucson', 2024, 'SUV', 'Benzin', 'Otomatik', 2900, 10000, 12100, 'IFAR'],
    ['34 ABC 106', 'Ford', 'Tourneo Courier', 2023, 'Minivan', 'Dizel', 'Manuel', 1700, 7500, 28900, 'MVMR'],
    ['34 ABC 107', 'BMW', '520i', 2024, 'Lüks', 'Benzin', 'Otomatik', 5200, 25000, 9400, 'PDAR'],
    ['06 DEF 201', 'Peugeot', '2008', 2023, 'SUV', 'Benzin', 'Otomatik', 2200, 7500, 25400, 'CFAR'],
    ['06 DEF 202', 'Dacia', 'Sandero', 2024, 'Ekonomi', 'Benzin', 'Manuel', 1100, 4000, 8700, 'EDMR'],
    ['06 DEF 203', 'Honda', 'Civic', 2023, 'Orta', 'Benzin', 'Otomatik', 1900, 7500, 29900, 'IDAR'],
    ['34 ABC 108', 'Fiat', 'Egea Cross', 2024, 'Ekonomi', 'Benzin', 'Otomatik', 1300, 5000, 6400, 'CFAR'],
    ['34 ABC 109', 'Renault', 'Megane', 2021, 'Orta', 'Dizel', 'Otomatik', 1700, 7500, 98500, 'IDAR'],
  ];
  const vIds = await mapSeq(vehicles, async ([plate, brand, model, year, category, fuel, trans, rate, dep, km, acriss], i) => {
    const id = await insertRow('vehicles', {
      plate, brand, model, year, category, fuel_type: fuel, transmission: trans, daily_rate: rate, deposit_amount: dep, acriss,
      current_km: km, km_limit_per_day: 300, extra_km_fee: 5, seats: category === 'Minivan' ? 7 : 5, luggage: category === 'Minivan' ? 4 : 2,
      branch_id: plate.startsWith('06') ? b3 : i % 3 === 0 ? b2 : 1, parking_spot: `${plate.startsWith('06') ? 'E' : i % 3 === 0 ? 'S' : 'M'}-${10 + i}`,
      fuel_capacity: category === 'Lüks' || category === 'SUV' ? 60 : 50, hgs_tag_no: `HGS${7000000 + i}`, hgs_balance: i === 4 ? 120 : 600 + i * 50,
      next_service_km: Math.ceil((km + 2000) / 15000) * 15000, next_service_date: day(30 + i * 10),
      purchase_date: `${year}-0${(i % 8) + 1}-15`, purchase_price: rate * 800, financing: i % 3 === 0 ? 'leasing' : i % 3 === 1 ? 'loan' : 'cash',
      monthly_installment: i % 3 === 2 ? null : Math.round(rate * 12), depreciation_years: 4, residual_value: rate * 380,
      color: ['Beyaz', 'Gri', 'Siyah', 'Kırmızı', 'Mavi'][i % 5], vin: `VF1${String(1000000000000 + i * 7777).slice(0, 14)}`,
      status: i === 11 ? 'for_sale' : 'available',
    });
    const docs: [string, number, string][] = [['traffic_insurance', 20 + i * 30, 'Anadolu Sigorta'], ['kasko', 90 + i * 20, 'Axa Sigorta'], ['inspection', i === 3 ? -5 : 200 + i * 15, 'TÜVTÜRK'], ['exhaust', 150 + i * 5, 'TÜVTÜRK']];
    for (const [type, offset, provider] of docs) {
      await insertRow('vehicle_documents', { vehicle_id: id, type, provider, number: `${type.slice(0, 3).toUpperCase()}-${id}${offset}`, issued_at: day(offset - 365), expires_at: day(offset), cost: type === 'kasko' ? rate * 9 : type === 'traffic_insurance' ? 6500 : 0 });
    }
    await exec('UPDATE vehicles SET insurance_expiry = ?, kasko_expiry = ?, inspection_expiry = ? WHERE id = ?', day(20 + i * 30), day(90 + i * 20), day(i === 3 ? -5 : 200 + i * 15), id);
    return id;
  });

  // ---------- Müşteriler ----------
  const customers: [string, string, string, string, string, string, string, string][] = [
    ['Ahmet', 'Yılmaz', '1985-04-12', '0532 111 11 11', 'ahmet@example.com', 'B-123456', '2005-06-01', 'tr'],
    ['Ayşe', 'Demir', '1990-09-23', '0533 222 22 22', 'ayse@example.com', 'B-234567', '2010-03-15', 'tr'],
    ['Mehmet', 'Kaya', '1978-01-30', '0534 333 33 33', 'mehmet@example.com', 'B-345678', '1998-11-20', 'tr'],
    ['Zeynep', 'Çelik', '1995-12-05', '0535 444 44 44', 'zeynep@example.com', 'B-456789', '2015-07-07', 'tr'],
    ['Can', 'Şahin', '1988-07-19', '0536 555 55 55', 'can@example.com', 'B-567890', '2008-02-28', 'tr'],
    ['Elif', 'Aydın', '1992-03-08', '0537 666 66 66', 'elif@example.com', 'B-678901', '2012-09-12', 'tr'],
    ['Burak', 'Öztürk', '1983-11-11', '0538 777 77 77', 'burak@example.com', 'B-789012', '2003-05-05', 'tr'],
    ['Selin', 'Arslan', '2002-06-25', '0539 888 88 88', 'selin@example.com', 'B-890123', '2022-01-10', 'tr'],
    ['John', 'Smith', '1979-02-14', '+44 7700 900123', 'john.smith@example.co.uk', 'UK-SMITH790214', '1997-08-01', 'en'],
    ['Anna', 'Müller', '1987-10-03', '+49 151 2345678', 'anna.mueller@example.de', 'DE-B07X2', '2006-04-20', 'de'],
  ];
  const cIds = await mapSeq(customers, async ([first_name, last_name, birth_date, phone, email, license_no, license_date, lang], i) => {
    const foreign = lang !== 'tr';
    const id = await insertRow('customers', {
      first_name, last_name, birth_date, phone, email, license_no, license_date, license_class: 'B', preferred_language: lang,
      national_id: foreign ? null : tckn(i + 3), passport_no: foreign ? `P${1000000 + i}` : null, nationality: lang === 'en' ? 'GB' : lang === 'de' ? 'DE' : 'TR',
      license_expiry: day(400 + i * 200), address: foreign ? 'Hotel / turist' : `${['Kadıköy', 'Beşiktaş', 'Çankaya', 'Ataşehir'][i % 4]} / ${i % 4 === 2 ? 'Ankara' : 'İstanbul'}`,
    });
    await insertRow('consents', { customer_id: id, type: 'kvkk_notice', granted: 1, channel: 'Ofis', recorded_by: 1 });
    if (i % 2 === 0) await insertRow('consents', { customer_id: id, type: 'marketing_email', granted: 1, channel: 'Web' });
    if (i % 3 === 0) await insertRow('consents', { customer_id: id, type: 'marketing_sms', granted: 1, channel: 'Ofis', recorded_by: 1 });
    return id;
  });
  const corp = await insertRow('customers', {
    type: 'corporate', first_name: 'Deniz', last_name: 'Koç', company_name: 'Örnek Lojistik A.Ş.', tax_office: 'Mecidiyeköy',
    tax_no: '1234567890', phone: '0212 999 99 99', email: 'filo@ornek.com.tr', birth_date: '1980-02-02', national_id: tckn(42),
    license_no: 'B-901234', license_date: '2000-01-01', license_class: 'B', license_expiry: day(900), credit_limit: 150000,
    invoice_title: 'Örnek Lojistik Anonim Şirketi', invoice_address: 'Mecidiyeköy Yolu Cad. No:10 Şişli/İstanbul',
  });
  await insertRow('consents', { customer_id: corp, type: 'kvkk_notice', granted: 1, channel: 'Islak imza', recorded_by: 1 });
  await insertRow('drivers', { customer_id: corp, first_name: 'Murat', last_name: 'Er', national_id: tckn(43), birth_date: '1986-05-05', phone: '0541 000 11 22', license_no: 'B-555111', license_class: 'B', license_date: '2006-01-01', license_expiry: day(700) });
  await insertRow('drivers', { customer_id: corp, first_name: 'Gül', last_name: 'Tan', national_id: tckn(44), birth_date: '1990-08-08', phone: '0541 000 33 44', license_no: 'B-555222', license_class: 'B', license_date: '2011-01-01', license_expiry: day(30) });
  cIds.push(corp);
  await insertRow('customers', {
    first_name: 'Kemal', last_name: 'Kara', phone: '0540 000 00 00', blacklisted: 1, risk_score: 90, risk_note: '2 kez geç iade, ödenmemiş hasar',
    blacklist_reason: 'Ödenmemiş hasar bedeli', birth_date: '1975-05-05', license_no: 'B-000111', license_date: '1995-01-01', national_id: tckn(45),
  });

  // ---------- Kiralamalar ----------
  interface SeedRental {
    v: number; c: number; from: string; to: string; status: 'active' | 'returned' | 'closed'; endKmAdd?: number; fuel?: number; pay?: 'full' | 'half' | 'none';
    extras?: ExtraSelection[]; source?: string; agency?: number; hold?: number; nps?: number;
  }
  const rentalIds: number[] = [];
  async function addRental({ v, c, from, to, status, endKmAdd = 800, fuel = 8, pay = 'full', extras = [], source = 'Ofis', agency, hold = 0, nps }: SeedRental) {
    const vehicle = await getVehicle(vIds[v]);
    const customer = await getCustomer(cIds[c]);
    const q = await calcQuote({ vehicle, pickup_at: from, return_at: to, extras, channel: source, customer });
    const returned = status !== 'active';
    const agencyPct = agency ? (await get<{ commission_pct: number }>('SELECT commission_pct FROM agencies WHERE id = ?', agency)).commission_pct : 0;
    const id = await insertRow('rentals', {
      contract_no: `TMP-${crypto.randomUUID()}`, customer_id: customer.id, vehicle_id: vehicle.id,
      pickup_branch_id: vehicle.branch_id, return_branch_id: vehicle.branch_id, pickup_at: from, planned_return_at: to,
      actual_return_at: returned ? to : null, start_km: vehicle.current_km, end_km: returned ? vehicle.current_km + endKmAdd : null,
      start_fuel: 8, end_fuel: returned ? fuel : null, days: q.days, daily_rate: q.daily_rate, base_amount: q.base_amount,
      long_term_discount: q.long_term_discount, extras_amount: q.extras_amount, one_way_fee: 0, young_driver_fee: q.young_driver_fee,
      channel_markup: q.channel_markup, discount: 0, total_amount: q.total_amount, deposit_amount: q.deposit_amount, source,
      agency_id: agency ?? null, agency_commission: Math.round(q.total_amount * agencyPct) / 100, portal_token: token(),
      language: customer.preferred_language, signed_at: from, status, created_by: uid.personel,
      closed_at: status === 'closed' ? to : null, deposit_hold_amount: hold, deposit_hold_until: hold ? day(25) : null,
    });
    await exec('UPDATE rentals SET contract_no = ? WHERE id = ?', makeCode('KS', id), id);
    for (const l of q.extras) await insertRow('rental_extras', { rental_id: id, ...l });
    await insertRow('inspection_sessions', { rental_id: id, kind: 'checkout', km: vehicle.current_km, fuel: 8, cleanliness: 'clean', started_by: uid.saha, started_at: from.replace('T', ' '), completed_at: from.replace('T', ' ') });
    await insertRow('kabis_submissions', { rental_id: id, kind: 'open', status: 'sent', attempts: 1, reference_no: `EGM-${100000 + id}`, payload: '{}', sent_at: from });
    if (returned) {
      await insertRow('inspection_sessions', { rental_id: id, kind: 'checkin', km: vehicle.current_km + endKmAdd, fuel, cleanliness: 'normal', started_by: uid.saha, started_at: to.replace('T', ' '), completed_at: to.replace('T', ' ') });
      await insertRow('kabis_submissions', { rental_id: id, kind: 'close', status: v === 1 && status === 'returned' ? 'pending' : 'sent', attempts: 1, reference_no: v === 1 ? null : `EGM-${200000 + id}`, payload: '{}', sent_at: to });
      if (fuel < 8) await insertRow('rental_charges', { rental_id: id, type: 'fuel', description: `Yakıt eksiği: ${8 - fuel}/8`, amount: (8 - fuel) * 350 });
      await exec('UPDATE vehicles SET current_km = ? WHERE id = ?', vehicle.current_km + endKmAdd, vehicle.id);
    } else await exec("UPDATE vehicles SET status = 'rented' WHERE id = ?", vehicle.id);
    await recalcRental(id);
    const total = (await get<{ total_amount: number }>('SELECT total_amount FROM rentals WHERE id = ?', id)).total_amount;
    const base = { customer_id: customer.id, rental_id: id, created_by: uid.saha };
    if (pay !== 'none') await insertRow('payments', { ...base, type: 'payment', method: pay === 'full' ? 'pos' : 'cash', amount: pay === 'full' ? total : Math.round(total / 2), paid_at: from, reference: pay === 'full' ? `POS${id}${Date.now() % 10000}` : null });
    await insertRow('payments', { ...base, type: 'deposit_in', method: 'preauth', amount: q.deposit_amount, paid_at: from, reference: `PRV-${id}` });
    if (returned && !hold) await insertRow('payments', { ...base, type: 'deposit_out', method: 'preauth', amount: q.deposit_amount, paid_at: to, description: 'Provizyon kapatıldı' });
    if (hold && returned) await insertRow('payments', { ...base, type: 'deposit_out', method: 'preauth', amount: q.deposit_amount - hold, paid_at: to, description: 'Provizyon kısmi iade (HGS/ceza için tutulan hariç)' });
    if (nps !== undefined) await insertRow('nps_responses', { rental_id: id, score: nps, comment: nps >= 9 ? 'Çok hızlı teslim, teşekkürler' : nps <= 6 ? 'Teslimde bekledim' : null });
    rentalIds.push(id);
    return id;
  }

  // Geçmiş (kapanmış) kiralamalar — son ~5 ay
  let ci = 0;
  const channels = ['Ofis', 'Web', 'Telefon', 'Acente', 'Kurumsal', 'Marketplace'];
  for (let m = 150; m > 12; m -= 8) {
    const v = ((m / 8) | 0) % 11;
    const len = 2 + (m % 7);
    const src = channels[(m / 8) % channels.length | 0];
    await addRental({
      v, c: ci++ % cIds.length, from: at(-m), to: at(-m + len), status: 'closed', fuel: m % 4 === 0 ? 6 : 8, source: src,
      agency: src === 'Acente' ? ag1 : src === 'Marketplace' ? ag2 : undefined,
      extras: m % 3 ? [] : [{ extra_id: await extraId('full_coverage'), quantity: 1 }], nps: m % 2 ? 9 + (m % 2) : m % 5 ? 7 : 5,
    });
  }
  // İade alındı, depozito HGS/ceza için tutuluyor (kapanış bekliyor)
  const heldRental = await addRental({ v: 1, c: 8, from: at(-9), to: at(-2, 18), status: 'returned', hold: 2000, source: 'Web' });
  // Kapanmış ama sonradan HGS/ceza gelecek kiralama
  const postRental = await addRental({ v: 2, c: 9, from: at(-20), to: at(-15), status: 'closed', source: 'Marketplace', agency: ag2 });
  // Bakiyesi açık (kısmi ödeme) kapanmamış iade
  await addRental({ v: 9, c: 5, from: at(-50), to: at(-45), status: 'returned', pay: 'half', fuel: 5 });
  // Aktif kiralamalar
  await addRental({ v: 0, c: 1, from: at(-3), to: at(2), status: 'active', extras: [{ extra_id: await extraId('unlimited_km'), quantity: 1 }] });
  await addRental({ v: 4, c: 2, from: at(-5), to: at(0, 18), status: 'active', pay: 'half', source: 'Telefon' });
  await addRental({ v: 7, c: 3, from: at(-10), to: at(-1), status: 'active', pay: 'half' }); // gecikmiş
  const corpRental = await addRental({ v: 5, c: cIds.indexOf(corp), from: at(-12), to: at(18), status: 'active', source: 'Kurumsal', pay: 'none' });
  await insertRow('rental_drivers', { rental_id: corpRental, driver_id: (await get<{ id: number }>('SELECT id FROM drivers WHERE customer_id = ? ORDER BY id LIMIT 1', corp)).id });

  // ---------- Rezervasyonlar ----------
  async function addReservation({ v, c, category, from, to, status = 'confirmed', extras = [], source = 'Web', agency, coupon, option = false }: {
    v?: number; c: number; category?: string; from: string; to: string; status?: string; extras?: ExtraSelection[]; source?: string; agency?: number; coupon?: string; option?: boolean;
  }) {
    const vehicle = v === undefined ? null : await getVehicle(vIds[v]);
    const customer = await getCustomer(cIds[c]);
    const q = await calcQuote({ vehicle, category: category ?? vehicle?.category, pickup_at: from, return_at: to, extras, channel: source, coupon_code: coupon, customer });
    const agencyPct = agency ? (await get<{ commission_pct: number }>('SELECT commission_pct FROM agencies WHERE id = ?', agency)).commission_pct : 0;
    const branch = vehicle?.branch_id ?? 1;
    const id = await insertRow('reservations', {
      code: `TMP-${crypto.randomUUID()}`, customer_id: customer.id, vehicle_id: vehicle?.id ?? null, category: q.category,
      pickup_branch_id: branch, return_branch_id: branch, pickup_at: from, return_at: to, days: q.days, daily_rate: q.daily_rate,
      base_amount: q.base_amount, long_term_discount: q.long_term_discount, extras_amount: q.extras_amount, one_way_fee: 0,
      young_driver_fee: q.young_driver_fee, channel_markup: q.channel_markup, coupon_id: q.coupon_id, coupon_discount: q.coupon_discount,
      rate_plan_id: q.rate_plan_id, discount: 0, total_amount: q.total_amount, deposit_amount: q.deposit_amount, status, source,
      agency_id: agency ?? null, agency_commission: Math.round(q.total_amount * agencyPct) / 100, portal_token: token(),
      option_expires_at: option ? at(0, 23, 59) : null, created_by: uid.rezervasyon,
    });
    await exec('UPDATE reservations SET code = ? WHERE id = ?', makeCode('RZ', id), id);
    for (const l of q.extras) await insertRow('reservation_extras', { reservation_id: id, ...l });
    if (q.coupon_id) await exec('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', q.coupon_id);
    return id;
  }
  const r1 = await addReservation({ v: 1, c: 4, from: at(0, 14), to: at(3, 14), extras: [{ extra_id: await extraId('Bebek Koltuğu'), quantity: 1 }] });
  await addReservation({ c: 6, category: 'Orta', from: at(0, 16, 30), to: at(4, 16, 30), source: 'Telefon' }); // grup — bugün atanacak
  await addReservation({ v: 2, c: 5, from: at(1), to: at(8), status: 'pending', option: true });
  await addReservation({ v: 6, c: 6, from: at(4), to: at(6), extras: [{ extra_id: await extraId('delivery'), quantity: 1 }] });
  await addReservation({ v: 9, c: 7, from: at(7), to: at(40), coupon: 'HAFTA500' });
  await addReservation({ c: 0, category: 'SUV', from: at(2), to: at(9), source: 'Acente', agency: ag1 });
  await addReservation({ c: 8, category: 'Ekonomi', from: at(20), to: at(27), source: 'Marketplace', agency: ag2, coupon: 'ERKEN10' });
  await addReservation({ c: 3, category: 'Lüks', from: at(4, 9), to: at(6, 9), status: 'waitlist', source: 'Web' });
  await exec('INSERT INTO payments(customer_id, reservation_id, type, method, amount, paid_at, description, created_by) VALUES (?,?,?,?,?,?,?,?)',
    cIds[4], r1, 'payment', 'credit_card', 1000, at(-2), 'Rezervasyon ön ödemesi', uid.rezervasyon);
  // Limit üstü indirim: onay bekleyen rezervasyon
  const rDisc = await addReservation({ v: 10, c: 2, from: at(10), to: at(15), status: 'pending', source: 'Ofis' });
  await exec('UPDATE reservations SET discount = 1500, total_amount = total_amount - 1500 WHERE id = ?', rDisc);
  const ap = await insertRow('approvals', { type: 'discount', entity: 'reservation', entity_id: rDisc, amount: 1500, reason: 'İndirim kullanıcı limitini (%10) aşıyor', requested_by: uid.personel });
  await exec('UPDATE reservations SET approval_id = ? WHERE id = ?', ap, rDisc);

  // ---------- Bakım, hasar, masraf ----------
  await insertRow('maintenance', { vehicle_id: vIds[3], type: 'repair', description: 'Fren balatası değişimi', start_date: day(-1), km: 67800, cost: 4500, vendor: 'Yetkili Servis', status: 'in_progress' });
  await exec("UPDATE vehicles SET status = 'maintenance' WHERE id = ?", vIds[3]);
  await insertRow('maintenance', { vehicle_id: vIds[5], type: 'periodic', description: '30.000 km bakımı', start_date: day(25), end_date: day(25), cost: 6000, vendor: 'Yetkili Servis', status: 'scheduled' });
  await insertRow('maintenance', { vehicle_id: vIds[0], type: 'tire', description: 'Kış lastiği takımı', start_date: day(-40), end_date: day(-40), cost: 12000, vendor: 'Lastikçi', status: 'completed' });
  await insertRow('damages', { vehicle_id: vIds[2], reported_at: day(-140), location: 'Sağ ön çamurluk', description: 'Çizik', severity: 'minor', repair_cost: 2500, customer_charge: 0, status: 'repaired' });
  await insertRow('damages', { vehicle_id: vIds[8], reported_at: day(-3), location: 'Arka tampon', description: 'Göçük', severity: 'moderate', repair_cost: 6000, status: 'open', mark_x: 0.5, mark_y: 0.95, mark_type: 'dent' });
  for (let i = 0; i < 6; i++) {
    await insertRow('expenses', { category: 'Kira', amount: 45000, expense_date: day(-30 * i - 1), description: 'Ofis kirası', created_by: uid.muhasebe });
    await insertRow('expenses', { category: 'Yıkama/Temizlik', amount: 3500, expense_date: day(-30 * i - 5), created_by: uid.muhasebe });
    await insertRow('expenses', { vehicle_id: vIds[i], category: 'Yakıt', amount: 1500, expense_date: day(-30 * i - 10), created_by: uid.muhasebe });
  }
  await insertRow('vehicle_transfers', { vehicle_id: vIds[9], from_branch_id: b3, to_branch_id: 1, planned_at: at(1, 8), driver: 'Hasan Usta', cost: 3500, status: 'requested', notes: 'İstanbul yaz talebi', created_by: uid.filo });

  // ---------- İş emirleri ----------
  await insertRow('tasks', { type: 'delivery', title: `Adrese teslim · ${(await get<{ code: string }>('SELECT code FROM reservations WHERE id = ?', r1)).code}`, reservation_id: r1, vehicle_id: vIds[1], branch_id: 1, assigned_to: uid.saha, due_at: at(0, 13, 30), address: 'Bağdat Cad. No:100 Kadıköy', priority: 'high', created_by: uid.rezervasyon });
  await insertRow('tasks', { type: 'wash', title: 'İç-dış yıkama', vehicle_id: vIds[10], branch_id: 1, due_at: at(0, 11), priority: 'normal', created_by: uid.saha });
  await insertRow('tasks', { type: 'roadside', title: 'Yol yardım talebi · lastik patladı', rental_id: rentalIds[rentalIds.length - 3], vehicle_id: vIds[4], due_at: at(0, 9), address: 'TEM Otoyolu Çamlıca gişeleri', priority: 'urgent', notes: 'Müşteri portal üzerinden bildirdi', created_by: null });

  // ---------- NPS & mesajlar ----------

  // ---------- HGS ve cezalar (eşleştirme motoru ile) ----------
  const admin = { id: 1, username: 'admin', full_name: 'Sistem Yöneticisi', role: 'admin' as const, branch_id: null, discount_limit_pct: 100 };
  const plate = (i: number) => vehicles[i][0];
  const post = (await get<{ pickup_at: string }>('SELECT pickup_at FROM rentals WHERE id = ?', postRental)).pickup_at;
  const held = (await get<{ pickup_at: string }>('SELECT pickup_at FROM rentals WHERE id = ?', heldRental)).pickup_at;
  const tr = (s: string, addH: number) => {
    const d = new Date(s);
    d.setHours(d.getHours() + addH);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const csv = [
    'plaka;tarih;gise;tutar',
    `${plate(2)};${tr(post, 5)};Osmangazi Köprüsü;995,00`,
    `${plate(2)};${tr(post, 30)};Kuzey Marmara Otoyolu;212,50`,
    `${plate(1)};${tr(held, 26)};Çamlıca Gişeleri;48,50`,
    `${plate(0)};${tr(at(-1), 3)};15 Temmuz Köprüsü;59,00`,
    `${plate(11)};${tr(at(-30), 1)};Avrasya Tüneli;220,00`,
    `99 ZZZ 999;${tr(at(-4), 1)};Bilinmeyen gişe;35,00`,
  ].join('\n');
  await withContext({ user: admin, ip: '127.0.0.1', userAgent: 'seed' }, async () => {
    await importTolls(csv, admin);
    // Kapanmış sözleşmeye sonradan gelen ceza (kapanış sonrası borç akışı)
    const fine1 = await insertRow('traffic_fines', { vehicle_id: vIds[2], plate: plate(2), fine_no: 'TK2025-001', violation_at: (() => { const d = new Date(post); d.setHours(d.getHours() + 8); return fmtDateTime(d); })(), type: 'speed', location: 'D100 Kartal', amount: 2167, notified_at: day(-4), discount_deadline: day(11), rental_id: postRental, customer_id: cIds[9], status: 'matched', created_by: 1 });
    void fine1;
    await insertRow('traffic_fines', { vehicle_id: vIds[0], plate: plate(0), fine_no: 'TK2025-002', violation_at: at(-2, 15), type: 'parking', location: 'Beşiktaş', amount: 1054, notified_at: day(-13), discount_deadline: day(2), status: 'new', created_by: 1 });
    await insertRow('traffic_fines', { vehicle_id: vIds[5], plate: plate(5), fine_no: 'TK2025-003', violation_at: at(-120, 11), type: 'eds', location: 'E5 Avcılar', amount: 1054, notified_at: day(-100), status: 'new', created_by: 1 });
    // Kapanmış kiralamaların bir kısmı için e-Arşiv faturası (PDF ile)
    const closed = await all<{ id: number }>("SELECT id FROM rentals WHERE status = 'closed' ORDER BY id DESC LIMIT 6");
    for (const r of closed) await issueInvoiceForRental(r.id, admin);
  });
  // Bakiyesi sıfırlanmış iade edilen sözleşmeleri kapat
  for (const r of await all<Rental>("SELECT * FROM rentals WHERE status = 'returned'")) {
    const f = await rentalFinance(r);
    if (Math.abs(f.balance) < 0.01 && f.deposit_held < 0.01) await exec("UPDATE rentals SET status = 'closed', closed_at = actual_return_at WHERE id = ?", r.id);
  }

  await exec("UPDATE settings SET value = 'Demo Rent A Car A.Ş.' WHERE key = 'company_name'");
  await exec("UPDATE settings SET value = '0850 000 00 00' WHERE key = 'company_phone'");
  await exec("UPDATE settings SET value = 'Büyükdere Cad. No:1 Şişli / İstanbul' WHERE key = 'company_address'");
  await exec("UPDATE settings SET value = '1111111111' WHERE key = 'company_tax_no'");
  await exec("UPDATE settings SET value = 'Şişli' WHERE key = 'company_tax_office'");
  await exec("UPDATE settings SET value = 'simulate' WHERE key = 'kabis_mode'");

}
