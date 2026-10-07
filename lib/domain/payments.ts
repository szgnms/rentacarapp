import { all, getSettings, insertRow, one, run } from '../db';
import { HttpError, mustGet, normDateTime, nowLocal, num, oneOf, round2, str } from '../core';
import { paymentTotals, rentalFinance } from '../rules';
import { audit } from '../audit';
import { can, scopedBranch } from '../permissions';
import { filterSql } from './reservations';
import { maybeClose } from './agreements';
import { requestApproval, type Approval } from './approval-core';
import type { Body, Payment, Rental, Reservation, SessionUser } from '../types';

const ALL_METHODS = ['cash', 'credit_card', 'bank_transfer', 'pos', 'payment_link', 'preauth'] as const;

export type PaymentRow = Payment & { customer_name: string; contract_no: string | null; reservation_code: string | null; created_by_name: string | null };

export function listPayments(f: Record<string, string | undefined> = {}, user?: SessionUser): PaymentRow[] {
  const { where, params } = filterSql(f, 'p.paid_at', []);
  for (const k of ['type', 'method'] as const) {
    if (str(f[k])) {
      where.push(`p.${k} = ?`);
      params.push(str(f[k])!);
    }
  }
  const branch = user ? scopedBranch(user) : null;
  if (branch) {
    where.push('(r.pickup_branch_id = ? OR res.pickup_branch_id = ?)');
    params.push(branch, branch);
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

export type PaymentResult = { payment: Payment | null; approval: Approval | null };

/**
 * Ödeme kaydı. İade için "payments.refund" yetkisi gerekir; depozito iadesi onay yetkisi olmayan
 * kullanıcılar için onay talebine dönüşür (onaylanınca otomatik işlenir).
 */
export function createPayment(b: Body, user: SessionUser): PaymentResult {
  const amount = round2(num(b.amount));
  if (!(amount > 0)) throw new HttpError(400, 'Tutar sıfırdan büyük olmalıdır');
  const type = oneOf(b.type, ['payment', 'refund', 'deposit_in', 'deposit_out'] as const, 'İşlem tipi', 'payment');
  const method = oneOf(b.method, ALL_METHODS, 'Ödeme yöntemi', 'cash');
  if (type === 'refund' && !can(user, 'payments.refund')) throw new HttpError(403, 'Müşteriye iade için yetkiniz yok');
  if (type === 'payment' && user.role === 'field' && amount > num(getSettings().field_payment_limit)) {
    throw new HttpError(403, `Saha personeli tahsilat limiti ${getSettings().field_payment_limit} ₺`);
  }
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
    if (type === 'deposit_in' || type === 'deposit_out') throw new HttpError(400, 'Depozito işlemleri sözleşme üzerinden yapılır');
    if (type === 'refund' && amount > paymentTotals('reservation_id', rsv.id).paid + 0.001) throw new HttpError(400, 'İade tutarı ödenen tutarı aşamaz');
  } else {
    throw new HttpError(400, 'Ödeme bir kiralama veya rezervasyona bağlı olmalıdır');
  }
  const row = {
    customer_id: customerId, rental_id: rentalId, reservation_id: reservationId, type, method, amount,
    paid_at: normDateTime(b.paid_at || nowLocal(), 'Ödeme tarihi'), reference: str(b.reference),
    installments: num(b.installments) || null, description: str(b.description), created_by: user.id,
  };
  if (type === 'deposit_out' && !can(user, 'approve')) {
    const approval = requestApproval('deposit_refund', 'rental', rentalId!, amount, str(b.description) ?? 'Depozito iadesi', row, user);
    return { payment: null, approval };
  }
  return { payment: insertPayment(row), approval: null };
}

export function insertPayment(row: Record<string, string | number | null>): Payment {
  const id = insertRow('payments', row);
  audit(`payment.${row.type}`, row.rental_id ? 'rental' : 'reservation', Number(row.rental_id ?? row.reservation_id), { amount: row.amount, method: row.method });
  if (row.rental_id) maybeClose(Number(row.rental_id));
  return one<Payment>('SELECT * FROM payments WHERE id = ?', id)!;
}

export function deletePayment(id: number) {
  const p = mustGet<Payment>('payments', id, 'Ödeme');
  run('DELETE FROM payments WHERE id = ?', id);
  audit('payment.delete', p.rental_id ? 'rental' : 'reservation', p.rental_id ?? p.reservation_id, { amount: p.amount, type: p.type });
  return { ok: true };
}
