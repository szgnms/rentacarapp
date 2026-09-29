import { Router } from 'express';
import { getDb, getSettings, num, DEFAULT_SETTINGS } from '../db.js';
import { hashPassword, requireAdmin } from '../auth.js';
import { HttpError } from '../services.js';
import { str, bool, required, oneOf, idParam, mustGet, updateRow, insertRow } from './util.js';

const r = Router();

// ----- Şubeler -----
r.get('/branches', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM branches ORDER BY active DESC, name').all());
});

const branchData = (b) => ({
  name: str(b.name),
  city: str(b.city),
  address: str(b.address),
  phone: str(b.phone),
  active: b.active === undefined ? 1 : bool(b.active),
});

r.post('/branches', requireAdmin, (req, res) => {
  required(req.body, [['name', 'Şube adı']]);
  const id = insertRow(getDb(), 'branches', branchData(req.body));
  res.status(201).json(mustGet(getDb(), 'branches', id));
});

r.put('/branches/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  mustGet(getDb(), 'branches', id, 'Şube');
  required(req.body, [['name', 'Şube adı']]);
  updateRow(getDb(), 'branches', id, branchData(req.body));
  res.json(mustGet(getDb(), 'branches', id));
});

r.delete('/branches/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const db = getDb();
  const used =
    db.prepare('SELECT 1 FROM vehicles WHERE branch_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM rentals WHERE pickup_branch_id = ? OR return_branch_id = ? LIMIT 1').get(id, id) ||
    db.prepare('SELECT 1 FROM reservations WHERE pickup_branch_id = ? OR return_branch_id = ? LIMIT 1').get(id, id);
  if (used) {
    db.prepare('UPDATE branches SET active = 0 WHERE id = ?').run(id);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM branches WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ----- Ek hizmetler -----
r.get('/extras', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM extras ORDER BY active DESC, name').all());
});

const extraData = (b) => ({
  name: str(b.name),
  price_type: oneOf(b.price_type, ['daily', 'per_rental'], 'Fiyat tipi', 'daily'),
  price: Math.max(0, num(b.price)),
  max_price: str(b.max_price) === null ? null : Math.max(0, num(b.max_price)),
  active: b.active === undefined ? 1 : bool(b.active),
});

r.post('/extras', requireAdmin, (req, res) => {
  required(req.body, [['name', 'Ad']]);
  const id = insertRow(getDb(), 'extras', extraData(req.body));
  res.status(201).json(mustGet(getDb(), 'extras', id));
});

r.put('/extras/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  mustGet(getDb(), 'extras', id, 'Ek hizmet');
  required(req.body, [['name', 'Ad']]);
  updateRow(getDb(), 'extras', id, extraData(req.body));
  res.json(mustGet(getDb(), 'extras', id));
});

r.delete('/extras/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const db = getDb();
  const used =
    db.prepare('SELECT 1 FROM reservation_extras WHERE extra_id = ? LIMIT 1').get(id) ||
    db.prepare('SELECT 1 FROM rental_extras WHERE extra_id = ? LIMIT 1').get(id);
  if (used) {
    db.prepare('UPDATE extras SET active = 0 WHERE id = ?').run(id);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM extras WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ----- Ayarlar -----
r.get('/settings', (req, res) => res.json(getSettings()));

r.put('/settings', requireAdmin, (req, res) => {
  const db = getDb();
  const up = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (req.body[key] !== undefined) up.run(key, String(req.body[key] ?? ''));
  }
  res.json(getSettings());
});

// ----- Kullanıcılar -----
r.get('/users', requireAdmin, (req, res) => {
  res.json(getDb().prepare('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username').all());
});

r.post('/users', requireAdmin, (req, res) => {
  required(req.body, [['username', 'Kullanıcı adı'], ['full_name', 'Ad soyad'], ['password', 'Şifre']]);
  if (String(req.body.password).length < 6) throw new HttpError(400, 'Şifre en az 6 karakter olmalıdır');
  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(str(req.body.username))) {
    throw new HttpError(409, 'Bu kullanıcı adı zaten kullanılıyor');
  }
  const id = insertRow(db, 'users', {
    username: str(req.body.username),
    full_name: str(req.body.full_name),
    role: oneOf(req.body.role, ['admin', 'staff'], 'Rol', 'staff'),
    password_hash: hashPassword(req.body.password),
    active: req.body.active === undefined ? 1 : bool(req.body.active),
  });
  res.status(201).json(db.prepare('SELECT id, username, full_name, role, active FROM users WHERE id = ?').get(id));
});

r.put('/users/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const db = getDb();
  mustGet(db, 'users', id, 'Kullanıcı');
  const data = {
    full_name: str(req.body.full_name) ?? undefined,
    role: req.body.role ? oneOf(req.body.role, ['admin', 'staff'], 'Rol') : undefined,
    active: req.body.active === undefined ? undefined : bool(req.body.active),
  };
  if (id === req.user.id && (data.active === 0 || data.role === 'staff')) {
    throw new HttpError(400, 'Kendi yetkinizi kaldıramaz veya hesabınızı pasifleştiremezsiniz');
  }
  if (str(req.body.password)) {
    if (String(req.body.password).length < 6) throw new HttpError(400, 'Şifre en az 6 karakter olmalıdır');
    data.password_hash = hashPassword(req.body.password);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(id, req.token);
  }
  updateRow(db, 'users', id, data);
  if (data.active === 0) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json(db.prepare('SELECT id, username, full_name, role, active FROM users WHERE id = ?').get(id));
});

export default r;
