// ---------- Şablon & kaçış ----------
class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s ?? ''));

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function val(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += val(vals[i]);
  });
  return new Raw(out);
}

// ---------- Durum ----------
export const state = { user: null, branches: [], extras: [], settings: {}, meta: {}, expenseCategories: [] };

export async function loadLookups() {
  const [branches, extras, settings, meta, expenseCategories] = await Promise.all([
    api('GET', '/api/branches'),
    api('GET', '/api/extras'),
    api('GET', '/api/settings'),
    api('GET', '/api/meta'),
    api('GET', '/api/expense-categories'),
  ]);
  Object.assign(state, { branches, extras, settings, meta, expenseCategories });
}

// ---------- API ----------
export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* boş yanıt */
  }
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/login')) window.dispatchEvent(new Event('unauthorized'));
    throw new ApiError(data?.error || `İstek başarısız (${res.status})`, res.status, data?.details);
  }
  return data;
}

export const qs = (obj) =>
  new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// ---------- Biçimlendirme ----------
const moneyFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
export const money = (n) => moneyFmt.format(Number(n) || 0);
export const numf = (n) => new Intl.NumberFormat('tr-TR').format(Number(n) || 0);

export function dt(s) {
  if (!s) return '—';
  const [d, t] = String(s).split(/[T ]/);
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}${t ? ' ' + t.slice(0, 5) : ''}`;
}
export const d = (s) => (s ? dt(String(s).slice(0, 10)) : '—');

const pad = (n) => String(n).padStart(2, '0');
export function localInput(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export const todayStr = () => localInput().slice(0, 10);
export function addDaysStr(n, hour) {
  const x = new Date();
  x.setDate(x.getDate() + n);
  if (hour !== undefined) x.setHours(hour, 0, 0, 0);
  return localInput(x);
}

export const FUEL = (n) => (n === null || n === undefined ? '—' : `${n}/8`);

// ---------- Etiketler ----------
export const LABELS = {
  vehicleStatus: {
    available: ['Müsait', 'ok'], rented: ['Kirada', 'info'], maintenance: ['Bakımda', 'warn'], out_of_service: ['Hizmet dışı', 'danger'],
  },
  reservationStatus: {
    pending: ['Beklemede', 'warn'], confirmed: ['Onaylı', 'info'], cancelled: ['İptal', 'danger'], no_show: ['Gelmedi', 'danger'], converted: ['Teslim edildi', 'ok'],
  },
  rentalStatus: { active: ['Aktif', 'info'], completed: ['Tamamlandı', 'ok'], cancelled: ['İptal', 'danger'], overdue: ['Gecikmiş', 'danger'] },
  maintenanceStatus: { scheduled: ['Planlandı', 'violet'], in_progress: ['Devam ediyor', 'warn'], completed: ['Tamamlandı', 'ok'], cancelled: ['İptal', ''] },
  maintenanceType: { periodic: 'Periyodik bakım', repair: 'Onarım', tire: 'Lastik', inspection: 'Muayene', damage_repair: 'Hasar onarımı', other: 'Diğer' },
  damageStatus: { open: ['Açık', 'danger'], repaired: ['Onarıldı', 'ok'], closed: ['Kapatıldı', ''] },
  severity: { minor: ['Hafif', ''], moderate: ['Orta', 'warn'], major: ['Ağır', 'danger'] },
  paymentType: { payment: ['Tahsilat', 'ok'], refund: ['İade', 'danger'], deposit_in: ['Depozito alındı', 'violet'], deposit_out: ['Depozito iade', ''] },
  method: { cash: 'Nakit', credit_card: 'Kredi kartı', bank_transfer: 'Havale/EFT', deposit: 'Depozitodan' },
  chargeType: {
    late_return: 'Geç iade', extra_km: 'Km aşımı', fuel: 'Yakıt', damage: 'Hasar', cleaning: 'Temizlik', traffic_fine: 'Trafik cezası', hgs: 'HGS/OGS', other: 'Diğer',
  },
  role: { admin: 'Yönetici', staff: 'Personel' },
};

export function badge(map, key) {
  const v = LABELS[map][key];
  if (!v) return html`<span class="badge">${key}</span>`;
  const [text, cls] = Array.isArray(v) ? v : [v, ''];
  return html`<span class="badge ${cls}">${text}</span>`;
}

export const options = (list, selected, { empty } = {}) =>
  html`${empty !== undefined ? html`<option value="">${empty}</option>` : ''}${list.map((o) => {
    const [value, label] = Array.isArray(o) ? o : [o, o];
    return html`<option value="${value}" ${String(value) === String(selected ?? '') ? raw('selected') : ''}>${label}</option>`;
  })}`;

export const mapOptions = (map) => Object.entries(map).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);

export const fuelOptions = (sel = 8) =>
  options(
    Array.from({ length: 9 }, (_, i) => [8 - i, `${8 - i}/8${8 - i === 8 ? ' (Dolu)' : 8 - i === 0 ? ' (Boş)' : ''}`]),
    sel,
  );

export const branchOptions = (sel, empty = 'Seçiniz') =>
  options(state.branches.filter((b) => b.active || String(b.id) === String(sel)).map((b) => [b.id, b.name]), sel, { empty });

// ---------- Form ----------
export function field(label, input, cls = '') {
  return html`<label class="field ${cls}">${label}${input}</label>`;
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else out[el.name] = el.value;
  }
  return out;
}

// ---------- Toast ----------
export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3000);
}

export function errorHtml(err) {
  const details = Array.isArray(err.details) ? err.details : [];
  return html`<div class="alert danger">${err.message}${details.length > 1 || (details[0] && details[0].message)
    ? html`<ul>${details.map((x) => html`<li>${x.message || x}</li>`)}</ul>`
    : ''}</div>`;
}

// ---------- Modal ----------
/**
 * openModal({ title, body, submitLabel, onSubmit(data, form, modal), onOpen(modalEl), wide, footer })
 * onSubmit bir değer döndürürse (veya hata fırlatmazsa) modal kapanır.
 */
export function openModal({ title, body, submitLabel = 'Kaydet', onSubmit, onOpen, wide = false, submitClass = 'primary', cancelLabel = 'Vazgeç', onClose }) {
  const root = document.getElementById('modal-root');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = html`
    <form class="modal ${wide ? 'wide' : ''}" novalidate>
      <div class="modal-head"><h2>${title}</h2><button type="button" class="x" data-close aria-label="Kapat">×</button></div>
      <div class="modal-body"><div class="modal-error"></div>${body}</div>
      <div class="modal-foot">
        <button type="button" data-close>${onSubmit ? cancelLabel : 'Kapat'}</button>
        ${onSubmit ? html`<button type="submit" class="${submitClass}">${submitLabel}</button>` : ''}
      </div>
    </form>`.s;
  root.appendChild(bg);
  const form = bg.querySelector('form');
  const close = () => {
    bg.remove();
    if (onClose) onClose();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close();
  });
  const modal = { el: bg, form, close, setError: (err) => (bg.querySelector('.modal-error').innerHTML = err ? errorHtml(err).s : '') };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    modal.setError(null);
    try {
      const r = await onSubmit(formData(form), form, modal);
      if (r !== false) close();
    } catch (err) {
      modal.setError(err);
      bg.querySelector('.modal-body').scrollTop = 0;
      bg.scrollTop = 0;
    } finally {
      btn.disabled = false;
    }
  });
  if (onOpen) onOpen(bg, modal);
  const first = form.querySelector('input:not([type=hidden]),select,textarea');
  if (first) first.focus();
  return modal;
}

export function confirmDialog(message, { title = 'Onay', okLabel = 'Evet', input } = {}) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title,
      body: html`<p>${message}</p>${input ? field(input, html`<input name="text" />`) : ''}`,
      submitLabel: okLabel,
      onSubmit: (data) => {
        result = input ? data.text || '' : true;
      },
      onClose: () => resolve(result),
    });
  });
}

// ---------- Sayfa yardımcıları ----------
export function setView(el, content) {
  el.innerHTML = typeof content === 'string' ? content : val(content);
}

export function table(headers, rows, { empty = 'Kayıt bulunamadı', onRowClick } = {}) {
  return html`<div class="table-wrap"><table>
    <thead><tr>${headers.map((h) => (Array.isArray(h) ? html`<th class="${h[1]}">${h[0]}</th>` : html`<th>${h}</th>`))}</tr></thead>
    <tbody>${rows.length ? rows : html`<tr><td colspan="${headers.length}" class="empty">${empty}</td></tr>`}</tbody>
  </table></div>`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const isAdmin = () => state.user?.role === 'admin';

export function customerName(c) {
  if (!c) return '';
  return c.type === 'corporate' && c.company_name ? `${c.company_name} (${c.first_name} ${c.last_name})` : `${c.first_name} ${c.last_name}`;
}
