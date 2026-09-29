import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { authMiddleware, createSession, verifyPassword, hashPassword } from './auth.js';
import { HttpError } from './services.js';
import adminRoutes from './routes/admin.js';
import fleetRoutes from './routes/fleet.js';
import operationRoutes from './routes/operations.js';
import serviceRoutes, { EXPENSE_CATEGORIES } from './routes/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  const db = getDb();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // ----- Kimlik doğrulama -----
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
    if (!user || !user.active || !verifyPassword(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
    const { token, maxAge } = createSession(db, user.id);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge, secure: process.env.COOKIE_SECURE === '1' });
    res.json({ id: user.id, username: user.username, full_name: user.full_name, role: user.role, token });
  });

  const api = express.Router();
  api.use(authMiddleware(db));
  api.get('/auth/me', (req, res) => res.json(req.user));
  api.post('/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    res.clearCookie('sid');
    res.json({ ok: true });
  });
  api.post('/auth/password', (req, res) => {
    const { current_password, new_password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(current_password || '', user.password_hash)) throw new HttpError(400, 'Mevcut şifre hatalı');
    if (String(new_password || '').length < 6) throw new HttpError(400, 'Yeni şifre en az 6 karakter olmalıdır');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(user.id, req.token);
    res.json({ ok: true });
  });
  api.get('/expense-categories', (req, res) => res.json(EXPENSE_CATEGORIES));
  api.use(adminRoutes);
  api.use(fleetRoutes);
  api.use(operationRoutes);
  api.use(serviceRoutes);
  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı' }));

  // ----- Ön yüz -----
  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(pub, 'index.html')));

  // ----- Hata yönetimi -----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON' });
    if (String(err.message).includes('constraint failed')) {
      return res.status(400).json({ error: 'Veri kısıtı ihlali: ' + err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  });
  return app;
}
