// HGS/OGS geçişleri ve trafik cezaları: içe aktarma, sözleşmeyle eşleştirme, istisna kuyruğu, müşteriye yansıtma.
import { all, getSettings, insertRow, one, run, tx, updateRow } from '../db';
import { HttpError, addDays, fmtDate, fmtDateTime, mustGet, normDateTime, nowLocal, num, oneOf, optId, parseDate, required, round2, str, today } from '../core';
import { recalcRental } from '../rules';
import { audit } from '../audit';
import { notifyRental, portalUrl, sendTemplate } from './notify';
import { dt, money } from '../format';
import type { Body, Customer, Rental, SessionUser, Vehicle } from '../types';

// ---------- CSV ----------

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') {
        if (q && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === delim && !q) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]).map((h) => h.toLocaleLowerCase('tr-TR').replace(/[^a-zçğıöşü0-9_]/g, ''));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i] ?? `c${i}`, v])));
}

const pick = (row: Record<string, string>, keys: string[]) => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
  return '';
};

/** "12.03.2026 14:35" / "2026-03-12 14:35" / ISO → "YYYY-MM-DDTHH:MM" */
export function parseTrDateTime(s: string): string | null {
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s.trim());
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}`;
  const d = parseDate(s);
  return d ? fmtDateTime(d) : null;
}

const parseAmount = (s: string) => num(String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'), NaN);
const normPlate = (p: string) => p.toLocaleUpperCase('tr-TR').replace(/\s+/g, '');

function findVehicle(plate: string, tag?: string): Vehicle | undefined {
  if (tag) {
    const v = one<Vehicle>('SELECT * FROM vehicles WHERE hgs_tag_no = ?', tag);
    if (v) return v;
  }
  return plate ? one<Vehicle>("SELECT * FROM vehicles WHERE REPLACE(UPPER(plate), ' ', '') = ?", normPlate(plate)) : undefined;
}

/** Olay zamanında aracı kullanan sözleşme (teslim ≤ t ≤ iade). */
export function rentalAt(vehicleId: number, at: string): Rental | undefined {
  return one<Rental>(
    `SELECT * FROM rentals WHERE vehicle_id = ? AND status IN ('active','returned','closed') AND pickup_at <= ?
       AND COALESCE(actual_return_at, MAX(planned_return_at, ?)) >= ? ORDER BY pickup_at DESC LIMIT 1`,
    vehicleId, at, nowLocal(), at,
  ) ?? // ikame araç değişikliklerinde eski araçla yapılan geçişler
    one<Rental>(
      `SELECT r.* FROM rental_vehicle_changes c JOIN rentals r ON r.id = c.rental_id
       WHERE c.old_vehicle_id = ? AND r.pickup_at <= ? AND c.changed_at >= ? LIMIT 1`, vehicleId, at, at,
    );
}

// ================= HGS / OGS =================

export interface Toll {
  id: number;
  vehicle_id: number | null;
  plate: string | null;
  tag_no: string | null;
  passed_at: string;
  location: string | null;
  amount: number;
  rental_id: number | null;
  status: 'unmatched' | 'matched' | 'charged' | 'company' | 'disputed';
  charge_id: number | null;
  service_fee: number;
  batch: string | null;
  note: string | null;
  created_at: string;
}

export type TollRow = Toll & { contract_no: string | null; customer_name: string | null };

export function listTolls(f: { status?: string; q?: string; from?: string; to?: string } = {}): TollRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.status)) { where.push('t.status = ?'); params.push(str(f.status)!); }
  if (str(f.q)) { where.push('(t.plate LIKE ? OR t.location LIKE ? OR r.contract_no LIKE ?)'); params.push(...Array(3).fill(`%${str(f.q)}%`)); }
  if (str(f.from)) { where.push('t.passed_at >= ?'); params.push(str(f.from)!); }
  if (str(f.to)) { where.push('t.passed_at <= ?'); params.push(str(f.to) + 'T23:59'); }
  return all<TollRow>(
    `SELECT t.*, r.contract_no, c.first_name || ' ' || c.last_name AS customer_name FROM toll_transactions t
     LEFT JOIN rentals r ON r.id = t.rental_id LEFT JOIN customers c ON c.id = r.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.status = 'unmatched' DESC, t.passed_at DESC LIMIT 1000`,
    ...params,
  );
}

function chargeToll(t: Toll, rental: Rental, userId: number | null) {
  const fee = num(getSettings().hgs_service_fee);
  const chargeId = insertRow('rental_charges', {
    rental_id: rental.id, type: 'hgs', amount: round2(t.amount + fee), toll_id: t.id, created_by: userId,
    description: `${dt(t.passed_at)} ${t.location ?? ''} (${money(t.amount)} + hizmet ${money(fee)})`.trim(),
    post_charge: rental.status === 'returned' || rental.status === 'closed' ? 1 : 0,
  });
  updateRow('toll_transactions', t.id, { status: 'charged', rental_id: rental.id, charge_id: chargeId, service_fee: fee });
  recalcRental(rental.id);
  notifyRental('hgs_notice', rental.id, { vars: { amount: money(t.amount + fee) }, dedupeKey: `hgs:${t.id}` });
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

/** Banka/PTT/sağlayıcı ekstresi CSV'si: plaka;tarih;gise;tutar (başlık isimleri esnek). */
export function importTolls(csv: string, user: SessionUser): ImportResult {
  const rows = parseCsv(csv);
  if (!rows.length) throw new HttpError(400, 'CSV boş veya başlık satırı yok');
  const res: ImportResult = { imported: 0, duplicates: 0, matched: 0, unmatched: 0, errors: [] };
  const batch = `HGS-${fmtDateTime(new Date())}`;
  tx(() => {
    rows.forEach((row, i) => {
      const plate = pick(row, ['plaka', 'plate']);
      const tag = pick(row, ['etiket', 'etiketno', 'tag', 'hgs', 'ogs']);
      const passed = parseTrDateTime(pick(row, ['tarih', 'tarihsaat', 'gecistarihi', 'date', 'datetime', 'passed_at']));
      const amount = parseAmount(pick(row, ['tutar', 'ucret', 'amount']));
      const location = pick(row, ['gise', 'gişe', 'giseadi', 'yer', 'istasyon', 'location']) || null;
      if (!passed || !Number.isFinite(amount) || (!plate && !tag)) {
        res.errors.push(`Satır ${i + 2}: plaka/etiket, tarih ve tutar zorunlu`);
        return;
      }
      const vehicle = findVehicle(plate, tag);
      const r = run(
        `INSERT OR IGNORE INTO toll_transactions(vehicle_id, plate, tag_no, passed_at, location, amount, batch) VALUES (?,?,?,?,?,?,?)`,
        vehicle?.id ?? null, vehicle?.plate ?? plate.toLocaleUpperCase('tr-TR'), tag || vehicle?.hgs_tag_no || null, passed, location, round2(amount), batch,
      );
      if (!r.changes) {
        res.duplicates++;
        return;
      }
      res.imported++;
      const toll = one<Toll>('SELECT * FROM toll_transactions WHERE id = ?', Number(r.lastInsertRowid))!;
      if (vehicle) run('UPDATE vehicles SET hgs_balance = hgs_balance - ? WHERE id = ?', toll.amount, vehicle.id);
      const rental = vehicle ? rentalAt(vehicle.id, passed) : undefined;
      if (rental) {
        chargeToll(toll, rental, user.id);
        res.matched++;
      } else res.unmatched++;
    });
  });
  audit('toll.import', 'toll', null, { ...res, errors: res.errors.length });
  return res;
}

/** İstisna kuyruğu: elle sözleşmeye bağla / şirket gideri / itiraz. */
export function resolveToll(id: number, action: 'assign' | 'company' | 'dispute', b: Body, user: SessionUser): Toll {
  const t = mustGet<Toll>('toll_transactions', id, 'Geçiş');
  if (t.status === 'charged' && action !== 'dispute') throw new HttpError(409, 'Geçiş zaten müşteriye yansıtılmış');
  tx(() => {
    if (action === 'assign') {
      const rental = mustGet<Rental>('rentals', num(b.rental_id), 'Sözleşme');
      chargeToll(t, rental, user.id);
    } else if (action === 'company') {
      updateRow('toll_transactions', id, { status: 'company', note: str(b.note) });
      insertRow('expenses', { vehicle_id: t.vehicle_id, category: 'HGS yükleme', amount: t.amount, expense_date: t.passed_at.slice(0, 10), description: `Şirket kullanımı geçiş: ${t.location ?? ''}`, created_by: user.id });
    } else updateRow('toll_transactions', id, { status: 'disputed', note: str(b.note) });
    audit(`toll.${action}`, 'toll', id, { rental_id: b.rental_id });
  });
  return mustGet<Toll>('toll_transactions', id);
}

/** Sözleşme bulunamayan geçişleri yeniden eşleştirmeyi dener (geç gelen kayıtlar için). */
export function rematchTolls(user: SessionUser) {
  let n = 0;
  for (const t of all<Toll>("SELECT * FROM toll_transactions WHERE status = 'unmatched' AND vehicle_id IS NOT NULL")) {
    const r = rentalAt(t.vehicle_id!, t.passed_at);
    if (r) {
      tx(() => chargeToll(t, r, user.id));
      n++;
    }
  }
  return { matched: n };
}

// ================= TRAFİK CEZALARI =================

export const FINE_TYPES: Record<string, string> = {
  speed: 'Hız ihlali', eds: 'EDS (elektronik denetim)', red_light: 'Kırmızı ışık', parking: 'Park cezası', closed_road: 'Kapalı yol / şerit ihlali',
  tow: 'Çekici / otopark', toll_evasion: 'Otoyol kaçak geçiş', other: 'Diğer',
};

export interface Fine {
  id: number;
  vehicle_id: number | null;
  plate: string;
  fine_no: string | null;
  violation_at: string;
  type: string;
  location: string | null;
  amount: number;
  notified_at: string | null;
  discount_deadline: string | null;
  rental_id: number | null;
  customer_id: number | null;
  status: 'new' | 'matched' | 'transferred' | 'charged' | 'paid' | 'objected' | 'closed' | 'cancelled';
  charge_id: number | null;
  service_fee: number;
  paid_amount: number | null;
  paid_at: string | null;
  objection_note: string | null;
  file_id: number | null;
  notes: string | null;
  created_at: string;
}

export type FineRow = Fine & { contract_no: string | null; customer_name: string | null; limitation_date: string; warning: string | null };

function fineWarning(f: Fine): string | null {
  if (['paid', 'closed', 'cancelled'].includes(f.status)) return null;
  const t = today();
  if (f.discount_deadline) {
    if (f.discount_deadline < t) return 'İndirimli ödeme süresi geçti';
    if (f.discount_deadline <= fmtDate(addDays(new Date(), 3))) return `İndirimli ödeme son günü: ${f.discount_deadline}`;
  }
  return null;
}

export function listFines(f: { status?: string; q?: string } = {}): FineRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (str(f.status)) { where.push('f.status = ?'); params.push(str(f.status)!); }
  if (str(f.q)) { where.push('(f.plate LIKE ? OR f.fine_no LIKE ? OR r.contract_no LIKE ?)'); params.push(...Array(3).fill(`%${str(f.q)}%`)); }
  const limitDays = num(getSettings().fine_limitation_days, 730);
  return all<Fine & { contract_no: string | null; customer_name: string | null }>(
    `SELECT f.*, r.contract_no, c.first_name || ' ' || c.last_name AS customer_name FROM traffic_fines f
     LEFT JOIN rentals r ON r.id = f.rental_id LEFT JOIN customers c ON c.id = f.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.violation_at DESC LIMIT 1000`,
    ...params,
  ).map((x) => ({ ...x, limitation_date: fmtDate(addDays(parseDate(x.violation_at)!, limitDays)), warning: fineWarning(x) }));
}

function matchFine(id: number) {
  const f = mustGet<Fine>('traffic_fines', id);
  if (!f.vehicle_id) return;
  const r = rentalAt(f.vehicle_id, f.violation_at);
  if (r) updateRow('traffic_fines', id, { rental_id: r.id, customer_id: r.customer_id, status: f.status === 'new' ? 'matched' : f.status });
}

function fineData(b: Body) {
  required(b, [['plate', 'Plaka'], ['violation_at', 'İhlal tarihi'], ['amount', 'Tutar']]);
  const vehicle = findVehicle(String(b.plate));
  const notified = str(b.notified_at) ? normDateTime(b.notified_at, 'Tebliğ tarihi').slice(0, 10) : null;
  return {
    vehicle_id: vehicle?.id ?? null,
    plate: vehicle?.plate ?? String(b.plate).toLocaleUpperCase('tr-TR'),
    fine_no: str(b.fine_no),
    violation_at: normDateTime(parseTrDateTime(String(b.violation_at)) ?? b.violation_at, 'İhlal tarihi'),
    type: oneOf(b.type, Object.keys(FINE_TYPES), 'Ceza tipi', 'other'),
    location: str(b.location),
    amount: round2(num(b.amount)),
    notified_at: notified,
    discount_deadline: notified ? fmtDate(addDays(parseDate(notified)!, num(getSettings().fine_discount_days, 15))) : null,
    file_id: optId(b.file_id),
    notes: str(b.notes),
  };
}

export function createFine(b: Body, user: SessionUser): FineRow {
  const id = insertRow('traffic_fines', { ...fineData(b), created_by: user.id });
  matchFine(id);
  audit('fine.create', 'fine', id);
  return listFines().find((x) => x.id === id)!;
}

export function importFines(csv: string, user: SessionUser): ImportResult {
  const rows = parseCsv(csv);
  if (!rows.length) throw new HttpError(400, 'CSV boş veya başlık satırı yok');
  const res: ImportResult = { imported: 0, duplicates: 0, matched: 0, unmatched: 0, errors: [] };
  tx(() => {
    rows.forEach((row, i) => {
      try {
        const body = {
          plate: pick(row, ['plaka', 'plate']), violation_at: pick(row, ['tarih', 'cezatarihi', 'ihlaltarihi', 'date']),
          amount: parseAmount(pick(row, ['tutar', 'ceza', 'amount'])), fine_no: pick(row, ['cezano', 'tutanakno', 'no', 'fine_no']) || null,
          location: pick(row, ['yer', 'konum', 'location']) || null, notified_at: pick(row, ['teblig', 'tebligtarihi', 'notified_at']) || null,
          type: pick(row, ['tip', 'type']) || 'other',
        };
        const parsedNotified = body.notified_at ? parseTrDateTime(body.notified_at) : null;
        if (body.fine_no && one('SELECT 1 FROM traffic_fines WHERE fine_no = ?', body.fine_no)) {
          res.duplicates++;
          return;
        }
        const id = insertRow('traffic_fines', { ...fineData({ ...body, notified_at: parsedNotified, type: FINE_TYPES[body.type] ? body.type : 'other' }), created_by: user.id });
        matchFine(id);
        res.imported++;
        if (one('SELECT 1 FROM traffic_fines WHERE id = ? AND rental_id IS NOT NULL', id)) res.matched++;
        else res.unmatched++;
      } catch (e) {
        res.errors.push(`Satır ${i + 2}: ${(e as Error).message}`);
      }
    });
  });
  audit('fine.import', 'fine', null, { ...res, errors: res.errors.length });
  return res;
}

export async function fineAction(id: number, action: string, b: Body, user: SessionUser): Promise<Fine> {
  const f = mustGet<Fine>('traffic_fines', id, 'Ceza');
  switch (action) {
    case 'assign': {
      const r = mustGet<Rental>('rentals', num(b.rental_id), 'Sözleşme');
      updateRow('traffic_fines', id, { rental_id: r.id, customer_id: r.customer_id, status: f.status === 'new' ? 'matched' : f.status });
      break;
    }
    case 'charge': {
      if (!f.rental_id) throw new HttpError(409, 'Ceza bir sözleşmeyle eşleşmemiş');
      if (f.charge_id) throw new HttpError(409, 'Ceza zaten yansıtılmış');
      const r = mustGet<Rental>('rentals', f.rental_id);
      const fee = str(b.service_fee) === null ? num(getSettings().fine_service_fee) : num(b.service_fee);
      tx(() => {
        const chargeId = insertRow('rental_charges', {
          rental_id: r.id, type: 'traffic_fine', amount: round2(f.amount + fee), fine_id: id, created_by: user.id,
          description: `${FINE_TYPES[f.type] ?? f.type} ${dt(f.violation_at)}${f.fine_no ? ' #' + f.fine_no : ''} (${money(f.amount)} + hizmet ${money(fee)})`,
          post_charge: r.status === 'returned' || r.status === 'closed' ? 1 : 0,
        });
        updateRow('traffic_fines', id, { status: 'charged', charge_id: chargeId, service_fee: fee });
        recalcRental(r.id);
      });
      const customer = one<Customer>('SELECT * FROM customers WHERE id = ?', r.customer_id)!;
      sendTemplate('fine_notice', {
        customer, entity: 'fine', entityId: id, dedupeKey: `fine:${id}`,
        vars: { plate: f.plate, contract_no: r.contract_no, violation_at: dt(f.violation_at), amount: money(f.amount + fee), portal_url: portalUrl(r.portal_token) },
      });
      break;
    }
    case 'transfer': {
      // Sürücüye devir (kabahatliye bildirim) yazısı
      const { fineLetterPdf } = await import('../documents');
      const pdf = await fineLetterPdf(id);
      updateRow('traffic_fines', id, { status: 'transferred', file_id: f.file_id ?? pdf.id, notes: [f.notes, `Devir yazısı #${pdf.id}`].filter(Boolean).join(' · ') });
      break;
    }
    case 'pay':
      updateRow('traffic_fines', id, { status: f.charge_id ? 'closed' : 'paid', paid_amount: num(b.paid_amount, f.amount), paid_at: str(b.paid_at) ?? today() });
      if (!f.charge_id) {
        insertRow('expenses', { vehicle_id: f.vehicle_id, category: 'Trafik cezası', amount: num(b.paid_amount, f.amount), expense_date: today(), description: `Ceza ${f.fine_no ?? id} şirket ödemesi`, created_by: user.id });
      }
      break;
    case 'object':
      updateRow('traffic_fines', id, { status: 'objected', objection_note: str(b.note) });
      break;
    case 'close':
      updateRow('traffic_fines', id, { status: 'closed', notes: [f.notes, str(b.note)].filter(Boolean).join(' · ') });
      break;
    case 'cancel':
      if (f.charge_id) throw new HttpError(409, 'Yansıtılmış ceza önce ücret affı ile geri alınmalı');
      updateRow('traffic_fines', id, { status: 'cancelled', notes: str(b.note) });
      break;
    default:
      throw new HttpError(404, 'Bilinmeyen işlem');
  }
  audit(`fine.${action}`, 'fine', id, { rental_id: b.rental_id });
  return mustGet<Fine>('traffic_fines', id);
}

/** HGS/ceza yönetim özeti (gösterge paneli ve raporlar için). */
export function tollFineSummary() {
  return {
    unmatched_tolls: one<{ n: number }>("SELECT COUNT(*) n FROM toll_transactions WHERE status = 'unmatched'")!.n,
    open_fines: one<{ n: number }>("SELECT COUNT(*) n FROM traffic_fines WHERE status IN ('new','matched','transferred')")!.n,
    fine_deadlines: listFines().filter((f) => f.warning).length,
    low_hgs: all<{ id: number; plate: string; hgs_balance: number }>(
      "SELECT id, plate, hgs_balance FROM vehicles WHERE hgs_tag_no IS NOT NULL AND status <> 'sold' AND hgs_balance < ?", num(getSettings().hgs_low_balance),
    ),
  };
}
