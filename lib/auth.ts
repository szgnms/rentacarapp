import crypto from 'node:crypto';
import { one, run } from './db';
import { HttpError } from './core';
import { hashPassword, verifyPassword } from './password';
import { can, type Permission } from './permissions';
import type { SessionUser } from './types';

export const SESSION_COOKIE = 'sid';
export const SESSION_MAX_AGE = 7 * 86400; // saniye

export function login(username: unknown, password: unknown): { user: SessionUser; token: string } {
  const user = one<SessionUser & { password_hash: string; active: number }>(
    'SELECT * FROM users WHERE username = ?',
    String(username ?? '').trim(),
  );
  if (!user || !user.active || !verifyPassword(String(password ?? ''), user.password_hash)) {
    throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  run('DELETE FROM sessions WHERE expires_at < ?', now.toISOString());
  run('INSERT INTO sessions(token, user_id, expires_at) VALUES (?,?,?)', token, user.id,
    new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString());
  return { user: toSessionUser(user), token };
}

export function userFromToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const row = one<SessionUser & { active: number; expires_at: string }>(
    `SELECT u.id, u.username, u.full_name, u.role, u.branch_id, u.discount_limit_pct, u.active, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    token,
  );
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  return toSessionUser(row);
}

function toSessionUser(u: SessionUser): SessionUser {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, branch_id: u.branch_id ?? null, discount_limit_pct: u.discount_limit_pct ?? 0 };
}

export function logout(token: string) {
  run('DELETE FROM sessions WHERE token = ?', token);
}

export function changeOwnPassword(user: SessionUser, token: string, current: unknown, next: unknown) {
  const row = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!row || !verifyPassword(String(current ?? ''), row.password_hash)) throw new HttpError(400, 'Mevcut şifre hatalı');
  if (String(next ?? '').length < 6) throw new HttpError(400, 'Yeni şifre en az 6 karakter olmalıdır');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(next)), user.id);
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', user.id, token);
}

export function assertAdmin(user: SessionUser) {
  if (user.role !== 'admin') throw new HttpError(403, 'Bu işlem için yönetici yetkisi gerekir');
}

export function assertCan(user: SessionUser, perm: Permission) {
  if (!can(user, perm)) throw new HttpError(403, 'Bu işlem için yetkiniz yok');
}
