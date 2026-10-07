// Bildirim motoru: şablon (e-posta/SMS/WhatsApp) + değişkenler → gönderim logu.
// E-posta SMTP yapılandırıldıysa gerçekten gönderilir; SMS/WhatsApp sağlayıcı entegrasyonu için kuyruk/log tutulur.
import { after } from 'next/server';
import { all, getSettings, insertRow, one, outsideTx, run } from '../db';
import { HttpError, mapSeq, nowLocal, num, str } from '../core';
import { dt, money } from '../format';
import { readFile } from '../files';
import type { Customer } from '../types';

/**
 * Yanıt gönderildikten sonra çalışacak iş (e-posta kuyruğu). Sunucusuz ortamda yanıt sonrası
 * süreç dondurulabildiğinden Next.js `after()` kullanılır; istek dışında (test, betik) setImmediate.
 */
function later(fn: () => Promise<unknown>) {
  const job = () => outsideTx(() => fn()).catch((e) => console.error('Bildirim gönderimi', e));
  try {
    after(job);
  } catch {
    setImmediate(() => void job());
  }
}

export const TRIGGERS: Record<string, string> = {
  reservation_confirmed: 'Rezervasyon onayı',
  pickup_reminder: 'Teslim öncesi hatırlatma (24 saat)',
  contract_sent: 'Sözleşme gönderimi',
  return_reminder: 'İade hatırlatma (24 saat)',
  late_return: 'Geç iade uyarısı',
  checkin_completed: 'İade tamamlandı / hesap özeti',
  invoice_issued: 'Fatura',
  fine_notice: 'Trafik cezası bildirimi',
  hgs_notice: 'HGS/OGS geçiş bildirimi',
  nps: 'Memnuniyet anketi (NPS)',
};

export const CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Pazarlama izni gereken kanal → rıza tipi (İYS). */
const CONSENT_FOR: Record<Channel, string> = { email: 'marketing_email', sms: 'marketing_sms', whatsapp: 'marketing_whatsapp' };

export interface NotificationTemplate {
  id: number;
  code: string;
  channel: Channel;
  language: string;
  subject: string | null;
  body: string;
  marketing: number;
  active: number;
}

export interface MessageLog {
  id: number;
  template_code: string | null;
  channel: Channel;
  to_address: string | null;
  subject: string | null;
  body: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  entity: string | null;
  entity_id: number | null;
  customer_id: number | null;
  dedupe_key: string | null;
  attachments: string | null;
  created_at: string;
  sent_at: string | null;
}

export const render = (tpl: string, vars: Record<string, unknown>) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));

export async function hasConsent(customerId: number, type: string): Promise<boolean> {
  const c = await one<{ granted: number }>('SELECT granted FROM consents WHERE customer_id = ? AND type = ? ORDER BY id DESC LIMIT 1', customerId, type);
  return !!c?.granted;
}

const smtpReady = async () => {
  const s = await getSettings();
  return !!(s.smtp_host && s.smtp_from);
};

export const portalUrl = async (token: string | null | undefined) => (token ? `${(await getSettings()).public_base_url.replace(/\/$/, '')}/portal/${token}` : '');

interface SendOptions {
  customer: Customer;
  vars: Record<string, unknown>;
  entity: string;
  entityId: number;
  attachments?: number[];
  dedupeKey?: string;
}

/** Tetikleyici koduna ait tüm aktif şablonları müşteriye gönderir (kuyruğa alır). */
export async function sendTemplate(code: string, o: SendOptions): Promise<MessageLog[]> {
  const s = await getSettings();
  if (s.notify_auto !== '1' && code !== 'manual') return [];
  if (o.customer.anonymized_at) return [];
  const lang = o.customer.preferred_language || 'tr';
  const vars = {
    company_name: s.company_name, company_phone: s.company_phone, customer_name: `${o.customer.first_name} ${o.customer.last_name}`, ...o.vars,
  };
  const out: MessageLog[] = [];
  for (const channel of CHANNELS) {
    const tpl =
      await one<NotificationTemplate>('SELECT * FROM notification_templates WHERE code = ? AND channel = ? AND language = ? AND active = 1', code, channel, lang) ??
      await one<NotificationTemplate>("SELECT * FROM notification_templates WHERE code = ? AND channel = ? AND language = 'tr' AND active = 1", code, channel);
    if (!tpl) continue;
    const dedupe = o.dedupeKey ? `${o.dedupeKey}:${channel}` : null;
    if (dedupe && await one('SELECT 1 FROM message_log WHERE dedupe_key = ?', dedupe)) continue;
    const to = channel === 'email' ? o.customer.email : o.customer.phone;
    let status: MessageLog['status'] = 'queued';
    let error: string | null = null;
    if (!to) [status, error] = ['skipped', channel === 'email' ? 'Müşterinin e-posta adresi yok' : 'Müşterinin telefonu yok'];
    else if (tpl.marketing && !await hasConsent(o.customer.id, CONSENT_FOR[channel])) [status, error] = ['skipped', 'İYS/pazarlama izni yok'];
    else if (channel === 'email' && !await smtpReady()) [status, error] = ['skipped', 'SMTP yapılandırılmamış — mesaj kayda alındı'];
    else if (channel !== 'email') [status, error] = ['skipped', `${channel === 'sms' ? 'SMS' : 'WhatsApp'} sağlayıcısı yapılandırılmamış — mesaj kayda alındı`];
    const id = await insertRow('message_log', {
      template_code: code, channel, to_address: to, subject: tpl.subject ? render(tpl.subject, vars) : null, body: render(tpl.body, vars),
      status, error, entity: o.entity, entity_id: o.entityId, customer_id: o.customer.id, dedupe_key: dedupe,
      attachments: o.attachments?.length ? JSON.stringify(o.attachments) : null,
    });
    out.push((await one<MessageLog>('SELECT * FROM message_log WHERE id = ?', id))!);
  }
  if (out.some((m) => m.status === 'queued')) later(processOutbox);
  return out;
}

/** Kuyruktaki e-postaları SMTP ile gönderir. */
export async function processOutbox(): Promise<{ sent: number; failed: number }> {
  const queued = await all<MessageLog>("SELECT * FROM message_log WHERE status = 'queued' AND channel = 'email' ORDER BY id LIMIT 50");
  if (!queued.length) return { sent: 0, failed: 0 };
  if (!await smtpReady()) return { sent: 0, failed: 0 };
  const s = await getSettings();
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: s.smtp_host, port: num(s.smtp_port, 587), secure: num(s.smtp_port) === 465,
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
  });
  let sent = 0;
  let failed = 0;
  for (const m of queued) {
    try {
      const attachments = await mapSeq(m.attachments ? (JSON.parse(m.attachments) as number[]) : [], async (fid) => {
        const { file, data } = await readFile(fid);
        return { filename: file.original_name || `belge-${fid}.pdf`, content: data, contentType: file.mime };
      });
      await transport.sendMail({ from: s.smtp_from, to: m.to_address!, subject: m.subject ?? s.company_name, text: m.body, attachments });
      await run("UPDATE message_log SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", nowLocal(), m.id);
      sent++;
    } catch (e) {
      await run("UPDATE message_log SET status = 'failed', error = ? WHERE id = ?", String((e as Error).message).slice(0, 500), m.id);
      failed++;
    }
  }
  return { sent, failed };
}

/** Başarısız/atlanmış mesajı tekrar kuyruğa alır. */
export async function retryMessage(id: number) {
  const m = await one<MessageLog>('SELECT * FROM message_log WHERE id = ?', id);
  if (!m) throw new HttpError(404, 'Mesaj bulunamadı');
  await run("UPDATE message_log SET status = 'queued', error = NULL WHERE id = ?", id);
  if (m.channel !== 'email' || !await smtpReady()) {
    await run("UPDATE message_log SET status = 'skipped', error = ? WHERE id = ?", m.channel === 'email' ? 'SMTP yapılandırılmamış' : 'Sağlayıcı yapılandırılmamış', id);
  } else later(processOutbox);
  return one<MessageLog>('SELECT * FROM message_log WHERE id = ?', id);
}

export function listMessages(f: { status?: string; channel?: string; customer_id?: string; q?: string } = {}): Promise<MessageLog[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.status)) { where.push('status = ?'); params.push(str(f.status)!); }
  if (str(f.channel)) { where.push('channel = ?'); params.push(str(f.channel)!); }
  if (str(f.customer_id)) { where.push('customer_id = ?'); params.push(num(f.customer_id)); }
  if (str(f.q)) { where.push('(to_address ILIKE ? OR subject ILIKE ? OR body ILIKE ?)'); params.push(...Array(3).fill(`%${str(f.q)}%`)); }
  return all<MessageLog>(`SELECT * FROM message_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`, ...params);
}

// ---------- Varlık bazlı kısayollar ----------

const customerOf = (id: number) => one<Customer>('SELECT * FROM customers WHERE id = ?', id);

export async function notifyReservation(code: string, reservationId: number, dedupe?: boolean) {
  const r = await one<Record<string, unknown> & { customer_id: number; portal_token: string | null }>(
    `SELECT r.*, pb.name AS pickup_branch, rb.name AS return_branch FROM reservations r
     LEFT JOIN branches pb ON pb.id = r.pickup_branch_id LEFT JOIN branches rb ON rb.id = r.return_branch_id WHERE r.id = ?`, reservationId,
  );
  const customer = r && await customerOf(r.customer_id);
  if (!r || !customer) return [];
  return sendTemplate(code, {
    customer, entity: 'reservation', entityId: reservationId, dedupeKey: dedupe ? `${code}:reservation:${reservationId}` : undefined,
    vars: {
      code: r.code, category: r.category, pickup_at: dt(String(r.pickup_at)), return_at: dt(String(r.return_at)),
      pickup_branch: r.pickup_branch, return_branch: r.return_branch, total: money(Number(r.total_amount)), portal_url: await portalUrl(r.portal_token),
    },
  });
}

export async function notifyRental(code: string, rentalId: number, opts: { attachments?: number[]; dedupeKey?: string; vars?: Record<string, unknown> } = {}) {
  const r = await one<Record<string, unknown> & { customer_id: number; portal_token: string | null; total_amount: number }>(
    `SELECT r.*, v.plate, rb.name AS return_branch FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id
     LEFT JOIN branches rb ON rb.id = r.return_branch_id WHERE r.id = ?`, rentalId,
  );
  const customer = r && await customerOf(r.customer_id);
  if (!r || !customer) return [];
  const paid = (await all<{ type: string; t: number }>(`SELECT type, SUM(amount) t FROM payments WHERE rental_id = ? GROUP BY type`, rentalId))
    .reduce((a, x) => a + (x.type === 'payment' ? x.t : x.type === 'refund' ? -x.t : 0), 0);
  return sendTemplate(code, {
    customer, entity: 'rental', entityId: rentalId, attachments: opts.attachments, dedupeKey: opts.dedupeKey,
    vars: {
      contract_no: r.contract_no, plate: r.plate, return_at: dt(String(r.planned_return_at)), return_branch: r.return_branch,
      total: money(r.total_amount), paid: money(paid), balance: money(r.total_amount - paid), portal_url: await portalUrl(r.portal_token), ...opts.vars,
    },
  });
}
