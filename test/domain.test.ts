import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDb, one, all, run } from '../lib/db';
import { fmtDateTime, HttpError } from '../lib/core';
import { calcDays, calcQuote } from '../lib/rules';
import { login } from '../lib/auth';
import { handler } from '../lib/api';
import { withContext } from '../lib/context';
import { saveFile } from '../lib/files';
import { REQUIRED_ANGLES } from '../lib/inspection';
import { createUser, saveBranch } from '../lib/domain/admin';
import { createVehicle, getVehicle, createTransfer, advanceTransfer } from '../lib/domain/vehicles';
import { createCustomer, anonymizeCustomer, exportCustomerData, validTckn } from '../lib/domain/customers';
import { savePricing } from '../lib/domain/pricing';
import { assignVehicle, createReservation, getReservation, quote, transitionReservation } from '../lib/domain/reservations';
import {
  activateRental, addDamageMark, addInspectionPhoto, completeCheckin, getRental, previewCheckin, releaseDepositHold, signRental,
  startCheckin, startCheckoutFromReservation, startWalkIn, updateSession, swapVehicle,
} from '../lib/domain/agreements';
import { createPayment } from '../lib/domain/payments';
import { decideApproval, listApprovals } from '../lib/domain/approvals';
import { importTolls, createFine, fineAction, listTolls } from '../lib/domain/tolls';
import { customerStatement, listInvoices, receivablesAging, creditNote } from '../lib/domain/finance';
import { listKabis, sendKabis } from '../lib/domain/kabis';
import { getPortal, portalCheckin, portalNps } from '../lib/domain/portal';
import { createMaintenance, updateMaintenance } from '../lib/domain/service';
import { calendar, dashboard, reports } from '../lib/domain/reports';
import type { Customer, SessionUser, Vehicle } from '../lib/types';

// ---------- yardımcılar ----------

const at = (days: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return fmtDateTime(d);
};

function rejects(fn: () => unknown, status: number, msg?: RegExp) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof HttpError, `HttpError bekleniyordu: ${e}`);
    assert.equal(e.status, status, e.message);
    if (msg) assert.match(e.message, msg);
    return true;
  });
}

async function rejectsAsync(fn: () => Promise<unknown>, status: number) {
  await assert.rejects(fn, (e: unknown) => e instanceof HttpError && e.status === status);
}

/** Gerçek (geçerli) PNG üretir: imza ve fotoğraflar için. */
function png(w = 64, h = 32, seed = 1): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 7 + y * 13 + seed * 31) & 0xff;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sigDataUrl = (seed: number) => 'data:image/png;base64,' + png(200, 80, seed).toString('base64');

let admin: SessionUser;
let field: SessionUser;
let staff: SessionUser;
let vehicle: Vehicle;
let vehicle2: Vehicle;
let suv: Vehicle;
let customer: Customer;
const ctx = (user: SessionUser) => <T>(fn: () => T) => withContext({ user, ip: '127.0.0.1', userAgent: 'test' }, fn);

function photographAll(sessionId: number, rentalId: number, user: SessionUser) {
  for (const [i, angle] of REQUIRED_ANGLES.entries()) {
    ctx(user)(() => {
      const f = saveFile({ kind: 'photo', entity: 'rental', entityId: rentalId, name: `${angle}.png`, mime: 'image/png', data: png(32, 24, i + sessionId * 50) });
      addInspectionPhoto(sessionId, angle, f);
    });
  }
}

before(() => {
  process.env.DB_FILE = ':memory:';
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-test-'));
  openDb(':memory:');
  admin = login('admin', 'admin123').user;
  createUser({ username: 'saha', full_name: 'Saha Personeli', password: 'secret1', role: 'field', discount_limit_pct: 5 });
  createUser({ username: 'rez', full_name: 'Rezervasyon', password: 'secret1', role: 'reservation', discount_limit_pct: 10 });
  field = login('saha', 'secret1').user;
  staff = login('rez', 'secret1').user;
});

test('gün hesabı ve T.C. kimlik doğrulama', () => {
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-02T11:59', 2), 1);
  assert.equal(calcDays('2026-01-01T10:00', '2026-01-02T12:30', 2), 2);
  assert.ok(validTckn('10000000146'));
  assert.ok(!validTckn('12345678901'));
});

test('rol bazlı yetki: route handler', async () => {
  const route = handler(() => 'ok', { perm: 'pricing.manage' });
  const tokenOf = (u: string) => login(u, u === 'admin' ? 'admin123' : 'secret1').token;
  const req = (u: string) => new Request('http://x/api', { headers: { authorization: `Bearer ${tokenOf(u)}` } });
  assert.equal((await route(req('admin'))).status, 200);
  assert.equal((await route(req('saha'))).status, 403);
  assert.equal((await route(new Request('http://x/api'))).status, 401);
});

test('araç, müşteri ve fiyat tabloları', () => {
  vehicle = createVehicle({ plate: '34 tst 01', brand: 'Fiat', model: 'Egea', category: 'Ekonomi', daily_rate: 1000, deposit_amount: 5000, current_km: 10000, km_limit_per_day: 200, extra_km_fee: 5, fuel_capacity: 48, hgs_tag_no: 'HGS-1' });
  vehicle2 = createVehicle({ plate: '34 TST 02', brand: 'Renault', model: 'Clio', category: 'Ekonomi', daily_rate: 1100, deposit_amount: 4000 });
  suv = createVehicle({ plate: '34 TST 03', brand: 'Hyundai', model: 'Tucson', category: 'SUV', daily_rate: 2500, deposit_amount: 10000 });
  rejects(() => createCustomer({ first_name: 'A', last_name: 'B', phone: '1', national_id: '12345678901' }), 400);
  customer = createCustomer({
    first_name: 'Ali', last_name: 'Veli', phone: '0555 555 55 55', email: 'ali@example.com', national_id: '10000000146',
    birth_date: '1990-01-01', license_no: 'B1', license_date: '2010-01-01', consent_kvkk_notice: true,
  }, admin);

  // Gün bandı fiyat planı + sezon + kanal
  savePricing('plan', null, { name: 'Ekonomi genel', category: 'Ekonomi', band_1_3: 900, band_4_7: 850, band_8_14: 800, band_15_29: 700, band_30: 600 });
  const season = savePricing('season', null, { name: 'Yaz', start_date: at(40).slice(0, 10), end_date: at(80).slice(0, 10), priority: 1 }).seasons[0];
  savePricing('plan', null, { name: 'Ekonomi yaz', category: 'Ekonomi', season_id: season.id, band_1_3: 1500, band_4_7: 1400, band_8_14: 1300, band_15_29: 1200, band_30: 1100 });
  let q = calcQuote({ category: 'Ekonomi', pickup_at: at(1), return_at: at(5) });
  assert.equal(q.rate_source, 'plan');
  assert.equal(q.daily_rate, 850); // 4–7 gün bandı
  assert.equal(q.long_term_discount, 0);
  q = calcQuote({ category: 'Ekonomi', pickup_at: at(45), return_at: at(47) });
  assert.equal(q.daily_rate, 1500); // sezon
  q = calcQuote({ category: 'Ekonomi', pickup_at: at(1), return_at: at(3), channel: 'Web' }); // web kanalı -%5
  assert.equal(q.channel_markup, -90);
  // Kupon + genç sürücü + depozito kuralı
  savePricing('coupon', null, { code: 'yaz10', type: 'percent', value: 10, min_days: 2 });
  savePricing('deposit_rule', null, { driver_age_under: 25, amount: 8000, note: 'Genç sürücü depozitosu' });
  const young = createCustomer({ first_name: 'Genç', last_name: 'Sürücü', phone: '2', birth_date: at(-365 * 23).slice(0, 10), license_no: 'Y1', license_date: at(-365 * 3).slice(0, 10) });
  q = calcQuote({ vehicle, pickup_at: at(1), return_at: at(3), coupon_code: 'YAZ10', customer: young });
  assert.equal(q.coupon_discount, 180);
  assert.equal(q.young_driver_fee, 400);
  assert.equal(q.deposit_amount, 8000);
  rejects(() => calcQuote({ vehicle, pickup_at: at(1), return_at: at(2), coupon_code: 'YAZ10' }), 400, /en az 2/);
});

let reservationId: number;

test('grup rezervasyonu, overbooking ve bekleme listesi', () => {
  const g1 = ctx(admin)(() => createReservation({ customer_id: customer.id, category: 'SUV', pickup_at: at(10), return_at: at(12) }, admin));
  assert.equal(g1.vehicle_id, null);
  assert.equal(g1.status, 'confirmed');
  const c2 = createCustomer({ first_name: 'Ayşe', last_name: 'Kaya', phone: '3', birth_date: '1985-01-01', license_no: 'L2', license_date: '2005-01-01' });
  rejects(() => createReservation({ customer_id: c2.id, category: 'SUV', pickup_at: at(11), return_at: at(13) }, admin), 409, /bekleme/i);
  const w = createReservation({ customer_id: c2.id, category: 'SUV', pickup_at: at(11), return_at: at(13), waitlist: true }, admin);
  assert.equal(w.status, 'waitlist');
  rejects(() => transitionReservation(w.id, 'confirm', {}, admin), 409);
  // Atama ve iptal sonrası bekleme listesi onaylanabilir
  assignVehicle(g1.id, suv.id);
  const cancelled = transitionReservation(g1.id, 'cancel', { reason: 'Vazgeçti' }, admin);
  assert.equal(cancelled.cancellation_fee, 0); // 48 saatten önce ücretsiz
  assert.equal(transitionReservation(w.id, 'confirm', {}, admin).status, 'confirmed');
});

test('indirim onay akışı', () => {
  const r = ctx(staff)(() => createReservation({ customer_id: customer.id, vehicle_id: vehicle2.id, pickup_at: at(20), return_at: at(22), discount: 600 }, staff));
  assert.equal(r.status, 'pending');
  assert.ok(r.pending_approval);
  rejects(() => transitionReservation(r.id, 'confirm', {}, admin), 409, /onay/i);
  ctx(admin)(() => decideApproval(r.pending_approval!.id, true, 'uygun', admin));
  assert.equal(getReservation(r.id).status, 'confirmed');
  assert.equal(getReservation(r.id).discount, 600);
});

let rentalId: number;

test('teslim: zorunlu fotoğraf, imza bütünlüğü ve aktivasyon', async () => {
  const r = ctx(admin)(() => createReservation({ customer_id: customer.id, vehicle_id: vehicle.id, pickup_at: at(0, 23), return_at: at(4), prepayment: 1000 }, admin));
  reservationId = r.id;
  const draft = ctx(field)(() => startCheckoutFromReservation(r.id, {}, field));
  rentalId = draft.id;
  assert.equal(draft.status, 'draft');
  assert.equal(draft.finance.paid, 1000);
  assert.equal(getReservation(r.id).status, 'converted');
  const sid = draft.checkout!.id;
  rejects(() => signRental(rentalId, { purpose: 'checkout', signer_type: 'customer', signer_name: 'Ali Veli', image: sigDataUrl(1) }, field), 409, /fotoğraf/i);

  photographAll(sid, rentalId, field);
  ctx(field)(() => updateSession(sid, { km: 10050, fuel: 8, cleanliness: 'clean', checklist: { 'Yangın söndürücü': true, 'Üçgen reflektör': true, Stepne: true } }));
  ctx(field)(() => addDamageMark(sid, { x: 20, y: 30, type: 'scratch', severity: 'minor', note: 'Ön tampon' }));
  ctx(field)(() => signRental(rentalId, { purpose: 'checkout', signer_type: 'customer', signer_name: 'Ali Veli', image: sigDataUrl(1), stroke_count: 5 }, field));
  ctx(field)(() => signRental(rentalId, { purpose: 'checkout', signer_type: 'staff', image: sigDataUrl(2) }, field));
  // İmzadan sonra km değişirse imzalar geçersizleşir
  ctx(field)(() => updateSession(sid, { km: 10060 }));
  await rejectsAsync(() => activateRental(rentalId, {}, field), 409);
  ctx(field)(() => signRental(rentalId, { purpose: 'checkout', signer_type: 'customer', signer_name: 'Ali Veli', image: sigDataUrl(3) }, field));
  ctx(field)(() => signRental(rentalId, { purpose: 'checkout', signer_type: 'staff', image: sigDataUrl(4) }, field));
  // Saha personeli tahsilat limiti
  await rejectsAsync(() => activateRental(rentalId, { payment_amount: 999999 }, field), 403);

  const active = await ctx(field)(() => activateRental(rentalId, { deposit_collected: 5000, deposit_method: 'preauth', payment_amount: 2400, payment_method: 'pos' }, field));
  assert.equal(active.status, 'active');
  assert.equal(active.start_km, 10060);
  assert.equal(active.finance.deposit_held, 5000);
  assert.equal(getVehicle(vehicle.id).status, 'rented');
  assert.ok(active.documents.some((d) => JSON.parse(d.meta!).doc === 'contract'), 'imzalı sözleşme PDF üretilmeli');
  assert.equal(listKabis().filter((k) => k.rental_id === rentalId && k.kind === 'open').length, 1);
  assert.ok(one("SELECT 1 FROM message_log WHERE template_code = 'contract_sent' AND entity_id = ?", rentalId));
  assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'rental.sign' AND ip = '127.0.0.1'"));
});

test('iade: fotoğraf, yeni hasar, kayıp ekipman, litre bazlı yakıt, depozito tutma, fatura', async () => {
  const r = ctx(field)(() => startCheckin(rentalId, field));
  const sid = r.checkin!.id;
  ctx(field)(() => updateSession(sid, { km: 10060 + 1500, fuel: 6, cleanliness: 'dirty', checklist: { 'Yangın söndürücü': true, 'Üçgen reflektör': false, Stepne: true } }));
  const withMark = ctx(field)(() => addDamageMark(sid, { x: 70, y: 40, type: 'dent', severity: 'moderate', note: 'Sağ kapı göçük' }));
  const markId = withMark.marks[0].id;
  const body = { actual_return_at: at(6, 15), damages: [{ mark_id: markId, customer_charge: 1500, repair_cost: 2500 }], deposit_action: 'hold', hold_amount: 1000 };
  const p = previewCheckin(rentalId, body);
  const byType = Object.fromEntries(p.charges.map((c) => [c.type, c.amount]));
  assert.ok(byType.late_return > 0, 'geç iade');
  assert.ok(byType.extra_km > 0, 'km aşımı');
  assert.equal(byType.fuel, 790); // 2/8 × 48 L = 12 L × 45 + 250 servis
  assert.equal(byType.cleaning, 750);
  assert.equal(byType.missing_equipment, 300); // Üçgen reflektör
  assert.equal(byType.damage, 1500);
  // Fotoğraf eksik → imza alınamaz; fotoğraf sonrası müşteri imzası olmadan tamamlanamaz
  rejects(() => signRental(rentalId, { purpose: 'checkin', signer_type: 'customer', signer_name: 'Ali Veli', image: sigDataUrl(9) }, field), 409);
  photographAll(sid, rentalId, field);
  await rejectsAsync(() => completeCheckin(rentalId, body, field), 409);
  // Saha personeli ücret affı yapamaz
  ctx(field)(() => signRental(rentalId, { purpose: 'checkin', signer_type: 'customer', signer_name: 'Ali Veli', image: sigDataUrl(9) }, field));
  await rejectsAsync(() => completeCheckin(rentalId, { ...body, waive_fuel: true }, field), 403);

  // Bakiye: tutulan 1000 ₺ hariç depozito mahsup edilir, kalanı kartla tahsil edilir
  const due = Math.round((p.balance - (5000 - 1000)) * 100) / 100;
  const done = await ctx(field)(() => completeCheckin(rentalId, { ...body, payment_amount: due, payment_method: 'pos' }, field));
  assert.equal(done.status, 'returned');
  // İade ücretleri toplamı değiştirse de teslim imzaları (imzalı sözleşme özeti) geçerli kalır
  assert.deepEqual(done.sig_valid.checkout, { customer: true, staff: true });
  assert.equal(done.sig_valid.checkin.customer, true);
  assert.equal(done.total_amount, Math.round((p.new_total) * 100) / 100);
  assert.equal(done.deposit_hold_amount, 1000);
  assert.equal(done.finance.deposit_held, 1000);
  assert.ok(done.finance.balance <= 0.01, `bakiye depozitodan mahsup edilmeli (${done.finance.balance})`);
  assert.equal(done.damages.length, 1);
  assert.equal(getVehicle(vehicle.id).status, 'available');
  assert.equal(getVehicle(vehicle.id).current_km, 11560);
  const inv = listInvoices({ rental_id: String(rentalId) });
  assert.equal(inv.length, 1);
  assert.equal(inv[0].total, done.total_amount);
  assert.ok(inv[0].pdf_file_id);
  assert.equal(listKabis().filter((k) => k.rental_id === rentalId).length, 2);
  assert.ok(done.documents.some((d) => JSON.parse(d.meta!).doc === 'settlement'));
});

test('HGS içe aktarma: kapanış sonrası ek borç, istisna kuyruğu, depozito mahsubu ve kapanış', async () => {
  const r = getRental(rentalId);
  const inRental = r.pickup_at.replace('T', ' ');
  const csv = `Plaka;Tarih;Gişe;Tutar\n${vehicle.plate};${inRental.slice(8, 10)}.${inRental.slice(5, 7)}.${inRental.slice(0, 4)} ${inRental.slice(11, 16)};Avrasya Tüneli;"210,50"\n99 ZZ 999;01.01.2026 10:00;FSM;45\n${vehicle.plate};${inRental.slice(8, 10)}.${inRental.slice(5, 7)}.${inRental.slice(0, 4)} ${inRental.slice(11, 16)};Avrasya Tüneli;"210,50"`;
  const res = ctx(admin)(() => importTolls(csv, admin));
  assert.equal(res.imported, 2);
  assert.equal(res.duplicates, 1);
  assert.equal(res.matched, 1);
  assert.equal(res.unmatched, 1);
  const charged = listTolls({ status: 'charged' })[0];
  assert.equal(charged.rental_id, rentalId);
  const after = getRental(rentalId);
  const hgs = after.charges.find((c) => c.type === 'hgs')!;
  assert.equal(hgs.amount, 260.5); // 210,50 + 50 hizmet bedeli
  assert.equal(hgs.post_charge, 1);
  assert.ok(after.finance.balance > 0);
  // Tutulan depozito serbest bırakılınca önce bu borca mahsup edilir, kalan iade, sözleşme kapanır
  const closed = ctx(admin)(() => releaseDepositHold(rentalId, admin));
  assert.equal(closed.status, 'closed');
  assert.ok(Math.abs(closed.finance.balance) < 0.01);
  assert.equal(closed.finance.deposit_held, 0);
});

test('trafik cezası: eşleştirme, yansıtma, devir yazısı', async () => {
  const r = getRental(rentalId);
  const fine = ctx(admin)(() => createFine({ plate: vehicle.plate, violation_at: r.pickup_at, amount: 1000, type: 'speed', fine_no: 'TC-1', notified_at: at(0) }, admin));
  assert.equal(fine.status, 'matched');
  assert.equal(fine.rental_id, rentalId);
  assert.ok(fine.discount_deadline);
  const charged = await ctx(admin)(() => fineAction(fine.id, 'charge', {}, admin));
  assert.equal(charged.status, 'charged');
  assert.equal(getRental(rentalId).charges.find((c) => c.type === 'traffic_fine')!.amount, 1150);
  const transferred = await ctx(admin)(() => fineAction(fine.id, 'transfer', {}, admin));
  assert.equal(transferred.status, 'transferred');
  assert.ok(one("SELECT 1 FROM files WHERE entity = 'fine' AND kind = 'pdf'"));
  assert.ok(one("SELECT 1 FROM message_log WHERE template_code = 'fine_notice'"));
});

test('finans: cari ekstre, yaşlandırma, ek fatura ve iade faturası', async () => {
  const st = customerStatement(customer.id);
  const r = getRental(rentalId);
  assert.equal(st.balance, r.finance.balance);
  assert.ok(receivablesAging().rows.some((x) => x.rental_id === rentalId));
  const { issueInvoiceForRental } = await import('../lib/domain/finance');
  const extra = await ctx(admin)(() => issueInvoiceForRental(rentalId, admin));
  assert.ok(extra && extra.total === 1150 + 260.5, `kapanış sonrası HGS + ceza için ek fatura (${extra?.total})`);
  const cn = await ctx(admin)(() => creditNote(extra!.id, 150, 'Hizmet bedeli iadesi', admin));
  assert.equal(cn.type, 'return');
});

test('depozito iadesi onayı ve ücret affı onayı', async () => {
  const w = await ctx(admin)(async () => {
    const d = startWalkIn({ customer_id: customer.id, vehicle_id: vehicle2.id, return_at: at(2) }, admin);
    return d;
  });
  // Teslimi doğrudan aktif et (test kısayolu): fotoğraf + imza
  photographAll(w.checkout!.id, w.id, admin);
  ctx(admin)(() => updateSession(w.checkout!.id, { km: vehicle2.current_km, fuel: 8 }));
  ctx(admin)(() => signRental(w.id, { purpose: 'checkout', signer_type: 'customer', signer_name: 'Ali', image: sigDataUrl(11) }, admin));
  ctx(admin)(() => signRental(w.id, { purpose: 'checkout', signer_type: 'staff', image: sigDataUrl(12) }, admin));
  await ctx(admin)(() => activateRental(w.id, { deposit_collected: 2000, deposit_method: 'cash' }, admin));
  const res = ctx(field)(() => createPayment({ rental_id: w.id, type: 'deposit_out', amount: 500, method: 'cash' }, field));
  assert.equal(res.payment, null);
  assert.ok(res.approval);
  ctx(admin)(() => decideApproval(res.approval!.id, true, null, admin));
  assert.equal(getRental(w.id).finance.deposit_held, 1500);
  // İkame araç
  const swapped = ctx(admin)(() => swapVehicle(w.id, { vehicle_id: suv.id, reason: 'Arıza', old_vehicle_km: vehicle2.current_km + 100 }, admin));
  assert.equal(swapped.vehicle_id, suv.id);
  assert.equal(getVehicle(vehicle2.id).status, 'maintenance');
  assert.ok(listApprovals('approved').length >= 2);
});

test('bakım, transfer ve hasarlı araç durumları', () => {
  const m = createMaintenance({ vehicle_id: vehicle2.id, type: 'repair', status: 'in_progress' });
  updateMaintenance(m.id, { status: 'completed' });
  assert.equal(getVehicle(vehicle2.id).status, 'available');
  const b2 = saveBranch(null, { name: 'Havalimanı' });
  const t = ctx(admin)(() => createTransfer({ vehicle_id: vehicle2.id, to_branch_id: b2.id, cost: 300 }, admin));
  advanceTransfer(t.id, 'depart', {});
  assert.equal(getVehicle(vehicle2.id).status, 'in_transfer');
  advanceTransfer(t.id, 'arrive', { km: vehicle2.current_km + 200 });
  const v = getVehicle(vehicle2.id);
  assert.equal(v.status, 'available');
  assert.equal(v.branch_id, b2.id);
});

test('müşteri portalı ve KVKK', () => {
  const r = getRental(rentalId);
  const view = getPortal(r.portal_token!);
  assert.equal(view.kind, 'rental');
  assert.ok(view.files.length >= 2);
  portalNps(r.portal_token!, 9, 'Harika');
  rejects(() => portalNps(r.portal_token!, 9, 'tekrar'), 409);
  const res = getReservation(reservationId);
  assert.equal(getPortal(res.portal_token!).kind, 'rental');
  const pending = ctx(admin)(() => createReservation({ customer_id: customer.id, category: 'Ekonomi', pickup_at: at(30), return_at: at(32) }, admin));
  rejects(() => portalCheckin(pending.portal_token!, {}), 400, /KVKK/);
  const after = portalCheckin(pending.portal_token!, { kvkk_notice: true, license_expiry: at(1000).slice(0, 10), marketing_sms: true });
  assert.ok(after.consents.marketing_sms);
  // KVKK veri ihracı ve anonimleştirme
  const other = createCustomer({ first_name: 'Silinecek', last_name: 'Kişi', phone: '9', national_id: '10000000078' });
  const data = ctx(admin)(() => exportCustomerData(other.id));
  assert.equal(data.customer.first_name, 'Silinecek');
  const anon = ctx(admin)(() => anonymizeCustomer(other.id, 'KVKK talebi'));
  assert.equal(anon.first_name, 'Anonim');
  assert.equal(anon.national_id, null);
  assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'pii.anonymize'"));
});

test('KABİS kuyruğu, gösterge paneli, raporlar ve takvim', () => {
  const k = listKabis().find((x) => x.status === 'pending')!;
  rejects(() => sendKabis(k.id, {}), 400); // manuel modda referans zorunlu
  assert.equal(sendKabis(k.id, { reference_no: 'EGM-123' }).status, 'sent');
  const d = dashboard();
  assert.ok(d.fleet.total >= 3);
  const rep = reports({ from: at(-1).slice(0, 10), to: at(30).slice(0, 10) });
  assert.ok(rep.kpis.adr > 0);
  assert.ok(rep.kpis.toll_collection_rate > 0);
  assert.equal(rep.kpis.nps.responses, 1);
  assert.ok(calendar({ days: '14' }).events.length > 0);
  assert.ok(all('SELECT * FROM audit_log').length > 10);
  run('SELECT 1');
});

test('gecikmiş sözleşmenin aracı şu an ve yakın gelecekte müsait görünmez', async () => {
  const { findConflicts } = await import('../lib/rules');
  const v = createVehicle({ plate: '34 GEC 001', brand: 'Test', model: 'Gecikme', daily_rate: 1000 });
  const c = one<{ id: number }>('SELECT id FROM customers ORDER BY id LIMIT 1')!;
  run(
    `INSERT INTO rentals(contract_no, customer_id, vehicle_id, pickup_at, planned_return_at, start_km, start_fuel, days, daily_rate, base_amount, total_amount, status)
     VALUES ('KS-GEC', ?, ?, ?, ?, 0, 8, 2, 1000, 2000, 2000, 'active')`,
    c.id, v.id, at(-3), at(-1),
  );
  const now = fmtDateTime(new Date());
  assert.ok(findConflicts(v.id, now, at(3)).some((x) => x.type === 'rental'), 'şimdi başlayan kiralama çakışmalı');
  assert.ok(findConflicts(v.id, at(0, 23), at(2)).some((x) => x.type === 'rental'), '24 saat içinde başlayan da çakışmalı');
  assert.equal(findConflicts(v.id, at(5), at(7)).filter((x) => x.type === 'rental').length, 0, 'ileri tarih serbest');
});
