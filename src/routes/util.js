import { HttpError } from '../services.js';
import { num } from '../db.js';

export const str = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);

export function required(body, fields) {
  const missing = fields.filter(([k]) => str(body[k]) === null).map(([, label]) => label);
  if (missing.length) throw new HttpError(400, `Zorunlu alanlar eksik: ${missing.join(', ')}`);
}

export function oneOf(v, list, label, def) {
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    throw new HttpError(400, `${label} zorunludur`);
  }
  if (!list.includes(v)) throw new HttpError(400, `${label} geçersiz`);
  return v;
}

export function idParam(req) {
  const id = Math.floor(num(req.params.id));
  if (!(id > 0)) throw new HttpError(400, 'Geçersiz kayıt numarası');
  return id;
}

export function mustGet(db, table, id, label = 'Kayıt') {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, `${label} bulunamadı`);
  return row;
}

/** Builds an UPDATE for the given allowed columns present in data. */
export function updateRow(db, table, id, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => data[k]),
    id,
  );
}

export function insertRow(db, table, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const r = db
    .prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => data[k]));
  return Number(r.lastInsertRowid);
}
