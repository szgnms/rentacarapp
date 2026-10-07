import crypto from 'node:crypto';
import { all, getSettings, insertRow, one, run, tx, updateRow } from '../db';
import { filterSeq, fmtDateTime, HttpError, makeCode, mapSeq, mustGet, normDateTime, nowLocal, num, oneOf, optId, parseDate, required, round2, str, today } from '../core';
import {
  CATEGORIES, assertAvailable, assertCustomerOk, calcQuote, findConflicts, groupAvailability, parseExtras, paymentTotals, subtotal,
} from '../rules';
import { audit } from '../audit';
import { can, scopedBranch } from '../permissions';
import { pendingApproval, requestApproval } from './approval-core';
import { notifyReservation } from './notify';
import type { Body, BookingJoin, Customer, Finance, LineItem, Payment, PaymentMethod, Quote, Reservation, SessionUser, Vehicle } from '../types';

export const METHODS = ['cash', 'credit_card', 'bank_transfer', 'pos', 'payment_link'] as const satisfies readonly PaymentMethod[];
export const newToken = () => crypto.randomBytes(18).toString('base64url');

// ---------- Fiyat teklifi ----------
export async function quote(b: Body): Promise<Quote> {
  const vehicle = num(b.vehicle_id) ? await mustGet<Vehicle>('vehicles', num(b.vehicle_id), 'Araç') : null;
  const customer = num(b.customer_id) ? await one<Customer>('SELECT * FROM customers WHERE id = ?', num(b.customer_id)) : null;
  return calcQuote({
    vehicle,
    category: str(b.category) ?? vehicle?.category,
    pickup_at: normDateTime(b.pickup_at, 'Alış tarihi'),
    return_at: normDateTime(b.return_at, 'Dönüş tarihi'),
    extras: parseExtras(b.extras),
    discount: b.discount,
    daily_rate: b.daily_rate,
    pickup_branch_id: optId(b.pickup_branch_id),
    return_branch_id: optId(b.return_branch_id),
    channel: str(b.source) ?? str(b.channel),
    coupon_code: b.coupon_code,
    customer,
  });
}

export function filterSql(f: Record<string, string | undefined>, dateCol: string, searchCols: string[]) {
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
  if (str(f.q) && searchCols.length) {
    where.push(`(${searchCols.map((c) => `${c} ILIKE ?`).join(' OR ')})`);
    params.push(...searchCols.map(() => `%${str(f.q)}%`));
  }
  return { where, params };
}

// ================= REZERVASYONLAR =================

export type ReservationRow = Reservation & Omit<BookingJoin, 'plate' | 'brand' | 'model' | 'category'> & {
  plate: string | null;
  brand: string | null;
  model: string | null;
  rental_id: number | null;
  agency_name: string | null;
};
export type ReservationDetail = ReservationRow & {
  extras: LineItem[];
  payments: Payment[];
  finance: Finance;
  pending_approval: { id: number; amount: number } | null;
};

const RES_SELECT = `
  SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
         v.plate, v.brand, v.model, COALESCE(r.category, v.category) AS category,
         pb.name AS pickup_branch_name, rb.name AS return_branch_name, a.name AS agency_name,
         (SELECT id FROM rentals WHERE reservation_id = r.id AND status <> 'cancelled' LIMIT 1) AS rental_id
  FROM reservations r
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN vehicles v ON v.id = r.vehicle_id
  LEFT JOIN branches pb ON pb.id = r.pickup_branch_id
  LEFT JOIN branches rb ON rb.id = r.return_branch_id
  LEFT JOIN agencies a ON a.id = r.agency_id`;

export function listReservations(f: Record<string, string | undefined> = {}, user?: SessionUser): Promise<ReservationRow[]> {
  const { where, params } = filterSql(f, 'r.pickup_at', ['r.code', "c.first_name || ' ' || c.last_name", 'v.plate']);
  for (const [k, col] of [['status', 'r.status'], ['source', 'r.source'], ['category', 'r.category']] as const) {
    if (str(f[k])) {
      where.push(`${col} = ?`);
      params.push(str(f[k])!);
    }
  }
  if (str(f.customer_id)) {
    where.push('r.customer_id = ?');
    params.push(num(f.customer_id));
  }
  if (f.unassigned === '1') where.push('r.vehicle_id IS NULL');
  const branch = user ? scopedBranch(user) : null;
  if (branch) {
    where.push('(r.pickup_branch_id = ? OR r.return_branch_id = ?)');
    params.push(branch, branch);
  }
  return all<ReservationRow>(`${RES_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.pickup_at DESC LIMIT 500`, ...params);
}

export async function getReservation(id: number): Promise<ReservationDetail> {
  const row = await one<ReservationRow>(`${RES_SELECT} WHERE r.id = ?`, id);
  if (!row) throw new HttpError(404, 'Rezervasyon bulunamadı');
  const ap = await pendingApproval('discount', 'reservation', id);
  return {
    ...row,
    extras: await all<LineItem>('SELECT * FROM reservation_extras WHERE reservation_id = ?', id),
    payments: await all<Payment>('SELECT * FROM payments WHERE reservation_id = ? ORDER BY paid_at', id),
    finance: await paymentTotals('reservation_id', id),
    pending_approval: ap ? { id: ap.id, amount: ap.amount } : null,
  };
}

async function buildReservation(b: Body, existing?: Reservation) {
  const customerId = num(b.customer_id ?? existing?.customer_id);
  const vehicleId = optId(b.vehicle_id === undefined ? existing?.vehicle_id : b.vehicle_id);
  const pickup = normDateTime(b.pickup_at ?? existing?.pickup_at, 'Alış tarihi');
  const ret = normDateTime(b.return_at ?? existing?.return_at, 'Dönüş tarihi');
  if (ret <= pickup) throw new HttpError(400, 'Dönüş tarihi alış tarihinden sonra olmalıdır');
  if (!existing && pickup.slice(0, 10) < today()) throw new HttpError(400, 'Geçmiş tarihli rezervasyon oluşturulamaz');
  const vehicle = vehicleId ? await mustGet<Vehicle>('vehicles', vehicleId, 'Araç') : null;
  const category = vehicle?.category ?? str(b.category) ?? existing?.category;
  if (!category) throw new HttpError(400, 'Araç veya araç grubu seçilmelidir');
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new HttpError(400, 'Araç grubu geçersiz');
  const customer = await assertCustomerOk(customerId, pickup);
  const excl = { excludeReservationId: existing?.id || 0 };

  // Müsaitlik: araç seçiliyse araç bazlı, değilse grup bazlı (overbooking kontrolü)
  let waitlist = false;
  if (vehicle) await assertAvailable(vehicle.id, pickup, ret, excl);
  else {
    const g = await groupAvailability(category, pickup, ret, excl);
    if (g.available <= 0) {
      if (b.waitlist === true || b.waitlist === 'true' || existing?.status === 'waitlist') waitlist = true;
      else throw new HttpError(409, `${category} grubunda bu tarihlerde boş araç yok (${g.free} müsait, ${g.unassigned} atanmamış rezervasyon). Bekleme listesine ekleyebilirsiniz.`, { overbooking: true });
    }
  }

  const source = str(b.source) || existing?.source || 'Ofis';
  const agencyId = optId(b.agency_id === undefined ? existing?.agency_id : b.agency_id);
  const pb = optId(b.pickup_branch_id);
  const rb = optId(b.return_branch_id ?? b.pickup_branch_id);
  const q = await calcQuote({
    vehicle, category, pickup_at: pickup, return_at: ret, extras: parseExtras(b.extras), discount: b.discount, daily_rate: b.daily_rate,
    pickup_branch_id: pb, return_branch_id: rb, channel: source, coupon_code: b.coupon_code, customer,
  });
  const agency = agencyId ? await one<{ commission_pct: number }>('SELECT commission_pct FROM agencies WHERE id = ?', agencyId) : null;
  const channel = await one<{ commission_pct: number }>('SELECT commission_pct FROM channels WHERE code = ?', source);
  const commissionPct = agency?.commission_pct ?? channel?.commission_pct ?? 0;
  const data = {
    customer_id: customerId,
    vehicle_id: vehicle?.id ?? null,
    category,
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
    young_driver_fee: q.young_driver_fee,
    channel_markup: q.channel_markup,
    coupon_id: q.coupon_id,
    coupon_discount: q.coupon_discount,
    discount: q.discount,
    total_amount: q.total_amount,
    deposit_amount: str(b.deposit_amount) === null ? q.deposit_amount : Math.max(0, num(b.deposit_amount)),
    rate_plan_id: q.rate_plan_id,
    source,
    agency_id: agencyId,
    agency_commission: round2((q.total_amount * commissionPct) / 100),
    notes: str(b.notes ?? existing?.notes),
  };
  return { data, quote: q, waitlist };
}

async function saveLines(id: number, lines: LineItem[]) {
  await run('DELETE FROM reservation_extras WHERE reservation_id = ?', id);
  for (const l of lines) await insertRow('reservation_extras', { reservation_id: id, extra_id: l.extra_id, name: l.name, quantity: l.quantity, amount: l.amount });
}

/** İndirim kullanıcının limitini aşıyorsa onay talebi açılır ve rezervasyon beklemede kalır. */
function discountNeedsApproval(q: Quote, user: SessionUser) {
  if (!q.discount || can(user, 'approve')) return false;
  const gross = q.total_amount + q.discount;
  return gross > 0 && (q.discount / gross) * 100 > user.discount_limit_pct + 1e-9;
}

export async function createReservation(b: Body, user: SessionUser): Promise<ReservationDetail> {
  required(b, [['customer_id', 'Müşteri'], ['pickup_at', 'Alış tarihi'], ['return_at', 'Dönüş tarihi']]);
  const s = await getSettings();
  const id = await tx(async () => {
    const { data, quote: q, waitlist } = await buildReservation(b);
    const needsApproval = discountNeedsApproval(q, user);
    let status = waitlist ? 'waitlist' : oneOf(b.status, ['pending', 'confirmed'] as const, 'Durum', 'confirmed');
    if (needsApproval && status === 'confirmed') status = 'pending';
    const newId = await insertRow('reservations', {
      ...data,
      status,
      code: `TMP-${crypto.randomUUID()}`,
      portal_token: newToken(),
      option_expires_at: status === 'pending' ? fmtDateTime(new Date(Date.now() + num(s.option_hours, 24) * 3600000)) : null,
      created_by: user.id,
    });
    await run('UPDATE reservations SET code = ? WHERE id = ?', makeCode('RZ', newId), newId);
    await saveLines(newId, q.extras);
    if (q.coupon_id) await run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', q.coupon_id);
    if (needsApproval) {
      const ap = await requestApproval('discount', 'reservation', newId, q.discount, `İndirim kullanıcı limitini (%${user.discount_limit_pct}) aşıyor`, {}, user);
      await run('UPDATE reservations SET approval_id = ? WHERE id = ?', ap.id, newId);
    }
    const pre = num(b.prepayment);
    if (pre > 0) {
      await insertRow('payments', {
        customer_id: data.customer_id, reservation_id: newId, type: 'payment',
        method: oneOf(b.prepayment_method, METHODS, 'Ödeme yöntemi', 'credit_card'),
        amount: round2(pre), paid_at: nowLocal(), description: 'Rezervasyon ön ödemesi', created_by: user.id,
      });
    }
    await audit('reservation.create', 'reservation', newId, { status, total: q.total_amount, source: data.source });
    return newId;
  });
  const r = await getReservation(id);
  if (r.status === 'confirmed') await notifyReservation('reservation_confirmed', id, true);
  return r;
}

export async function updateReservation(id: number, b: Body, user: SessionUser): Promise<ReservationDetail> {
  const existing = await mustGet<Reservation>('reservations', id, 'Rezervasyon');
  if (!['pending', 'confirmed', 'waitlist'].includes(existing.status)) throw new HttpError(409, 'Yalnızca açık rezervasyonlar düzenlenebilir');
  await tx(async () => {
    const body: Body = {
      discount: existing.discount,
      daily_rate: existing.daily_rate,
      pickup_branch_id: existing.pickup_branch_id,
      return_branch_id: existing.return_branch_id,
      deposit_amount: existing.deposit_amount,
      source: existing.source,
      ...b,
      extras: b.extras ?? await all('SELECT extra_id, quantity FROM reservation_extras WHERE reservation_id = ?', id),
    };
    // Araç/grup değiştiyse ve özel fiyat verilmediyse yeni fiyat hesaplanır.
    const groupChanged = (b.vehicle_id !== undefined && optId(b.vehicle_id) !== existing.vehicle_id) || (b.category && b.category !== existing.category);
    if (groupChanged && b.daily_rate === undefined) body.daily_rate = null;
    if (b.coupon_code === undefined && existing.coupon_id) {
      body.coupon_code = (await one<{ code: string }>('SELECT code FROM coupons WHERE id = ?', existing.coupon_id))?.code;
    }
    const { data, quote: q, waitlist } = await buildReservation(body, existing);
    const update: Record<string, string | number | null> = { ...data };
    if (existing.status === 'waitlist' && !waitlist) update.status = 'confirmed';
    if (q.discount !== existing.discount && discountNeedsApproval(q, user)) {
      const ap = await requestApproval('discount', 'reservation', id, q.discount, `İndirim kullanıcı limitini (%${user.discount_limit_pct}) aşıyor`, {}, user);
      update.status = 'pending';
      update.approval_id = ap.id;
    }
    await updateRow('reservations', id, update);
    await saveLines(id, q.extras);
    await run('UPDATE payments SET customer_id = ? WHERE reservation_id = ?', data.customer_id, id);
    await audit('reservation.update', 'reservation', id, { total: q.total_amount });
  });
  return getReservation(id);
}

/** Grup rezervasyonuna araç atama (teslime yakın). */
export async function assignVehicle(id: number, vehicleId: number | null): Promise<ReservationDetail> {
  const r = await mustGet<Reservation>('reservations', id, 'Rezervasyon');
  if (!['pending', 'confirmed', 'waitlist'].includes(r.status)) throw new HttpError(409, 'Rezervasyon açık değil');
  if (vehicleId) {
    const v = await mustGet<Vehicle>('vehicles', vehicleId, 'Araç');
    await assertAvailable(v.id, r.pickup_at, r.return_at, { excludeReservationId: id });
    await updateRow('reservations', id, { vehicle_id: v.id, status: r.status === 'waitlist' ? 'confirmed' : r.status });
    await audit('reservation.assign', 'reservation', id, { vehicle_id: v.id, plate: v.plate, upgrade: v.category !== r.category });
  } else {
    await updateRow('reservations', id, { vehicle_id: null });
    await audit('reservation.unassign', 'reservation', id);
  }
  return getReservation(id);
}

/** Atanabilecek araçlar; grupta yoksa üst gruplardan upgrade önerileri. */
export async function assignmentOptions(id: number) {
  const r = await mustGet<Reservation>('reservations', id, 'Rezervasyon');
  const category = r.category ?? '';
  const free = async (cat: string) =>
    filterSeq(
      await all<Vehicle>(`SELECT * FROM vehicles WHERE category = ? AND status NOT IN ('sold','for_sale','out_of_service','damaged') ORDER BY daily_rate, plate`, cat),
      async (v) => (await findConflicts(v.id, r.pickup_at, r.return_at, { excludeReservationId: id })).length === 0,
    );
  const same = await free(category);
  const idx = (CATEGORIES as readonly string[]).indexOf(category);
  const upgrades = idx >= 0 ? (await mapSeq((CATEGORIES as readonly string[]).slice(idx + 1), (c) => free(c))).flat().slice(0, 10) : [];
  return { category, same, upgrades };
}

const TRANSITIONS = {
  confirm: { from: ['pending', 'waitlist'], to: 'confirmed' },
  cancel: { from: ['pending', 'confirmed', 'waitlist'], to: 'cancelled' },
  'no-show': { from: ['pending', 'confirmed'], to: 'no_show' },
} as const;

export type ReservationAction = keyof typeof TRANSITIONS;

/** İptal / no-show politikası ücreti. */
export async function policyFee(r: Reservation, action: 'cancel' | 'no-show', at = new Date()) {
  const s = await getSettings();
  if (action === 'no-show') return round2(r.daily_rate * num(s.no_show_fee_days, 1));
  const hoursBefore = (parseDate(r.pickup_at)!.getTime() - at.getTime()) / 3600000;
  return hoursBefore >= num(s.free_cancel_hours, 48) ? 0 : round2((r.total_amount * num(s.cancel_fee_pct)) / 100);
}

export async function transitionReservation(id: number, action: ReservationAction, b: Body = {}, user?: SessionUser): Promise<ReservationDetail> {
  const t = TRANSITIONS[action];
  const row = await mustGet<Reservation>('reservations', id, 'Rezervasyon');
  if (!(t.from as readonly string[]).includes(row.status)) throw new HttpError(409, `Bu işlem "${row.status}" durumundaki rezervasyona uygulanamaz`);
  if (action === 'confirm') {
    if (await pendingApproval('discount', 'reservation', id)) throw new HttpError(409, 'İndirim onayı bekleniyor; onaylanmadan rezervasyon onaylanamaz');
    if (row.status === 'waitlist' && !row.vehicle_id && (await groupAvailability(row.category!, row.pickup_at, row.return_at, { excludeReservationId: id })).available <= 0) {
      throw new HttpError(409, 'Grupta hâlâ boş araç yok');
    }
  }
  const update: Record<string, string | number | null> = { status: t.to };
  if (action !== 'confirm') {
    update.cancel_reason = str(b.reason) || (action === 'no-show' ? 'Müşteri gelmedi' : null);
    const waive = b.waive_fee === true || b.waive_fee === 'true';
    if (waive && user && !can(user, 'approve')) throw new HttpError(403, 'Ücretsiz iptal için onay yetkisi gerekir');
    update.cancellation_fee = waive || row.status === 'waitlist' ? 0 : await policyFee(row, action);
  }
  if (action === 'confirm') update.option_expires_at = null;
  await updateRow('reservations', id, update);
  await audit(`reservation.${action}`, 'reservation', id, { fee: update.cancellation_fee, reason: update.cancel_reason });
  const r = await getReservation(id);
  if (action === 'confirm') await notifyReservation('reservation_confirmed', id, true);
  return r;
}

/** Opsiyon süresi dolan bekleyen rezervasyonları iptal eder. */
export async function expireOptions(): Promise<number> {
  const expired = await all<{ id: number }>("SELECT id FROM reservations WHERE status = 'pending' AND option_expires_at IS NOT NULL AND option_expires_at < ?", nowLocal());
  for (const r of expired) {
    if (await pendingApproval('discount', 'reservation', r.id)) continue;
    await updateRow('reservations', r.id, { status: 'cancelled', cancel_reason: 'Opsiyon süresi doldu' });
    await audit('reservation.option_expired', 'reservation', r.id);
  }
  return expired.length;
}

/** İndirim onayı sonucu (approvals modülü çağırır). */
export async function applyDiscountDecision(id: number, approved: boolean) {
  const r = await mustGet<Reservation>('reservations', id, 'Rezervasyon');
  if (approved) {
    if (r.status === 'pending') await updateRow('reservations', id, { status: 'confirmed', option_expires_at: null });
    await notifyReservation('reservation_confirmed', id, true);
  } else {
    const total = round2(subtotal({ ...r, discount: 0 }));
    await updateRow('reservations', id, { discount: 0, total_amount: total, status: r.status === 'pending' ? 'confirmed' : r.status });
  }
}
