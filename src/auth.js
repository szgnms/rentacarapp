import crypto from 'node:crypto';

const SESSION_DAYS = 7;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return { token, maxAge: SESSION_DAYS * 86400000 };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function authMiddleware(db) {
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const token = cookies.sid || bearer;
    if (!token) return res.status(401).json({ error: 'Oturum açmanız gerekiyor' });
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.role, u.active, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      )
      .get(token);
    if (!row || row.expires_at < new Date().toISOString() || !row.active) {
      return res.status(401).json({ error: 'Oturum süresi doldu' });
    }
    req.user = { id: row.id, username: row.username, full_name: row.full_name, role: row.role };
    req.token = token;
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekir' });
  next();
}
