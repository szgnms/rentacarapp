// Fatura (e-Arşiv simülasyonu), iade faturası, cari ekstre, alacak yaşlandırma, acente komisyon ekstresi.
import crypto from 'node:crypto';
import { all, getSettings, insertRow, one, run, scalar, tx } from '../db';
import { HttpError, mapSeq, mustGet, nowLocal, num, parseDate, round2, str, today } from '../core';
import { rentalFinance } from '../rules';
import { audit } from '../audit';
import { sendTemplate } from './notify';
import type { Customer, LineItem, Rental, RentalCharge, SessionUser } from '../types';
import { text } from '../format';

export interface Invoice {
  id: number;
  invoice_no: string;
  type: 'sale' | 'return';
  rental_id: number | null;
  customer_id: number;
  related_invoice_id: number | null;
  issue_date: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  status: 'issued' | 'sent' | 'cancelled';
  e_archive_uuid: string | null;
  sent_at: string | null;
  pdf_file_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface InvoiceLine {
  id: number;
  invoice_id: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export type InvoiceRow = Invoice & { customer_name: string; contract_no: string | null };

export function listInvoices(f: { from?: string; to?: string; status?: string; customer_id?: string; rental_id?: string } = {}): Promise<InvoiceRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.from)) { where.push('i.issue_date >= ?'); params.push(str(f.from)!); }
  if (str(f.to)) { where.push('i.issue_date <= ?'); params.push(str(f.to)!); }
  if (str(f.status)) { where.push('i.status = ?'); params.push(str(f.status)!); }
  if (str(f.customer_id)) { where.push('i.customer_id = ?'); params.push(num(f.customer_id)); }
  if (str(f.rental_id)) { where.push('i.rental_id = ?'); params.push(num(f.rental_id)); }
  return all<InvoiceRow>(
    `SELECT i.*, c.first_name || ' ' || c.last_name AS customer_name, r.contract_no FROM invoices i
     JOIN customers c ON c.id = i.customer_id LEFT JOIN rentals r ON r.id = i.rental_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.id DESC LIMIT 1000`,
    ...params,
  );
}

export async function getInvoice(id: number) {
  const inv = await one<InvoiceRow>(
    `SELECT i.*, c.first_name || ' ' || c.last_name AS customer_name, r.contract_no FROM invoices i
     JOIN customers c ON c.id = i.customer_id LEFT JOIN rentals r ON r.id = i.rental_id WHERE i.id = ?`, id,
  );
  if (!inv) throw new HttpError(404, 'Fatura bulunamadı');
  return { ...inv, lines: await all<InvoiceLine>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', id), customer: await mustGet<Customer>('customers', inv.customer_id) };
}

async function nextInvoiceNo(): Promise<string> {
  const prefix = ((await getSettings()).invoice_prefix || 'ARS').toUpperCase().slice(0, 3).padEnd(3, 'X');
  const year = new Date().getFullYear();
  const n = await scalar<number>("SELECT COUNT(*) FROM invoices WHERE substr(invoice_no, 4, 4) = ?", String(year)) + 1;
  return `${prefix}${year}${String(n).padStart(9, '0')}`;
}

const invoicedNet = async (rentalId: number) =>
  round2(await scalar<number>(`SELECT COALESCE(SUM(CASE type WHEN 'sale' THEN total ELSE -total END),0) FROM invoices WHERE rental_id = ? AND status <> 'cancelled'`, rentalId));

async function createInvoice(
  data: { type: 'sale' | 'return'; rental_id: number | null; customer_id: number; related_invoice_id?: number | null; notes?: string | null },
  lines: { description: string; quantity: number; unit_price: number }[],
  user: SessionUser | null,
): Promise<number> {
  const vatRate = num((await getSettings()).vat_rate, 20);
  const total = round2(lines.reduce((a, l) => a + l.quantity * l.unit_price, 0));
  if (total <= 0) throw new HttpError(400, 'Fatura tutarı sıfırdan büyük olmalıdır');
  const vat = round2((total * vatRate) / (100 + vatRate));
  const id = await insertRow('invoices', {
    invoice_no: await nextInvoiceNo(), type: data.type, rental_id: data.rental_id, customer_id: data.customer_id, related_invoice_id: data.related_invoice_id ?? null,
    issue_date: today(), subtotal: round2(total - vat), vat_rate: vatRate, vat_amount: vat, total, status: 'issued', notes: data.notes ?? null,
    created_by: user?.id ?? null,
  });
  for (const l of lines) await insertRow('invoice_lines', { invoice_id: id, description: l.description, quantity: l.quantity, unit_price: round2(l.unit_price), amount: round2(l.quantity * l.unit_price) });
  await audit('invoice.issue', 'invoice', id, { type: data.type, total, rental_id: data.rental_id });
  return id;
}

/** Sözleşme tutarı ile faturalanmış tutar arasındaki farkı faturalar (fazlaysa satış, eksikse iade faturası). */
export async function issueInvoiceForRental(rentalId: number, user: SessionUser | null): Promise<Invoice | null> {
  const id = await tx(async () => {
    const r = await mustGet<Rental>('rentals', rentalId, 'Kiralama');
    if (r.status === 'draft' || r.status === 'cancelled') throw new HttpError(409, 'Bu sözleşme faturalanamaz');
    const diff = round2(r.total_amount - await invoicedNet(rentalId));
    if (Math.abs(diff) < 0.01) return null;
    if (diff < 0) {
      const last = await one<{ id: number }>("SELECT id FROM invoices WHERE rental_id = ? AND type = 'sale' AND status <> 'cancelled' ORDER BY id DESC", rentalId);
      return createInvoice(
        { type: 'return', rental_id: rentalId, customer_id: r.customer_id, related_invoice_id: last?.id, notes: 'Fiyat düzeltmesi / ücret iadesi' },
        [{ description: `${r.contract_no} fiyat düzeltmesi`, quantity: 1, unit_price: -diff }],
        user,
      );
    }
    const first = !await one('SELECT 1 FROM invoices WHERE rental_id = ? AND status <> \'cancelled\'', rentalId);
    const lines: { description: string; quantity: number; unit_price: number }[] = [];
    const pending = await all<RentalCharge>('SELECT * FROM rental_charges WHERE rental_id = ? AND invoice_id IS NULL ORDER BY id', rentalId);
    if (first) {
      lines.push({ description: `${r.contract_no} araç kiralama bedeli (${r.days} gün)`, quantity: r.days, unit_price: r.daily_rate });
      if (r.long_term_discount) lines.push({ description: 'Uzun dönem indirimi', quantity: 1, unit_price: -r.long_term_discount });
      if (r.channel_markup) lines.push({ description: 'Kanal fiyat farkı', quantity: 1, unit_price: r.channel_markup });
      for (const x of await all<LineItem>('SELECT * FROM rental_extras WHERE rental_id = ?', rentalId)) lines.push({ description: x.name, quantity: 1, unit_price: x.amount });
      if (r.one_way_fee) lines.push({ description: 'Tek yön (one-way) ücreti', quantity: 1, unit_price: r.one_way_fee });
      if (r.young_driver_fee) lines.push({ description: 'Genç sürücü ücreti', quantity: 1, unit_price: r.young_driver_fee });
      if (r.coupon_discount) lines.push({ description: 'Kampanya / kupon indirimi', quantity: 1, unit_price: -r.coupon_discount });
      if (r.discount) lines.push({ description: 'İndirim', quantity: 1, unit_price: -r.discount });
    }
    for (const c of pending) lines.push({ description: `${text('chargeType', c.type)}${c.description ? ' — ' + c.description : ''}`, quantity: 1, unit_price: c.amount });
    const sum = round2(lines.reduce((a, l) => a + l.quantity * l.unit_price, 0));
    if (Math.abs(sum - diff) >= 0.01) lines.push({ description: 'Fark düzeltmesi', quantity: 1, unit_price: round2(diff - sum) });
    const invId = await createInvoice({ type: 'sale', rental_id: rentalId, customer_id: r.customer_id }, lines, user);
    if (pending.length) await run(`UPDATE rental_charges SET invoice_id = ? WHERE id IN (${pending.map(() => '?').join(',')})`, invId, ...pending.map((c) => c.id));
    return invId;
  });
  if (!id) return null;
  const { invoicePdf } = await import('../documents');
  const pdf = await invoicePdf(id);
  await run('UPDATE invoices SET pdf_file_id = ? WHERE id = ?', pdf.id, id);
  const inv = (await one<Invoice>('SELECT * FROM invoices WHERE id = ?', id))!;
  const r = (await one<Rental>('SELECT * FROM rentals WHERE id = ?', rentalId))!;
  // Kapanış sonrası (HGS/ceza) faturaları ayrıca bildirilir; iade faturası iade e-postasında gider.
  if (r.status === 'closed' || await one('SELECT 1 FROM invoices WHERE rental_id = ? AND id < ?', rentalId, id)) {
    const customer = (await one<Customer>('SELECT * FROM customers WHERE id = ?', inv.customer_id))!;
    await sendTemplate('invoice_issued', {
      customer, entity: 'invoice', entityId: id, attachments: [pdf.id],
      vars: { invoice_no: inv.invoice_no, total: new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(inv.total) },
    });
  }
  return inv;
}

/** e-Arşiv gönderimi (GİB özel entegratör entegrasyonu yapılana kadar simülasyon). */
export async function sendInvoice(id: number) {
  const inv = await mustGet<Invoice>('invoices', id, 'Fatura');
  if (inv.status !== 'issued') throw new HttpError(409, 'Fatura gönderilebilir durumda değil');
  await run("UPDATE invoices SET status = 'sent', e_archive_uuid = ?, sent_at = ? WHERE id = ?", crypto.randomUUID(), nowLocal(), id);
  await audit('invoice.send', 'invoice', id);
  return getInvoice(id);
}

export async function cancelInvoice(id: number, reason: unknown) {
  const inv = await mustGet<Invoice>('invoices', id, 'Fatura');
  if (inv.status === 'cancelled') return getInvoice(id);
  await run("UPDATE invoices SET status = 'cancelled', notes = COALESCE(notes || ' · ', '') || ? WHERE id = ?", `İptal: ${str(reason) ?? '-'}`, id);
  await run('UPDATE rental_charges SET invoice_id = NULL WHERE invoice_id = ?', id);
  await audit('invoice.cancel', 'invoice', id, { reason });
  return getInvoice(id);
}

/** Manuel iade faturası (ör. hasar affı sonrası). */
export async function creditNote(invoiceId: number, amount: unknown, reason: unknown, user: SessionUser) {
  const inv = await mustGet<Invoice>('invoices', invoiceId, 'Fatura');
  if (inv.type !== 'sale' || inv.status === 'cancelled') throw new HttpError(409, 'Yalnızca geçerli satış faturasına iade faturası kesilebilir');
  const a = round2(num(amount));
  if (!(a > 0 && a <= inv.total)) throw new HttpError(400, 'İade tutarı geçersiz');
  const id = await createInvoice(
    { type: 'return', rental_id: inv.rental_id, customer_id: inv.customer_id, related_invoice_id: inv.id, notes: str(reason) },
    [{ description: `${inv.invoice_no} iadesi${str(reason) ? ' — ' + str(reason) : ''}`, quantity: 1, unit_price: a }],
    user,
  );
  const { invoicePdf } = await import('../documents');
  const pdf = await invoicePdf(id);
  await run('UPDATE invoices SET pdf_file_id = ? WHERE id = ?', pdf.id, id);
  return getInvoice(id);
}

// ================= Cari ekstre =================

export interface StatementLine {
  date: string;
  description: string;
  ref: string | null;
  link: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export async function customerStatement(customerId: number) {
  const customer = await mustGet<Customer>('customers', customerId, 'Müşteri');
  const lines: Omit<StatementLine, 'balance'>[] = [];
  for (const r of await all<Rental & { plate: string }>(
    `SELECT r.*, v.plate FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.customer_id = ? AND r.status NOT IN ('draft','cancelled')`, customerId,
  )) {
    const base = round2(r.total_amount - r.charges_amount);
    lines.push({ date: r.signed_at ?? r.pickup_at, description: `Kira bedeli · ${r.plate} · ${r.days} gün`, ref: r.contract_no, link: `/rentals/${r.id}`, debit: base, credit: 0 });
    for (const c of await all<RentalCharge>('SELECT * FROM rental_charges WHERE rental_id = ?', r.id)) {
      lines.push({
        date: c.created_at.replace(' ', 'T').slice(0, 16), description: `${text('chargeType', c.type)}${c.description ? ' — ' + c.description : ''}${c.post_charge ? ' (kapanış sonrası)' : ''}`,
        ref: r.contract_no, link: `/rentals/${r.id}`, debit: c.amount, credit: 0,
      });
    }
  }
  for (const p of await all<{ type: string; method: string; amount: number; paid_at: string; contract_no: string | null; rental_id: number | null; code: string | null; reservation_id: number | null }>(
    `SELECT p.type, p.method, p.amount, p.paid_at, r.contract_no, p.rental_id, res.code, p.reservation_id FROM payments p
     LEFT JOIN rentals r ON r.id = p.rental_id LEFT JOIN reservations res ON res.id = p.reservation_id
     WHERE p.customer_id = ? AND p.type IN ('payment','refund') AND (r.id IS NULL OR r.status NOT IN ('draft','cancelled'))`, customerId,
  )) {
    const ref = p.contract_no ?? p.code;
    const link = p.rental_id ? `/rentals/${p.rental_id}` : p.reservation_id ? `/reservations/${p.reservation_id}` : null;
    if (p.type === 'payment') lines.push({ date: p.paid_at, description: `Tahsilat (${text('method', p.method)})`, ref, link, debit: 0, credit: p.amount });
    else lines.push({ date: p.paid_at, description: `Müşteriye iade (${text('method', p.method)})`, ref, link, debit: p.amount, credit: 0 });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0;
  const out: StatementLine[] = lines.map((l) => {
    bal = round2(bal + l.debit - l.credit);
    return { ...l, balance: bal };
  });
  const deposits = await all<{ type: string; amount: number }>(`SELECT type, SUM(amount) amount FROM payments WHERE customer_id = ? AND type IN ('deposit_in','deposit_out') GROUP BY type`, customerId);
  const held = round2((deposits.find((d) => d.type === 'deposit_in')?.amount ?? 0) - (deposits.find((d) => d.type === 'deposit_out')?.amount ?? 0));
  return { customer, lines: out, balance: bal, deposit_held: held, credit_limit: customer.credit_limit };
}

// ================= Alacak yaşlandırma =================

export async function receivablesAging() {
  const buckets = ['0-30', '31-60', '61-90', '90+'] as const;
  const rows = (await mapSeq(await all<Rental & { customer_name: string; phone: string }>(
    `SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name, c.phone FROM rentals r JOIN customers c ON c.id = r.customer_id
     WHERE r.status IN ('active','returned','closed')`,
        ), async (r) => {
      const fin = await rentalFinance(r);
      const ref = r.actual_return_at ?? r.planned_return_at;
      const age = Math.max(0, Math.floor((Date.now() - parseDate(ref)!.getTime()) / 86400000));
      return {
        rental_id: r.id, contract_no: r.contract_no, customer_id: r.customer_id, customer_name: r.customer_name, phone: r.phone,
        status: r.status, due_date: ref, age, balance: fin.balance,
        bucket: age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '90+',
      };
    }))
    .filter((x) => x.balance > 0.009 && x.status !== 'active');
  const totals = Object.fromEntries(buckets.map((b) => [b, round2(rows.filter((r) => r.bucket === b).reduce((a, r) => a + r.balance, 0))])) as Record<(typeof buckets)[number], number>;
  return { rows: rows.sort((a, b) => b.age - a.age), totals, total: round2(rows.reduce((a, r) => a + r.balance, 0)) };
}

// ================= Acente komisyon ekstresi =================

export async function agencyStatement(f: { from?: string; to?: string; agency_id?: string }) {
  const to = str(f.to) ?? today();
  const from = str(f.from) ?? to.slice(0, 8) + '01';
  const params: (string | number)[] = [from, to + 'T23:59'];
  let extra = '';
  if (str(f.agency_id)) {
    extra = ' AND x.agency_id = ?';
    params.push(num(f.agency_id));
  }
  const rows = await all<{ kind: string; id: number; ref: string; agency_id: number; agency_name: string; customer_name: string; pickup_at: string; total: number; commission: number; status: string }>(
    `SELECT * FROM (
       SELECT 'rental' AS kind, r.id, r.contract_no AS ref, r.agency_id, a.name AS agency_name, c.first_name || ' ' || c.last_name AS customer_name,
              r.pickup_at, r.total_amount AS total, r.agency_commission AS commission, r.status
       FROM rentals r JOIN agencies a ON a.id = r.agency_id JOIN customers c ON c.id = r.customer_id WHERE r.status NOT IN ('draft','cancelled')
       UNION ALL
       SELECT 'reservation', r.id, r.code, r.agency_id, a.name, c.first_name || ' ' || c.last_name, r.pickup_at, r.total_amount, r.agency_commission, r.status
       FROM reservations r JOIN agencies a ON a.id = r.agency_id JOIN customers c ON c.id = r.customer_id WHERE r.status IN ('pending','confirmed')
     ) x WHERE x.pickup_at BETWEEN ? AND ?${extra} ORDER BY x.agency_name, x.pickup_at`,
    ...params,
  );
  const byAgency: Record<string, { agency_id: number; agency_name: string; count: number; total: number; commission: number }> = {};
  for (const r of rows) {
    const a = (byAgency[r.agency_id] ||= { agency_id: r.agency_id, agency_name: r.agency_name, count: 0, total: 0, commission: 0 });
    a.count++;
    a.total = round2(a.total + r.total);
    a.commission = round2(a.commission + r.commission);
  }
  return { from, to, rows, agencies: Object.values(byAgency) };
}
