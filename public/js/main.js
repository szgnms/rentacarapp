import { api, html, state, loadLookups, setView, toast, esc, LABELS } from './core.js';
import * as dashboard from './pages/dashboard.js';
import * as vehicles from './pages/vehicles.js';
import * as customers from './pages/customers.js';
import * as reservations from './pages/reservations.js';
import * as rentals from './pages/rentals.js';
import * as booking from './pages/booking.js';
import * as calendar from './pages/calendar.js';
import * as maintenance from './pages/maintenance.js';
import * as finance from './pages/finance.js';
import * as reports from './pages/reports.js';
import * as settings from './pages/settings.js';

const app = document.getElementById('app');

const NAV = [
  ['Operasyon'],
  ['#/dashboard', '📊', 'Gösterge Paneli'],
  ['#/booking', '➕', 'Yeni Kiralama / Rez.'],
  ['#/reservations', '📅', 'Rezervasyonlar'],
  ['#/rentals', '🔑', 'Kiralamalar'],
  ['#/calendar', '🗓️', 'Filo Takvimi'],
  ['Kayıtlar'],
  ['#/vehicles', '🚗', 'Araçlar'],
  ['#/customers', '👤', 'Müşteriler'],
  ['#/maintenance', '🔧', 'Bakım & Hasar'],
  ['Finans'],
  ['#/payments', '💳', 'Ödemeler'],
  ['#/expenses', '🧾', 'Masraflar'],
  ['#/reports', '📈', 'Raporlar'],
  ['Sistem'],
  ['#/settings', '⚙️', 'Ayarlar'],
];

// [regex, module, param names]
const ROUTES = [
  [/^\/dashboard$/, dashboard],
  [/^\/vehicles$/, vehicles, 'list'],
  [/^\/vehicles\/(\d+)$/, vehicles, 'detail'],
  [/^\/customers$/, customers, 'list'],
  [/^\/customers\/(\d+)$/, customers, 'detail'],
  [/^\/reservations$/, reservations, 'list'],
  [/^\/reservations\/(\d+)$/, reservations, 'detail'],
  [/^\/rentals$/, rentals, 'list'],
  [/^\/rentals\/(\d+)$/, rentals, 'detail'],
  [/^\/rentals\/(\d+)\/contract$/, rentals, 'contract'],
  [/^\/booking$/, booking],
  [/^\/calendar$/, calendar],
  [/^\/maintenance$/, maintenance],
  [/^\/payments$/, finance, 'payments'],
  [/^\/expenses$/, finance, 'expenses'],
  [/^\/reports$/, reports],
  [/^\/settings$/, settings],
];

function renderLogin(message) {
  setView(
    app,
    html`<div class="login-wrap"><div class="card login">
      <h1>🚗 Rent A Car</h1>
      <div class="text-2">Kiralama yönetim paneline giriş yapın</div>
      <form id="login-form">
        <div id="login-err">${message ? html`<div class="alert danger">${message}</div>` : ''}</div>
        <label class="field">Kullanıcı adı<input name="username" autocomplete="username" required /></label>
        <label class="field">Şifre<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="primary" type="submit">Giriş yap</button>
      </form>
    </div></div>`,
  );
  const form = document.getElementById('login-form');
  form.username.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/auth/login', { username: form.username.value, password: form.password.value });
      await start();
    } catch (err) {
      document.getElementById('login-err').innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
    }
  });
}

function renderShell() {
  setView(
    app,
    html`<div class="topbar"><button id="menu-btn" aria-label="Menü">☰</button><strong>${state.settings.company_name}</strong></div>
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="logo">🚗</span><span>${state.settings.company_name || 'Rent A Car'}</span></div>
        <nav class="nav">${NAV.map((n) =>
          n.length === 1 ? html`<div class="group">${n[0]}</div>` : html`<a href="${n[0]}"><span class="ico">${n[1]}</span>${n[2]}</a>`,
        )}</nav>
        <div class="user">
          <div><strong>${state.user.full_name}</strong></div>
          <div class="muted small">${LABELS.role[state.user.role]} · ${state.user.username}</div>
          <button id="logout-btn" class="sm">Çıkış yap</button>
        </div>
      </aside>
      <main class="main" id="view"></main>
    </div>`,
  );
  document.getElementById('logout-btn').onclick = async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    state.user = null;
    renderLogin();
  };
  document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
}

let renderSeq = 0;
async function route() {
  if (!state.user) return;
  const hash = location.hash.slice(1) || '/dashboard';
  const [path, query] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  const view = document.getElementById('view');
  if (!view) return;
  document.getElementById('sidebar').classList.remove('open');
  for (const a of document.querySelectorAll('.nav a')) {
    const base = a.getAttribute('href').slice(1);
    a.classList.toggle('active', path === base || path.startsWith(base + '/'));
  }
  const seq = ++renderSeq;
  for (const [re, mod, name] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    view.innerHTML = '<div class="muted">Yükleniyor…</div>';
    try {
      const fn = name ? mod[name] : mod.render;
      await fn(view, { id: m[1], query: params, isCurrent: () => seq === renderSeq });
    } catch (err) {
      if (seq === renderSeq) view.innerHTML = `<div class="alert danger">${esc(err.message)}</div>`;
    }
    window.scrollTo(0, 0);
    return;
  }
  location.hash = '#/dashboard';
}

async function start() {
  try {
    state.user = await api('GET', '/api/auth/me');
  } catch {
    return renderLogin();
  }
  await loadLookups();
  document.title = `${state.settings.company_name} · Yönetim`;
  renderShell();
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('unauthorized', () => {
  if (state.user) {
    state.user = null;
    toast('Oturumunuz sona erdi, lütfen tekrar giriş yapın', 'error');
    renderLogin();
  }
});
window.addEventListener('refresh-view', route);

start();
