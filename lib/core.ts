import { one } from './db';
import type { Body } from './types';

const HTTP_ERROR = Symbol.for('rentacar.HttpError');

export class HttpError extends Error {
  status: number;
  details?: unknown;
  readonly [HTTP_ERROR] = true;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }

  /**
   * Marka tabanlı instanceof: sunucu paketleri (instrumentation, RSC, route handler) sınıfın ayrı kopyalarını
   * içerebilir; globalThis üzerinden paylaşılan veritabanı sürücüsünün fırlattığı hata da tanınsın.
   */
  static [Symbol.hasInstance](x: unknown): boolean {
    return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[HTTP_ERROR] === true;
  }
}

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function num(v: unknown, d = 0): number {
  if (v === null || v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// ---------- Tarih yardımcıları ----------
// Tarihler yerel saatle "YYYY-MM-DDTHH:MM" biçiminde saklanır.

export function parseDate(s: unknown): Date | null {
  if (!s) return null;
  let str = String(s).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += 'T00:00';
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDateTime = (d: Date) => `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const nowLocal = () => fmtDateTime(new Date());
export const today = () => fmtDate(new Date());

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Normalizes user input to "YYYY-MM-DDTHH:MM" or throws. */
export function normDateTime(s: unknown, field = 'Tarih'): string {
  const d = parseDate(s);
  if (!d) throw new HttpError(400, `${field} geçersiz`);
  return fmtDateTime(d);
}

export function normDate(s: unknown, field?: string): string;
export function normDate(s: unknown, field: string, optional: true): string | null;
export function normDate(s: unknown, field = 'Tarih', optional = false): string | null {
  if (optional && (s === undefined || s === null || s === '')) return null;
  const d = parseDate(s);
  if (!d) throw new HttpError(400, `${field} geçersiz`);
  return fmtDate(d);
}

export function yearsBetween(from: unknown, to: unknown): number | null {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return null;
  let years = b.getFullYear() - a.getFullYear();
  const m = b.getMonth() - a.getMonth();
  if (m < 0 || (m === 0 && b.getDate() < a.getDate())) years -= 1;
  return years;
}

export const makeCode = (prefix: string, id: number) => `${prefix}${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;

// ---------- Girdi doğrulama ----------

export function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export const bool = (v: unknown) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);

/** Optional integer id (null when empty). */
export const optId = (v: unknown) => (str(v) === null ? null : num(v));

export function required(body: Body, fields: [string, string][]) {
  const missing = fields.filter(([k]) => str(body[k]) === null).map(([, label]) => label);
  if (missing.length) throw new HttpError(400, `Zorunlu alanlar eksik: ${missing.join(', ')}`);
}

export function oneOf<T extends string>(v: unknown, list: readonly T[], label: string, def?: T): T {
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    throw new HttpError(400, `${label} zorunludur`);
  }
  if (!list.includes(v as T)) throw new HttpError(400, `${label} geçersiz`);
  return v as T;
}

export function toId(v: unknown): number {
  const id = Math.floor(num(v));
  if (!(id > 0)) throw new HttpError(400, 'Geçersiz kayıt numarası');
  return id;
}

const TABLES = new Set([
  'users', 'branches', 'extras', 'vehicles', 'customers', 'reservations', 'rentals', 'payments', 'maintenance', 'damages', 'expenses',
  'vehicle_documents', 'vehicle_transfers', 'invoices', 'approvals', 'drivers', 'agencies', 'coupons', 'seasons', 'rate_plans', 'deposit_rules',
  'toll_transactions', 'traffic_fines', 'tasks', 'contract_templates', 'notification_templates', 'kabis_submissions',
]);

export async function mustGet<T>(table: string, id: number, label = 'Kayıt'): Promise<T> {
  if (!TABLES.has(table)) throw new Error(`Bilinmeyen tablo: ${table}`);
  const row = await one<T>(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, `${label} bulunamadı`);
  return row;
}

/** Sıralı async map (işlem içinde tek bağlantıda güvenli; sıra korunur). */
export async function mapSeq<T, R>(items: readonly T[], fn: (x: T, i: number) => Promise<R> | R): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
  return out;
}

/** Sıralı async filtre. */
export async function filterSeq<T>(items: readonly T[], pred: (x: T) => Promise<boolean> | boolean): Promise<T[]> {
  const out: T[] = [];
  for (const x of items) if (await pred(x)) out.push(x);
  return out;
}
