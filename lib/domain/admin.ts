import { all, getSettings, insertRow, one, run, updateRow, DEFAULT_SETTINGS } from '../db';
import { HttpError, bool, mustGet, num, oneOf, required, str } from '../core';
import { hashPassword } from '../password';
import type { Body, Branch, Extra, SessionUser, Settings, User } from '../types';

// ----- Şubeler -----
export const listBranches = () => all<Branch>('SELECT * FROM branches ORDER BY active DESC, name');

export function saveBranch(id: number | null, b: Body): Branch {
  required(b, [['name', 'Şube adı']]);
  const data = { name: str(b.name), city: str(b.city), address: str(b.address), phone: str(b.phone), active: b.active === undefined ? 1 : bool(b.active) };
  if (id) {
    mustGet('branches', id, 'Şube');
    updateRow('branches', id, data);
  } else id = insertRow('branches', data);
  return mustGet<Branch>('branches', id);
}

export function deleteBranch(id: number) {
  const used =
    one('SELECT 1 FROM vehicles WHERE branch_id = ? LIMIT 1', id) ||
    one('SELECT 1 FROM rentals WHERE pickup_branch_id = ? OR return_branch_id = ? LIMIT 1', id, id) ||
    one('SELECT 1 FROM reservations WHERE pickup_branch_id = ? OR return_branch_id = ? LIMIT 1', id, id);
  if (used) {
    run('UPDATE branches SET active = 0 WHERE id = ?', id);
    return { ok: true, deactivated: true };
  }
  run('DELETE FROM branches WHERE id = ?', id);
  return { ok: true };
}

// ----- Ek hizmetler -----
export const listExtras = () => all<Extra>('SELECT * FROM extras ORDER BY active DESC, name');

export function saveExtra(id: number | null, b: Body): Extra {
  required(b, [['name', 'Ad']]);
  const data = {
    name: str(b.name),
    price_type: oneOf(b.price_type, ['daily', 'per_rental'] as const, 'Fiyat tipi', 'daily'),
    price: Math.max(0, num(b.price)),
    max_price: str(b.max_price) === null ? null : Math.max(0, num(b.max_price)),
    active: b.active === undefined ? 1 : bool(b.active),
  };
  if (id) {
    mustGet('extras', id, 'Ek hizmet');
    updateRow('extras', id, data);
  } else id = insertRow('extras', data);
  return mustGet<Extra>('extras', id);
}

export function deleteExtra(id: number) {
  const used =
    one('SELECT 1 FROM reservation_extras WHERE extra_id = ? LIMIT 1', id) || one('SELECT 1 FROM rental_extras WHERE extra_id = ? LIMIT 1', id);
  if (used) {
    run('UPDATE extras SET active = 0 WHERE id = ?', id);
    return { ok: true, deactivated: true };
  }
  run('DELETE FROM extras WHERE id = ?', id);
  return { ok: true };
}

// ----- Ayarlar -----
export function updateSettings(b: Body): Settings {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (b[key] !== undefined) {
      run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(b[key] ?? ''));
    }
  }
  return getSettings();
}

// ----- Kullanıcılar -----
const USER_COLS = 'id, username, full_name, role, active, created_at';
export const listUsers = () => all<User>(`SELECT ${USER_COLS} FROM users ORDER BY username`);

export function createUser(b: Body): User {
  required(b, [['username', 'Kullanıcı adı'], ['full_name', 'Ad soyad'], ['password', 'Şifre']]);
  if (String(b.password).length < 6) throw new HttpError(400, 'Şifre en az 6 karakter olmalıdır');
  if (one('SELECT 1 FROM users WHERE username = ?', str(b.username))) throw new HttpError(409, 'Bu kullanıcı adı zaten kullanılıyor');
  const id = insertRow('users', {
    username: str(b.username),
    full_name: str(b.full_name),
    role: oneOf(b.role, ['admin', 'staff'] as const, 'Rol', 'staff'),
    password_hash: hashPassword(String(b.password)),
    active: b.active === undefined ? 1 : bool(b.active),
  });
  return one<User>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id)!;
}

export function updateUser(id: number, b: Body, actor: SessionUser, actorToken: string): User {
  mustGet('users', id, 'Kullanıcı');
  const data: Record<string, string | number | undefined> = {
    full_name: str(b.full_name) ?? undefined,
    role: b.role ? oneOf(b.role, ['admin', 'staff'] as const, 'Rol') : undefined,
    active: b.active === undefined ? undefined : bool(b.active),
  };
  if (id === actor.id && (data.active === 0 || data.role === 'staff')) {
    throw new HttpError(400, 'Kendi yetkinizi kaldıramaz veya hesabınızı pasifleştiremezsiniz');
  }
  if (str(b.password)) {
    if (String(b.password).length < 6) throw new HttpError(400, 'Şifre en az 6 karakter olmalıdır');
    data.password_hash = hashPassword(String(b.password));
    run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', id, actorToken);
  }
  updateRow('users', id, data);
  if (data.active === 0) run('DELETE FROM sessions WHERE user_id = ?', id);
  return one<User>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id)!;
}
