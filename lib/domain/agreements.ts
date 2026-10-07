// Kira sözleşmesi (agreement) yaşam döngüsü: draft → active → returned → closed (+ kapanış sonrası ek borç).
// Teslim (check-out) ve iade (check-in) muayeneleri, fotoğraflar, hasar şeması, ekipman listesi ve imzalar.
import crypto from 'node:crypto';
import { all, getSettings, insertRow, one, run, tx, updateRow } from '../db';
import { addDays, fmtDate, HttpError, makeCode, mapSeq, mustGet, normDateTime, nowLocal, num, oneOf, optId, required, round2, str, today } from '../core';
import {
  CHARGE_TYPES, CLEANLINESS, assertAvailable, assertCustomerOk, calcCheckin, calcQuote, customerIssues, customerWarnings, equipmentItems,
  parseExtras, recalcRental, rentalFinance, type CheckinCalc,
} from '../rules';
import { audit } from '../audit';
import { getContext } from '../context';
import { can, scopedBranch } from '../permissions';
import { decodeDataUrl, saveFile, sha256, type StoredFile } from '../files';
import { DAMAGE_TYPES, REQUIRED_ANGLES } from '../inspection';
import { METHODS, filterSql, newToken } from './reservations';
import { requestApproval } from './approval-core';
import { notifyRental } from './notify';
import type {
  Body, BookingJoin, Customer, Damage, LineItem, Payment, Rental, RentalCharge, RentalFinance, Reservation, SessionUser, Vehicle,
} from '../types';

const DEPOSIT_METHODS = ['preauth', ...METHODS] as const;

// ================= Okuma =================

export type RentalRow = Rental & BookingJoin & { reservation_code: string | null };
export type RentalListItem = RentalRow & { paid: number; balance: number; overdue: boolean };

export interface InspectionSession {
  id: number;
  rental_id: number;
  kind: 'checkout' | 'checkin';
  km: number | null;
  fuel: number | null;
  cleanliness: string | null;
  notes: string | null;
  started_by: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface InspectionPhoto {
  id: number;
  session_id: number;
  angle: string;
  file_id: number;
  sha256: string;
  created_at: string;
}

export interface DamageMark {
  id: number;
  session_id: number;
  vehicle_id: number;
  x: number;
  y: number;
  type: string;
  severity: string;
  note: string | null;
  photo_file_id: number | null;
  damage_id: number | null;
  voided_at: string | null;
  created_at: string;
}

export interface Signature {
  id: number;
  rental_id: number;
  purpose: 'checkout' | 'checkin';
  signer_type: 'customer' | 'staff';
  signer_name: string;
  file_id: number;
  document_hash: string;
  signature_hash: string;
  stroke_count: number | null;
  duration_ms: number | null;
  ip: string | null;
  user_agent: string | null;
  signed_at: string;
}

export interface SessionDetail extends InspectionSession {
  photos: InspectionPhoto[];
  marks: DamageMark[];
  checklist: { item: string; present: number; note: string | null }[];
  missing_angles: string[];
}

export type RentalDetail = RentalRow & {
  customer: Customer;
  vehicle: Vehicle;
  extras: LineItem[];
  charges: RentalCharge[];
  payments: Payment[];
  damages: Damage[];
  drivers: { id: number; first_name: string; last_name: string; license_no: string | null }[];
  finance: RentalFinance;
  overdue: boolean;
  checkout: SessionDetail | null;
  checkin: SessionDetail | null;
  signatures: Signature[];
  documents: StoredFile[];
  customer_issues: string[];
  customer_warnings: string[];
  sig_valid: { checkout: { customer: boolean; staff: boolean }; checkin: { customer: boolean; staff: boolean } };
  previous_damages: Damage[];
  kabis: { kind: string; status: string; reference_no: string | null }[];
  invoices: { id: number; invoice_no: string; type: string; total: number; status: string; pdf_file_id: number | null }[];
  vehicle_changes: { old_plate: string; new_plate: string; reason: string | null; changed_at: string }[];
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

export async function listRentals(f: Record<string, string | undefined> = {}, user?: SessionUser): Promise<RentalListItem[]> {
  const { where, params } = filterSql(f, 'r.pickup_at', ['r.contract_no', "c.first_name || ' ' || c.last_name", 'v.plate']);
  const now = nowLocal();
  const status = str(f.status);
  if (status === 'overdue') {
    where.push("r.status = 'active' AND r.planned_return_at < ?");
    params.push(now);
  } else if (status === 'open_balance') {
    where.push(`r.status IN ('returned','closed') AND r.total_amount - COALESCE((SELECT SUM(CASE type WHEN 'payment' THEN amount WHEN 'refund' THEN -amount ELSE 0 END) FROM payments WHERE rental_id = r.id),0) > 0.009`);
  } else if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  if (str(f.customer_id)) {
    where.push('r.customer_id = ?');
    params.push(num(f.customer_id));
  }
  const branch = user ? scopedBranch(user) : null;
  if (branch) {
    where.push('(r.pickup_branch_id = ? OR r.return_branch_id = ?)');
    params.push(branch, branch);
  }
  return mapSeq(await all<RentalRow>(`${RENTAL_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.pickup_at DESC LIMIT 500`, ...params), async (row) => {
    const fin = await rentalFinance(row);
    return { ...row, paid: fin.paid, balance: row.status === 'cancelled' ? 0 : fin.balance, overdue: row.status === 'active' && row.planned_return_at < now };
  });
}

async function sessionDetail(s: InspectionSession | undefined): Promise<SessionDetail | null> {
  if (!s) return null;
  // Her açı için en son fotoğraf (eskiler silinmez, arşivde kalır)
  const photos = await all<InspectionPhoto>(
    `SELECT p.*, f.sha256 FROM inspection_photos p JOIN files f ON f.id = p.file_id
     WHERE p.session_id = ? AND f.voided_at IS NULL AND p.id IN (SELECT MAX(id) FROM inspection_photos WHERE session_id = ? GROUP BY angle)
     ORDER BY p.id`, s.id, s.id,
  );
  const have = new Set(photos.map((p) => p.angle));
  return {
    ...s,
    photos,
    marks: await all<DamageMark>('SELECT * FROM damage_marks WHERE session_id = ? AND voided_at IS NULL ORDER BY id', s.id),
    checklist: await all('SELECT item, present, note FROM inspection_checklist WHERE session_id = ? ORDER BY item', s.id),
    missing_angles: REQUIRED_ANGLES.filter((a) => !have.has(a)),
  };
}

const session = (rentalId: number, kind: 'checkout' | 'checkin') =>
  one<InspectionSession>('SELECT * FROM inspection_sessions WHERE rental_id = ? AND kind = ? ORDER BY id DESC LIMIT 1', rentalId, kind);

export async function getRental(id: number): Promise<RentalDetail> {
  const row = await one<RentalRow>(`${RENTAL_SELECT} WHERE r.id = ?`, id);
  if (!row) throw new HttpError(404, 'Kiralama bulunamadı');
  const customer = await mustGet<Customer>('customers', row.customer_id);
  const finance = await rentalFinance(row);
  return {
    ...row,
    customer,
    vehicle: await mustGet<Vehicle>('vehicles', row.vehicle_id),
    extras: await all<LineItem>('SELECT * FROM rental_extras WHERE rental_id = ?', id),
    charges: await all<RentalCharge>('SELECT * FROM rental_charges WHERE rental_id = ? ORDER BY id', id),
    payments: await all<Payment>('SELECT * FROM payments WHERE rental_id = ? ORDER BY paid_at, id', id),
    damages: await all<Damage>('SELECT * FROM damages WHERE rental_id = ? ORDER BY id', id),
    drivers: await all(
      'SELECT d.id, d.first_name, d.last_name, d.license_no FROM rental_drivers rd JOIN drivers d ON d.id = rd.driver_id WHERE rd.rental_id = ?', id,
    ),
    finance,
    overdue: row.status === 'active' && row.planned_return_at < nowLocal(),
    checkout: await sessionDetail(await session(id, 'checkout')),
    checkin: await sessionDetail(await session(id, 'checkin')),
    signatures: await all<Signature>(
      'SELECT * FROM signatures WHERE rental_id = ? AND id IN (SELECT MAX(id) FROM signatures WHERE rental_id = ? GROUP BY purpose, signer_type) ORDER BY id',
      id, id,
    ),
    documents: await all<StoredFile>("SELECT * FROM files WHERE entity = 'rental' AND entity_id = ? AND kind = 'pdf' AND voided_at IS NULL ORDER BY id DESC", id),
    customer_issues: await customerIssues(customer, nowLocal(), { strict: true }),
    customer_warnings: customerWarnings(customer, finance.balance),
    sig_valid: {
      checkout: await validity(id, 'checkout'),
      checkin: await validity(id, 'checkin'),
    },
    previous_damages: await all<Damage>("SELECT * FROM damages WHERE vehicle_id = ? AND status = 'open' AND (rental_id IS NULL OR rental_id <> ?) ORDER BY id", row.vehicle_id, id),
    kabis: await all('SELECT kind, status, reference_no FROM kabis_submissions WHERE rental_id = ? ORDER BY id', id),
    invoices: await all("SELECT id, invoice_no, type, total, status, pdf_file_id FROM invoices WHERE rental_id = ? ORDER BY id", id),
    vehicle_changes: await all(
      `SELECT ov.plate AS old_plate, nv.plate AS new_plate, c.reason, c.changed_at FROM rental_vehicle_changes c
       JOIN vehicles ov ON ov.id = c.old_vehicle_id JOIN vehicles nv ON nv.id = c.new_vehicle_id WHERE c.rental_id = ? ORDER BY c.id`, id,
    ),
  };
}

async function validity(id: number, purpose: 'checkout' | 'checkin') {
  if (!await session(id, purpose)) return { customer: false, staff: false };
  const v = await validSignatures(id, purpose);
  return { customer: !!v.customer, staff: !!v.staff };
}

// ================= Teslim (check-out) =================

function vehicleChecks(vehicle: Vehicle) {
  if (vehicle.status !== 'available') {
    const labels: Record<string, string> = {
      rented: 'kirada', maintenance: 'serviste', out_of_service: 'hizmet dışı', damaged: 'hasarlı', in_transfer: 'transferde', for_sale: 'satılık', sold: 'satıldı',
    };
    throw new HttpError(409, `Araç şu anda ${labels[vehicle.status] || vehicle.status}; teslim edilemez`);
  }
}

async function insertDraft(data: Record<string, string | number | null>, extras: LineItem[], user: SessionUser): Promise<number> {
  const id = await insertRow('rentals', { ...data, status: 'draft', contract_no: `TMP-${crypto.randomUUID()}`, created_by: user.id });
  await run('UPDATE rentals SET contract_no = ? WHERE id = ?', makeCode('KS', id), id);
  for (const l of extras) await insertRow('rental_extras', { rental_id: id, extra_id: l.extra_id, name: l.name, quantity: l.quantity, amount: l.amount });
  await insertRow('inspection_sessions', { rental_id: id, kind: 'checkout', started_by: user.id, km: data.start_km, fuel: data.start_fuel });
  await audit('rental.draft', 'rental', id, { reservation_id: data.reservation_id, vehicle_id: data.vehicle_id });
  return id;
}

/** Rezervasyondan teslim sürecini başlatır (taslak sözleşme + çıkış muayenesi). */
export async function startCheckoutFromReservation(resId: number, b: Body, user: SessionUser): Promise<RentalDetail> {
  const existing = await one<{ id: number }>("SELECT id FROM rentals WHERE reservation_id = ? AND status = 'draft'", resId);
  if (existing) return getRental(existing.id);
  const id = await tx(async () => {
    const rsv = await mustGet<Reservation>('reservations', resId, 'Rezervasyon');
    if (!['pending', 'confirmed'].includes(rsv.status)) throw new HttpError(409, 'Yalnızca onaylı/bekleyen rezervasyon teslim edilebilir');
    if (await one("SELECT 1 FROM approvals WHERE type = 'discount' AND entity = 'reservation' AND entity_id = ? AND status = 'pending'", resId)) {
      throw new HttpError(409, 'İndirim onayı bekleniyor');
    }
    const vehicleId = num(b.vehicle_id) || rsv.vehicle_id;
    if (!vehicleId) throw new HttpError(400, 'Teslim için araç atanmalıdır (grup rezervasyonu)');
    const vehicle = await mustGet<Vehicle>('vehicles', vehicleId, 'Araç');
    vehicleChecks(vehicle);
    const pickup = nowLocal();
    if (pickup >= rsv.return_at) throw new HttpError(400, 'Rezervasyonun dönüş zamanı geçmiş');
    await assertCustomerOk(rsv.customer_id, pickup);
    await assertAvailable(vehicleId, pickup, rsv.return_at, { excludeReservationId: rsv.id });
    const extras = await all<LineItem>('SELECT extra_id, name, quantity, amount FROM reservation_extras WHERE reservation_id = ?', rsv.id);
    const rentalId = await insertDraft(
      {
        reservation_id: rsv.id, customer_id: rsv.customer_id, vehicle_id: vehicleId,
        pickup_branch_id: rsv.pickup_branch_id ?? vehicle.branch_id, return_branch_id: rsv.return_branch_id ?? rsv.pickup_branch_id ?? vehicle.branch_id,
        pickup_at: pickup, planned_return_at: rsv.return_at, start_km: vehicle.current_km, start_fuel: 8,
        days: rsv.days, daily_rate: rsv.daily_rate, base_amount: rsv.base_amount, long_term_discount: rsv.long_term_discount,
        extras_amount: rsv.extras_amount, one_way_fee: rsv.one_way_fee, young_driver_fee: rsv.young_driver_fee, channel_markup: rsv.channel_markup,
        coupon_id: rsv.coupon_id, coupon_discount: rsv.coupon_discount, discount: rsv.discount, total_amount: rsv.total_amount,
        deposit_amount: rsv.deposit_amount, source: rsv.source, agency_id: rsv.agency_id, agency_commission: rsv.agency_commission,
        portal_token: rsv.portal_token ?? newToken(),
        language: (await one<{ preferred_language: string }>('SELECT preferred_language FROM customers WHERE id = ?', rsv.customer_id))?.preferred_language ?? 'tr',
      },
      extras,
      user,
    );
    await run("UPDATE reservations SET status = 'converted', vehicle_id = ? WHERE id = ?", vehicleId, rsv.id);
    await run('UPDATE payments SET rental_id = ? WHERE reservation_id = ?', rentalId, rsv.id);
    await recalcRental(rentalId);
    return rentalId;
  });
  return getRental(id);
}

/** Rezervasyonsuz (kapıdan) kiralama: taslak sözleşme ile teslim süreci başlar. */
export async function startWalkIn(b: Body, user: SessionUser): Promise<RentalDetail> {
  required(b, [['customer_id', 'Müşteri'], ['vehicle_id', 'Araç'], ['return_at', 'Dönüş tarihi']]);
  const id = await tx(async () => {
    const vehicle = await mustGet<Vehicle>('vehicles', num(b.vehicle_id), 'Araç');
    vehicleChecks(vehicle);
    const pickup = nowLocal();
    const ret = normDateTime(b.return_at, 'Dönüş tarihi');
    if (ret <= pickup) throw new HttpError(400, 'Dönüş tarihi teslim zamanından sonra olmalıdır');
    const customer = await assertCustomerOk(b.customer_id, pickup);
    await assertAvailable(vehicle.id, pickup, ret);
    const pb = optId(b.pickup_branch_id) ?? vehicle.branch_id;
    const rb = optId(b.return_branch_id) ?? pb;
    const source = str(b.source) || 'Ofis';
    const q = await calcQuote({
      vehicle, pickup_at: pickup, return_at: ret, extras: parseExtras(b.extras), discount: b.discount, daily_rate: b.daily_rate,
      pickup_branch_id: pb, return_branch_id: rb, channel: source, coupon_code: b.coupon_code, customer,
    });
    if (q.discount && !can(user, 'approve')) {
      const gross = q.total_amount + q.discount;
      if ((q.discount / gross) * 100 > user.discount_limit_pct + 1e-9) throw new HttpError(403, `İndirim limitiniz %${user.discount_limit_pct}; daha yüksek indirim için rezervasyon üzerinden onay isteyin`);
    }
    const rentalId = await insertDraft(
      {
        customer_id: customer.id, vehicle_id: vehicle.id, pickup_branch_id: pb, return_branch_id: rb,
        pickup_at: pickup, planned_return_at: ret, start_km: vehicle.current_km, start_fuel: 8,
        days: q.days, daily_rate: q.daily_rate, base_amount: q.base_amount, long_term_discount: q.long_term_discount,
        extras_amount: q.extras_amount, one_way_fee: q.one_way_fee, young_driver_fee: q.young_driver_fee, channel_markup: q.channel_markup,
        coupon_id: q.coupon_id, coupon_discount: q.coupon_discount, discount: q.discount, total_amount: q.total_amount,
        deposit_amount: str(b.deposit_amount) === null ? q.deposit_amount : num(b.deposit_amount),
        source, portal_token: newToken(), language: customer.preferred_language || 'tr',
        additional_driver: str(b.additional_driver), checkout_notes: str(b.checkout_notes),
      },
      q.extras,
      user,
    );
    if (q.coupon_id) await run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', q.coupon_id);
    await recalcRental(rentalId);
    return rentalId;
  });
  return getRental(id);
}

async function draft(id: number): Promise<Rental> {
  const r = await mustGet<Rental>('rentals', id, 'Kiralama');
  if (r.status !== 'draft') throw new HttpError(409, 'Sözleşme taslak durumda değil');
  return r;
}

/** Taslak sözleşmede araç değişimi (upgrade), ek sürücü, dil, not ve depozito güncellemesi. */
export async function updateDraft(id: number, b: Body): Promise<RentalDetail> {
  await tx(async () => {
    const r = await draft(id);
    const data: Record<string, string | number | null | undefined> = {
      additional_driver: b.additional_driver === undefined ? undefined : str(b.additional_driver),
      checkout_notes: b.checkout_notes === undefined ? undefined : str(b.checkout_notes),
      language: b.language === undefined ? undefined : oneOf(b.language, ['tr', 'en', 'de', 'ru'] as const, 'Dil', 'tr'),
      deposit_amount: b.deposit_amount === undefined ? undefined : Math.max(0, num(b.deposit_amount)),
    };
    if (num(b.vehicle_id) && num(b.vehicle_id) !== r.vehicle_id) {
      const v = await mustGet<Vehicle>('vehicles', num(b.vehicle_id), 'Araç');
      vehicleChecks(v);
      await assertAvailable(v.id, r.pickup_at, r.planned_return_at, { excludeRentalId: id, excludeReservationId: r.reservation_id ?? 0 });
      data.vehicle_id = v.id;
      data.start_km = v.current_km;
      // Araç değişti: çıkış muayenesi yeniden başlar (önceki fotoğraflar arşivde kalır)
      await insertRow('inspection_sessions', { rental_id: id, kind: 'checkout', km: v.current_km, fuel: 8 });
      await audit('rental.vehicle_change', 'rental', id, { from: r.vehicle_id, to: v.id });
    }
    if (Array.isArray(b.driver_ids)) {
      await run('DELETE FROM rental_drivers WHERE rental_id = ?', id);
      for (const d of b.driver_ids as unknown[]) {
        const driver = await one<{ id: number; customer_id: number }>('SELECT id, customer_id FROM drivers WHERE id = ?', num(d));
        if (driver && driver.customer_id === r.customer_id) await insertRow('rental_drivers', { rental_id: id, driver_id: driver.id });
      }
    }
    await updateRow('rentals', id, data);
  });
  return getRental(id);
}

// ---------- Muayene oturumu ----------

export async function getSession(id: number): Promise<InspectionSession> {
  const s = await one<InspectionSession>('SELECT * FROM inspection_sessions WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'Muayene kaydı bulunamadı');
  return s;
}

async function editableSession(id: number): Promise<{ s: InspectionSession; r: Rental }> {
  const s = await getSession(id);
  const r = await mustGet<Rental>('rentals', s.rental_id);
  if (s.completed_at) throw new HttpError(409, 'Muayene tamamlanmış; değiştirilemez');
  if ((s.kind === 'checkout' && r.status !== 'draft') || (s.kind === 'checkin' && r.status !== 'active')) throw new HttpError(409, 'Sözleşme bu işlem için uygun durumda değil');
  return { s, r };
}

export async function updateSession(id: number, b: Body): Promise<SessionDetail> {
  const { s, r } = await editableSession(id);
  const data: Record<string, string | number | null | undefined> = {};
  if (b.km !== undefined && str(b.km) !== null) {
    const km = Math.floor(num(b.km));
    const vehicle = await mustGet<Vehicle>('vehicles', r.vehicle_id);
    const min = s.kind === 'checkout' ? vehicle.current_km : r.start_km;
    if (km < min) throw new HttpError(400, `Km (${km}) ${s.kind === 'checkout' ? 'aracın güncel' : 'çıkış'} km'sinden (${min}) küçük olamaz`);
    data.km = km;
  }
  if (b.fuel !== undefined) {
    const fuel = Math.floor(num(b.fuel, -1));
    if (!(fuel >= 0 && fuel <= 8)) throw new HttpError(400, 'Yakıt seviyesi 0-8 arası olmalıdır');
    data.fuel = fuel;
  }
  if (b.cleanliness !== undefined) data.cleanliness = oneOf(b.cleanliness, CLEANLINESS, 'Temizlik', 'normal');
  if (b.notes !== undefined) data.notes = str(b.notes);
  await tx(async () => {
    await updateRow('inspection_sessions', id, data);
    if (b.checklist && typeof b.checklist === 'object') {
      for (const [item, present] of Object.entries(b.checklist as Record<string, unknown>)) {
        await run(
          `INSERT INTO inspection_checklist(session_id, item, present) VALUES (?,?,?)
           ON CONFLICT(session_id, item) DO UPDATE SET present = excluded.present`,
          id, item, present === true || present === 'true' || present === 1 ? 1 : 0,
        );
      }
    }
  });
  return (await sessionDetail(await getSession(id)))!;
}

export async function addInspectionPhoto(sessionId: number, angle: string, file: StoredFile): Promise<SessionDetail> {
  await editableSession(sessionId);
  await insertRow('inspection_photos', { session_id: sessionId, angle, file_id: file.id });
  return (await sessionDetail(await getSession(sessionId)))!;
}

export async function addDamageMark(sessionId: number, b: Body): Promise<SessionDetail> {
  const { s, r } = await editableSession(sessionId);
  const x = num(b.x, -1);
  const y = num(b.y, -1);
  if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) throw new HttpError(400, 'İşaret konumu geçersiz');
  await insertRow('damage_marks', {
    session_id: s.id, vehicle_id: r.vehicle_id, x, y,
    type: oneOf(b.type, Object.keys(DAMAGE_TYPES) as (keyof typeof DAMAGE_TYPES)[], 'Hasar tipi', 'scratch'),
    severity: oneOf(b.severity, ['minor', 'moderate', 'major'] as const, 'Önem', 'minor'),
    note: str(b.note), photo_file_id: optId(b.photo_file_id),
  });
  await audit('inspection.mark', 'rental', r.id, { session_id: s.id, x, y, type: b.type });
  return (await sessionDetail(await getSession(sessionId)))!;
}

/** Hasar işaretleri silinmez; yalnızca iptal edilir (denetim izi). */
export async function voidDamageMark(markId: number): Promise<SessionDetail> {
  const m = await one<DamageMark>('SELECT * FROM damage_marks WHERE id = ?', markId);
  if (!m) throw new HttpError(404, 'İşaret bulunamadı');
  await editableSession(m.session_id);
  await run("UPDATE damage_marks SET voided_at = app_now_text() WHERE id = ?", markId);
  await audit('inspection.mark_void', 'damage_mark', markId);
  return (await sessionDetail(await getSession(m.session_id)))!;
}

// ---------- İmza ----------

/** İmzalanan içeriğin özeti: fiyat, araç, km/yakıt, fotoğraf hash'leri, hasar işaretleri ve şablon metni. */
export async function documentHash(rentalId: number, purpose: 'checkout' | 'checkin'): Promise<string> {
  const r = await mustGet<Rental>('rentals', rentalId);
  const s = await sessionDetail(await session(rentalId, purpose));
  const template = r.template_id ? (await one<{ body: string }>('SELECT body FROM contract_templates WHERE id = ?', r.template_id))?.body : null;
  const snapshot = {
    contract_no: r.contract_no, customer_id: r.customer_id, vehicle_id: r.vehicle_id, pickup_at: purpose === 'checkout' ? null : r.pickup_at,
    planned_return_at: r.planned_return_at, total: purpose === 'checkout' ? r.total_amount : null, deposit: r.deposit_amount,
    km: s?.km, fuel: s?.fuel, cleanliness: s?.cleanliness,
    photos: s?.photos.map((p) => [p.angle, p.sha256]), marks: s?.marks.map((m) => [m.x, m.y, m.type, m.severity]),
    checklist: s?.checklist.map((c) => [c.item, c.present]), template,
  };
  return sha256(JSON.stringify(snapshot));
}

export async function signRental(rentalId: number, b: Body, user: SessionUser): Promise<RentalDetail> {
  const r = await mustGet<Rental>('rentals', rentalId, 'Kiralama');
  const purpose = oneOf(b.purpose, ['checkout', 'checkin'] as const, 'İmza amacı');
  const signerType = oneOf(b.signer_type, ['customer', 'staff'] as const, 'İmzalayan');
  if (purpose === 'checkout' && r.status !== 'draft') throw new HttpError(409, 'Sözleşme teslim aşamasında değil');
  if (purpose === 'checkin' && r.status !== 'active') throw new HttpError(409, 'Sözleşme iade aşamasında değil');
  const s = await sessionDetail(await session(rentalId, purpose));
  if (!s) throw new HttpError(409, 'Önce muayene başlatılmalı');
  // Kabul kriteri: zorunlu fotoğraf karesi eksikse sözleşme imzaya açılmaz.
  if (s.missing_angles.length) throw new HttpError(409, `Zorunlu fotoğraflar eksik (${s.missing_angles.length} kare); imza alınamaz`, { missing: s.missing_angles });
  if (s.km === null || s.fuel === null) throw new HttpError(409, 'Km ve yakıt bilgisi girilmeden imza alınamaz');
  const { mime, data } = decodeDataUrl(String(b.image ?? ''));
  if (mime !== 'image/png') throw new HttpError(400, 'İmza PNG olmalıdır');
  if (data.length < 500) throw new HttpError(400, 'İmza boş görünüyor');
  const docHash = await documentHash(rentalId, purpose);
  const signedAt = nowLocal();
  const name = str(b.signer_name) ?? (signerType === 'staff' ? user.full_name : null);
  if (!name) throw new HttpError(400, 'İmzalayan adı zorunludur');
  const file = await saveFile({
    kind: 'signature', entity: 'rental', entityId: rentalId, name: `imza-${purpose}-${signerType}.png`, mime, data,
    meta: { purpose, signer_type: signerType, document_hash: docHash },
  });
  const sigHash = sha256(`${file.sha256}|${docHash}|${signedAt}|${signerType}`);
  await insertRow('signatures', {
    rental_id: rentalId, purpose, signer_type: signerType, signer_name: name, file_id: file.id, document_hash: docHash, signature_hash: sigHash,
    stroke_count: Math.floor(num(b.stroke_count)), duration_ms: Math.floor(num(b.duration_ms)),
    ip: getContext().ip, user_agent: getContext().userAgent, user_id: user.id, signed_at: signedAt,
  });
  await audit('rental.sign', 'rental', rentalId, { purpose, signer_type: signerType, document_hash: docHash, signature_hash: sigHash });
  return getRental(rentalId);
}

/** Geçerli imzalar: mevcut belge özeti ile eşleşenler (imzadan sonra veri değiştiyse yeniden imza gerekir). */
export async function validSignatures(rentalId: number, purpose: 'checkout' | 'checkin') {
  // Aktivasyondan sonra teslim imzaları, imzalı sözleşme PDF'ine işlenen özetle doğrulanır
  // (uzatma, iade ücretleri vb. sonraki meşru değişiklikler teslim imzasını geçersiz kılmaz).
  let hash = await documentHash(rentalId, purpose);
  if (purpose === 'checkout' && (await one<{ status: string }>('SELECT status FROM rentals WHERE id = ?', rentalId))?.status !== 'draft') {
    const pdf = await one<{ meta: string | null }>(
      "SELECT meta FROM files WHERE entity = 'rental' AND entity_id = ? AND kind = 'pdf' AND voided_at IS NULL AND meta ILIKE '%\"doc\":\"contract\"%' ORDER BY id DESC LIMIT 1",
      rentalId,
    );
    const frozen = pdf?.meta ? (JSON.parse(pdf.meta).document_hash as string | undefined) : undefined;
    if (frozen) hash = frozen;
  }
  const sigs = await all<Signature>(
    'SELECT * FROM signatures WHERE rental_id = ? AND purpose = ? AND id IN (SELECT MAX(id) FROM signatures WHERE rental_id = ? AND purpose = ? GROUP BY signer_type)',
    rentalId, purpose, rentalId, purpose,
  );
  return { customer: sigs.find((s) => s.signer_type === 'customer' && s.document_hash === hash), staff: sigs.find((s) => s.signer_type === 'staff' && s.document_hash === hash), hash };
}

// ---------- Aktivasyon (teslim tamam) ----------

async function fieldLimit(user: SessionUser, amount: number) {
  if (user.role === 'field' && amount > num((await getSettings()).field_payment_limit)) {
    throw new HttpError(403, `Saha personeli tahsilat limiti ${(await getSettings()).field_payment_limit} ₺; daha yüksek tutar için muhasebe/yönetici gerekir`);
  }
}

/** Teslimi tamamlar: imzalar + fotoğraflar kontrol edilir, araç kiraya çıkar, PDF/KABİS/bildirim üretilir. */
export async function activateRental(id: number, b: Body, user: SessionUser): Promise<RentalDetail> {
  await tx(async () => {
    const r = await draft(id);
    const s = (await sessionDetail(await session(id, 'checkout')))!;
    if (s.missing_angles.length) throw new HttpError(409, 'Zorunlu fotoğraflar eksik');
    if (s.km === null || s.fuel === null) throw new HttpError(409, 'Km ve yakıt bilgisi eksik');
    const sig = await validSignatures(id, 'checkout');
    if (!sig.customer || !sig.staff) throw new HttpError(409, 'Müşteri ve personel imzası gerekli (imzadan sonra bilgi değiştiyse yeniden imzalatın)');
    const vehicle = await mustGet<Vehicle>('vehicles', r.vehicle_id);
    vehicleChecks(vehicle);
    await assertCustomerOk(r.customer_id, nowLocal(), { strict: true });
    await assertAvailable(vehicle.id, r.pickup_at, r.planned_return_at, { excludeRentalId: id, excludeReservationId: r.reservation_id ?? 0 });
    const now = nowLocal();
    const depositCollected = round2(num(b.deposit_collected));
    const paymentAmount = round2(num(b.payment_amount));
    await fieldLimit(user, paymentAmount);
    if (depositCollected > 0) {
      await insertRow('payments', {
        customer_id: r.customer_id, rental_id: id, type: 'deposit_in', method: oneOf(b.deposit_method, DEPOSIT_METHODS, 'Depozito yöntemi', 'preauth'),
        amount: depositCollected, paid_at: now, reference: str(b.deposit_reference),
        description: b.deposit_method === 'preauth' || !b.deposit_method ? 'Kart provizyonu (teslim)' : 'Teslimde alınan depozito', created_by: user.id,
      });
    }
    if (paymentAmount > 0) {
      await insertRow('payments', {
        customer_id: r.customer_id, rental_id: id, type: 'payment', method: oneOf(b.payment_method, METHODS, 'Ödeme yöntemi', 'credit_card'),
        amount: paymentAmount, paid_at: now, reference: str(b.payment_reference), installments: num(b.installments) || null,
        description: 'Teslimde tahsilat', created_by: user.id,
      });
    }
    await run("UPDATE inspection_sessions SET completed_at = ? WHERE id = ?", now, s.id);
    await updateRow('rentals', id, { status: 'active', pickup_at: now, signed_at: now, start_km: s.km, start_fuel: s.fuel });
    await run("UPDATE vehicles SET status = 'rented', current_km = ? WHERE id = ?", s.km, vehicle.id);
    await recalcRental(id);
    await audit('rental.activate', 'rental', id, { km: s.km, fuel: s.fuel, deposit: depositCollected, payment: paymentAmount });
  });
  const { queueKabis } = await import('./kabis');
  await queueKabis(id, 'open');
  const { contractPdf } = await import('../documents');
  const pdf = await contractPdf(id);
  await notifyRental('contract_sent', id, { attachments: [pdf.id] });
  return getRental(id);
}

/** Taslak sözleşmeyi iptal eder; rezervasyon yeniden onaylı duruma döner. */
export async function cancelDraft(id: number, reason: unknown): Promise<RentalDetail> {
  await tx(async () => {
    const r = await draft(id);
    await updateRow('rentals', id, { status: 'cancelled', checkin_notes: str(reason) || 'Teslim iptal edildi' });
    if (r.reservation_id) {
      await run("UPDATE reservations SET status = 'confirmed' WHERE id = ?", r.reservation_id);
      await run('UPDATE payments SET rental_id = NULL WHERE rental_id = ? AND reservation_id IS NOT NULL', id);
    }
    await audit('rental.draft_cancel', 'rental', id, { reason });
  });
  return getRental(id);
}

// ================= Kira süresince =================

async function activeRental(id: number): Promise<Rental> {
  const rental = await mustGet<Rental>('rentals', id, 'Kiralama');
  if (rental.status !== 'active') throw new HttpError(409, 'Kiralama aktif değil');
  return rental;
}

export async function extendRental(id: number, b: Body): Promise<RentalDetail> {
  await tx(async () => {
    const rental = await activeRental(id);
    const newReturn = normDateTime(b.return_at, 'Yeni dönüş tarihi');
    if (newReturn <= rental.planned_return_at) throw new HttpError(400, 'Yeni dönüş tarihi mevcut dönüş tarihinden sonra olmalıdır');
    await assertAvailable(rental.vehicle_id, rental.pickup_at, newReturn, { excludeRentalId: id });
    const q = await calcQuote({
      vehicle: await mustGet<Vehicle>('vehicles', rental.vehicle_id), pickup_at: rental.pickup_at, return_at: newReturn,
      extras: await all('SELECT extra_id, quantity FROM rental_extras WHERE rental_id = ?', id), discount: rental.discount,
      daily_rate: b.daily_rate ?? rental.daily_rate, pickup_branch_id: rental.pickup_branch_id, return_branch_id: rental.return_branch_id,
      customer: await one<Customer>('SELECT * FROM customers WHERE id = ?', rental.customer_id),
    });
    await updateRow('rentals', id, {
      planned_return_at: newReturn, days: q.days, daily_rate: q.daily_rate, base_amount: q.base_amount,
      long_term_discount: q.long_term_discount, extras_amount: q.extras_amount, young_driver_fee: q.young_driver_fee,
    });
    await run('DELETE FROM rental_extras WHERE rental_id = ?', id);
    for (const l of q.extras) await insertRow('rental_extras', { rental_id: id, extra_id: l.extra_id, name: l.name, quantity: l.quantity, amount: l.amount });
    await recalcRental(id);
    await audit('rental.extend', 'rental', id, { from: rental.planned_return_at, to: newReturn });
  });
  return getRental(id);
}

/** İkame araç: aktif sözleşmede aracı değiştirir (arıza/kaza). */
export async function swapVehicle(id: number, b: Body, user: SessionUser): Promise<RentalDetail> {
  await tx(async () => {
    const r = await activeRental(id);
    const nv = await mustGet<Vehicle>('vehicles', num(b.vehicle_id), 'İkame araç');
    vehicleChecks(nv);
    await assertAvailable(nv.id, nowLocal(), r.planned_return_at);
    const old = await mustGet<Vehicle>('vehicles', r.vehicle_id);
    const oldKm = Math.max(old.current_km, Math.floor(num(b.old_vehicle_km, old.current_km)));
    const oldStatus = oneOf(b.old_vehicle_status, ['maintenance', 'damaged', 'available'] as const, 'Eski araç durumu', 'maintenance');
    await insertRow('rental_vehicle_changes', {
      rental_id: id, old_vehicle_id: old.id, new_vehicle_id: nv.id, old_vehicle_km: oldKm, new_vehicle_km: nv.current_km, reason: str(b.reason), changed_by: user.id,
    });
    await run('UPDATE vehicles SET status = ?, current_km = ? WHERE id = ?', oldStatus, oldKm, old.id);
    await run("UPDATE vehicles SET status = 'rented' WHERE id = ?", nv.id);
    // Km hesabı için: eski araçta yapılan km, yeni aracın başlangıç km'sinden düşülerek korunur
    const driven = oldKm - r.start_km;
    await updateRow('rentals', id, { vehicle_id: nv.id, start_km: nv.current_km - Math.max(0, driven) });
    await audit('rental.swap_vehicle', 'rental', id, { from: old.plate, to: nv.plate, reason: b.reason });
  });
  return getRental(id);
}

export async function cancelRental(id: number, b: Body, user: SessionUser): Promise<RentalDetail> {
  await tx(async () => {
    const r = await mustGet<Rental>('rentals', id, 'Kiralama');
    if (r.status === 'draft') return cancelDraft(id, b.reason);
    if (r.status !== 'active') throw new HttpError(409, 'Yalnızca taslak veya aktif sözleşme iptal edilebilir');
    await updateRow('rentals', id, { status: 'cancelled', checkin_notes: str(b.reason) || 'İptal edildi', closed_by: user.id });
    await run("UPDATE vehicles SET status = 'available' WHERE id = ? AND status = 'rented'", r.vehicle_id);
    await audit('rental.cancel', 'rental', id, { reason: b.reason });
  });
  return getRental(id);
}

export async function addCharge(id: number, b: Body, user: SessionUser): Promise<RentalDetail> {
  const rental = await mustGet<Rental>('rentals', id, 'Kiralama');
  if (rental.status === 'cancelled' || rental.status === 'draft') throw new HttpError(409, 'Bu sözleşmeye ücret eklenemez');
  const amount = round2(num(b.amount));
  if (!(amount > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalıdır');
  await tx(async () => {
    await insertRow('rental_charges', {
      rental_id: id, type: oneOf(b.type, CHARGE_TYPES, 'Ücret tipi', 'other'), description: str(b.description), amount,
      post_charge: rental.status === 'returned' || rental.status === 'closed' ? 1 : 0, created_by: user.id,
    });
    await recalcRental(id);
    await audit('rental.charge', 'rental', id, { type: b.type, amount });
  });
  return getRental(id);
}

/** Ücret silme: onay yetkisi yoksa ücret affı onayı istenir. */
export async function removeCharge(id: number, chargeId: number, user: SessionUser, reason?: unknown): Promise<RentalDetail & { approval_requested?: boolean }> {
  const c = await one<RentalCharge>('SELECT * FROM rental_charges WHERE id = ? AND rental_id = ?', chargeId, id);
  if (!c) throw new HttpError(404, 'Ücret bulunamadı');
  if (!can(user, 'approve')) {
    await requestApproval('charge_waiver', 'rental', id, c.amount, str(reason) ?? `${c.type} ücret affı`, { charge_id: chargeId }, user);
    return { ...await getRental(id), approval_requested: true };
  }
  await applyChargeWaiver(chargeId);
  return getRental(id);
}

export async function applyChargeWaiver(chargeId: number) {
  const c = await one<RentalCharge>('SELECT * FROM rental_charges WHERE id = ?', chargeId);
  if (!c) return;
  await tx(async () => {
    await run('DELETE FROM rental_charges WHERE id = ?', chargeId);
    if (c.damage_id) await run('UPDATE damages SET waived = 1, customer_charge = 0 WHERE id = ?', c.damage_id);
    if (c.toll_id) await run("UPDATE toll_transactions SET status = 'company', charge_id = NULL WHERE id = ?", c.toll_id);
    if (c.fine_id) await run("UPDATE traffic_fines SET status = 'matched', charge_id = NULL WHERE id = ?", c.fine_id);
    await recalcRental(c.rental_id);
    await audit('rental.charge_waived', 'rental', c.rental_id, { charge_id: chargeId, type: c.type, amount: c.amount });
  });
  await maybeClose(c.rental_id);
}

// ================= İade (check-in) =================

export async function startCheckin(id: number, user: SessionUser): Promise<RentalDetail> {
  const r = await activeRental(id);
  if (!await session(id, 'checkin')) {
    await insertRow('inspection_sessions', { rental_id: id, kind: 'checkin', started_by: user.id, fuel: r.start_fuel });
    await audit('rental.checkin_start', 'rental', id);
  }
  return getRental(id);
}

export async function previewCheckin(id: number, b: Body): Promise<CheckinCalc> {
  const rental = await activeRental(id);
  const s = await sessionDetail(await session(id, 'checkin'));
  return calcCheckin(rental, await mustGet<Vehicle>('vehicles', rental.vehicle_id), await checkinInput(id, b, s));
}

/** İade hesabı girdisi: oturumdaki km/yakıt/temizlik, eksik ekipman ve hasar işaretleri + formdaki ücretler. */
async function checkinInput(id: number, b: Body, s: SessionDetail | null) {
  const damageInputs = Array.isArray(b.damages) ? (b.damages as Record<string, unknown>[]) : [];
  const byMark = new Map(damageInputs.filter((d) => num(d.mark_id)).map((d) => [num(d.mark_id), d]));
  const fromMarks = (s?.marks ?? []).map((m) => {
    const d = byMark.get(m.id) ?? {};
    return {
      mark_id: m.id, description: str(d.description) ?? `${DAMAGE_TYPES[m.type as keyof typeof DAMAGE_TYPES] ?? m.type}${m.note ? ': ' + m.note : ''}`,
      location: str(d.location), severity: d.severity ?? m.severity, repair_cost: d.repair_cost, customer_charge: d.customer_charge,
    };
  });
  return {
    ...b, end_km: b.end_km ?? s?.km, end_fuel: b.end_fuel ?? s?.fuel, cleanliness: b.cleanliness ?? s?.cleanliness,
    missing_equipment: b.missing_equipment ?? await missingEquipment(id), damages: [...fromMarks, ...damageInputs.filter((d) => !num(d.mark_id))],
  };
}

/** Ekipman listesinde çıkışta olup dönüşte olmayanlar. */
export async function missingEquipment(id: number): Promise<string[]> {
  const out = await session(id, 'checkout');
  const back = await session(id, 'checkin');
  if (!out || !back) return [];
  const had = new Set((await all<{ item: string }>('SELECT item FROM inspection_checklist WHERE session_id = ? AND present = 1', out.id)).map((x) => x.item));
  const checked = await all<{ item: string; present: number }>('SELECT item, present FROM inspection_checklist WHERE session_id = ?', back.id);
  // İade kontrolü henüz yapılmadıysa eksik varsayılmaz (tamamlama ayrıca kontrol listesini zorunlu tutar).
  if (!checked.length) return [];
  const now = new Set(checked.filter((x) => x.present).map((x) => x.item));
  return (await equipmentItems()).map((e) => e.name).filter((n) => had.has(n) && !now.has(n));
}

const truthy = (v: unknown) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';

/** İadeyi tamamlar: ek ücretler, hasar dosyaları, depozito, fatura, KABİS kapanışı, mutabakat PDF'i. */
export async function completeCheckin(id: number, b: Body, user: SessionUser): Promise<RentalDetail> {
  const s0 = await getSettings();
  await tx(async () => {
    const rental = await activeRental(id);
    const s = await sessionDetail(await session(id, 'checkin'));
    if (!s) throw new HttpError(409, 'Önce iade muayenesini başlatın');
    if (s.missing_angles.length && !truthy(b.skip_photos)) throw new HttpError(409, `İade fotoğrafları eksik (${s.missing_angles.length} kare)`, { missing: s.missing_angles });
    if (s.missing_angles.length && !can(user, 'approve')) throw new HttpError(403, 'Fotoğrafsız iade için onay yetkisi gerekir');
    const out = await session(id, 'checkout');
    if (out && !s.checklist.length && await one('SELECT 1 FROM inspection_checklist WHERE session_id = ?', out.id)) {
      throw new HttpError(409, 'İade ekipman kontrol listesi kaydedilmedi (Ekipman · km · yakıt adımı)');
    }
    const waiving = ['waive_late', 'waive_km', 'waive_fuel', 'waive_cleaning'].some((k) => truthy(b[k]));
    if (waiving && !can(user, 'approve')) throw new HttpError(403, 'Ücret affı için onay yetkisi gerekir; ücretleri yansıtıp sonradan af talebi oluşturabilirsiniz');
    const sig = await validSignatures(id, 'checkin');
    const refusal = str(b.signature_refused_reason);
    if (!sig.customer && !refusal) throw new HttpError(409, 'Müşterinin hesap özeti imzası gerekli (veya imzadan kaçınma nedenini girin)');

    const vehicle = await mustGet<Vehicle>('vehicles', rental.vehicle_id);
    const calc = await calcCheckin(rental, vehicle, await checkinInput(id, b, s));
    const now = nowLocal();

    // Hasar dosyaları
    const damageIds: number[] = [];
        for (const d of calc.damages) {
      const mark = d.mark_id ? s.marks.find((m) => m.id === d.mark_id) : undefined;
      const did = await insertRow('damages', {
        vehicle_id: vehicle.id, rental_id: id, session_id: s.id, reported_at: calc.actual_return_at.slice(0, 10), description: d.description,
        location: d.location, severity: d.severity, repair_cost: d.repair_cost, customer_charge: d.customer_charge, status: 'open',
        mark_x: mark?.x ?? null, mark_y: mark?.y ?? null, mark_type: mark?.type ?? null, photo_file_id: mark?.photo_file_id ?? null,
      });
      if (mark) await run('UPDATE damage_marks SET damage_id = ? WHERE id = ?', did, mark.id);
      damageIds.push(did);
        }
    for (const c of calc.charges) {
      await insertRow('rental_charges', {
        rental_id: id, type: c.type, description: c.description, amount: c.amount, created_by: user.id,
        damage_id: c.damage_index !== undefined ? damageIds[c.damage_index] : null,
      });
    }

    const returnBranch = optId(b.return_branch_id) ?? rental.return_branch_id;
    await run('UPDATE inspection_sessions SET completed_at = ?, km = ?, fuel = ? WHERE id = ?', now, calc.end_km, calc.end_fuel, s.id);
    await updateRow('rentals', id, {
      actual_return_at: calc.actual_return_at, end_km: calc.end_km, end_fuel: calc.end_fuel, return_branch_id: returnBranch,
      checkin_notes: [str(b.checkin_notes), refusal ? `Müşteri imzadan kaçındı: ${refusal}` : null].filter(Boolean).join(' · ') || null,
      status: 'returned', closed_by: user.id,
    });
    await recalcRental(id);

    const hasMajor = calc.damages.some((d) => d.severity === 'major');
    const vStatus = oneOf(b.vehicle_status, ['available', 'maintenance', 'damaged'] as const, 'Araç durumu', hasMajor ? 'damaged' : 'available');
    await run('UPDATE vehicles SET current_km = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ?', calc.end_km, vStatus, returnBranch, vehicle.id);
    if (vStatus === 'maintenance') {
      await insertRow('maintenance', {
        vehicle_id: vehicle.id, type: calc.damages.length ? 'damage_repair' : 'other', status: 'in_progress',
        description: str(b.maintenance_note) || `İade sonrası servis (${rental.contract_no})`, start_date: today(), km: calc.end_km,
      });
    }
    if (truthy(b.create_wash_task)) {
      await insertRow('tasks', { type: 'wash', title: `Yıkama: ${vehicle.plate}`, vehicle_id: vehicle.id, branch_id: returnBranch, rental_id: id, created_by: user.id });
    }

    const pay = round2(num(b.payment_amount));
    await fieldLimit(user, pay);
    if (pay > 0) {
      await insertRow('payments', {
        customer_id: rental.customer_id, rental_id: id, type: 'payment', method: oneOf(b.payment_method, METHODS, 'Ödeme yöntemi', 'credit_card'),
        amount: pay, paid_at: now, reference: str(b.payment_reference), description: 'İadede tahsilat', created_by: user.id,
      });
    }

    // Depozito / provizyon kapanışı
    const fin = await rentalFinance(await mustGet<Rental>('rentals', id));
    const action = oneOf(b.deposit_action, ['none', 'return', 'offset', 'hold'] as const, 'Depozito işlemi', 'offset');
    const base = { customer_id: rental.customer_id, rental_id: id, paid_at: now, created_by: user.id };
    // Bekleyen HGS/ceza için tutulacak kısım önce ayrılır; kalan bakiyeye mahsup edilir, artan iade edilir.
    const holdAmount = action === 'hold' && fin.deposit_held > 0
      ? round2(Math.min(fin.deposit_held, str(b.hold_amount) === null ? fin.deposit_held : Math.max(0, num(b.hold_amount))))
      : 0;
    let remaining = round2(fin.deposit_held - holdAmount);
    if (remaining > 0 && (action === 'offset' || action === 'hold') && fin.balance > 0) {
      const use = round2(Math.min(remaining, fin.balance));
      await insertRow('payments', { ...base, type: 'deposit_out', method: 'deposit', amount: use, description: 'Depozitodan/provizyondan bakiyeye mahsup' });
      await insertRow('payments', { ...base, type: 'payment', method: 'deposit', amount: use, description: 'Depozitodan mahsup' });
      remaining = round2(remaining - use);
    }
    const toReturn = action === 'none' ? 0 : remaining;
    if (toReturn > 0) {
      const lastIn = await one<{ method: string }>("SELECT method FROM payments WHERE rental_id = ? AND type = 'deposit_in' ORDER BY id DESC", id);
      await insertRow('payments', {
        ...base, type: 'deposit_out', method: lastIn?.method || 'cash', amount: toReturn,
        description: lastIn?.method === 'preauth' ? 'Provizyon kapatma (iade)' : 'Depozito iadesi',
      });
    }
    if (holdAmount > 0) {
      await updateRow('rentals', id, {
        deposit_hold_amount: holdAmount, deposit_hold_until: fmtDate(addDays(new Date(), num(str(b.hold_days) ?? s0.deposit_hold_days, 30))),
      });
    }
    await audit('rental.checkin', 'rental', id, {
      km: calc.end_km, fuel: calc.end_fuel, charges: calc.charges_total, deposit_action: action, hold: holdAmount, signature_refused: !!refusal,
    });
  });
  await maybeClose(id);
  const { queueKabis } = await import('./kabis');
  await queueKabis(id, 'close');
  const { issueInvoiceForRental } = await import('./finance');
  const invoice = await issueInvoiceForRental(id, user);
  const { settlementPdf } = await import('../documents');
  const pdf = await settlementPdf(id);
  await notifyRental('checkin_completed', id, { attachments: [pdf.id, ...(invoice?.pdf_file_id ? [invoice.pdf_file_id] : [])] });
  return getRental(id);
}

/** İade alınmış sözleşmede bakiye sıfır ve depozito kapanmışsa sözleşmeyi kapatır. */
export async function maybeClose(id: number) {
  const r = await one<Rental>('SELECT * FROM rentals WHERE id = ?', id);
  if (!r || r.status !== 'returned') return;
  const fin = await rentalFinance(r);
  if (Math.abs(fin.balance) < 0.01 && fin.deposit_held < 0.01) {
    await updateRow('rentals', id, { status: 'closed', closed_at: nowLocal(), deposit_hold_amount: 0 });
    await audit('rental.close', 'rental', id);
  }
}

/** Tutulan depozitoyu serbest bırakır: önce açık bakiyeye (kapanış sonrası HGS/ceza) mahsup, kalanı iade. */
export async function releaseDepositHold(id: number, user: SessionUser): Promise<RentalDetail> {
  await tx(async () => {
    const r = await mustGet<Rental>('rentals', id, 'Kiralama');
    if (!['returned', 'closed'].includes(r.status)) throw new HttpError(409, 'Sözleşme iade aşamasında değil');
    const fin = await rentalFinance(r);
    let remaining = fin.deposit_held;
    if (remaining <= 0) throw new HttpError(409, 'Tutulan depozito yok');
    const now = nowLocal();
    const base = { customer_id: r.customer_id, rental_id: id, paid_at: now, created_by: user.id };
    if (fin.balance > 0) {
      const use = round2(Math.min(remaining, fin.balance));
      await insertRow('payments', { ...base, type: 'deposit_out', method: 'deposit', amount: use, description: 'Tutulan depozitodan mahsup' });
      await insertRow('payments', { ...base, type: 'payment', method: 'deposit', amount: use, description: 'Tutulan depozitodan mahsup' });
      remaining = round2(remaining - use);
    }
    if (remaining > 0) {
      const lastIn = await one<{ method: string }>("SELECT method FROM payments WHERE rental_id = ? AND type = 'deposit_in' ORDER BY id DESC", id);
      await insertRow('payments', { ...base, type: 'deposit_out', method: lastIn?.method || 'cash', amount: remaining, description: 'Tutulan depozito iadesi' });
    }
    await updateRow('rentals', id, { deposit_hold_amount: 0, deposit_hold_until: null });
    await audit('rental.deposit_release', 'rental', id, { amount: fin.deposit_held });
  });
  await maybeClose(id);
  return getRental(id);
}

/** Süresi dolan depozito tutmaları (hatırlatma/otomasyon için). */
export const dueDepositHolds = () =>
  all<{ id: number; contract_no: string; deposit_hold_amount: number; deposit_hold_until: string }>(
    "SELECT id, contract_no, deposit_hold_amount, deposit_hold_until FROM rentals WHERE deposit_hold_amount > 0 AND deposit_hold_until <= ?", today(),
  );
