import {
  api, html, raw, setView, money, numf, d, dt, table, badge, options, mapOptions, LABELS, state, field, openModal,
  toast, confirmDialog, qs, debounce, isAdmin, branchOptions, todayStr,
} from '../core.js';
import { maintenanceModal, damageModal } from './maintenance.js';
import { expenseModal } from './finance.js';

export async function list(el, { query }) {
  const f = { q: query.q || '', status: query.status || '', category: query.category || '', branch_id: query.branch_id || '' };
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Araçlar</h1><div class="sub">Filo envanteri</div></div>
      <div class="actions"><button class="primary" id="add">+ Araç ekle</button></div>
    </div>
    <div class="filters">
      <input type="search" name="q" placeholder="Plaka, marka, model ara…" value="${f.q}" />
      <select name="status">${options(mapOptions(LABELS.vehicleStatus), f.status, { empty: 'Tüm durumlar' })}</select>
      <select name="category">${options(state.meta.categories, f.category, { empty: 'Tüm kategoriler' })}</select>
      <select name="branch_id">${branchOptions(f.branch_id, 'Tüm şubeler')}</select>
    </div>
    <div class="card" id="list"></div>`,
  );
  const load = async () => {
    const rows = await api('GET', '/api/vehicles?' + qs(f));
    setView(
      el.querySelector('#list'),
      table(
        ['Plaka', 'Araç', 'Kategori', 'Yakıt / Vites', ['Km', 'num'], ['Günlük', 'num'], 'Şube', 'Durum'],
        rows.map(
          (v) => html`<tr class="click" onclick="location.hash='#/vehicles/${v.id}'">
            <td><strong>${v.plate}</strong></td>
            <td>${v.brand} ${v.model}<div class="muted small">${v.year || ''} ${v.color || ''}</div></td>
            <td>${v.category}</td><td>${v.fuel_type} / ${v.transmission}</td>
            <td class="num">${numf(v.current_km)}</td><td class="num">${money(v.daily_rate)}</td>
            <td>${v.branch_name || '—'}</td>
            <td>${badge('vehicleStatus', v.status)}${v.active_contract ? html`<div class="muted small">${v.active_contract} · ${dt(v.active_return_at)}</div>` : ''}</td>
          </tr>`,
        ),
      ),
    );
  };
  const onChange = debounce(() => {
    for (const k of Object.keys(f)) f[k] = el.querySelector(`[name=${k}]`).value;
    history.replaceState(null, '', '#/vehicles?' + qs(f));
    load();
  }, 250);
  el.querySelectorAll('.filters [name]').forEach((i) => i.addEventListener('input', onChange));
  el.querySelector('#add').onclick = () => vehicleModal(null, (v) => (location.hash = `#/vehicles/${v.id}`));
  await load();
}

export function vehicleModal(v, onDone) {
  const x = v || { category: 'Ekonomi', fuel_type: 'Benzin', transmission: 'Manuel', seats: 5, km_limit_per_day: 0, current_km: 0, branch_id: state.branches[0]?.id };
  openModal({
    title: v ? `${v.plate} düzenle` : 'Yeni araç',
    wide: true,
    body: html`<div class="form-grid">
      ${field('Plaka *', html`<input name="plate" value="${x.plate}" required />`, 'c4')}
      ${field('Marka *', html`<input name="brand" value="${x.brand}" required />`, 'c4')}
      ${field('Model *', html`<input name="model" value="${x.model}" required />`, 'c4')}
      ${field('Model yılı', html`<input name="year" type="number" value="${x.year}" />`, 'c3')}
      ${field('Kategori', html`<select name="category">${options(state.meta.categories, x.category)}</select>`, 'c3')}
      ${field('Yakıt', html`<select name="fuel_type">${options(state.meta.fuel_types, x.fuel_type)}</select>`, 'c3')}
      ${field('Vites', html`<select name="transmission">${options(state.meta.transmissions, x.transmission)}</select>`, 'c3')}
      ${field('Koltuk', html`<input name="seats" type="number" value="${x.seats}" />`, 'c3')}
      ${field('Renk', html`<input name="color" value="${x.color}" />`, 'c3')}
      ${field('Şasi no', html`<input name="vin" value="${x.vin}" />`, 'c3')}
      ${field('Şube', html`<select name="branch_id">${branchOptions(x.branch_id)}</select>`, 'c3')}
      <div class="form-section">Fiyat & kullanım</div>
      ${field('Günlük fiyat (₺) *', html`<input name="daily_rate" type="number" step="0.01" value="${x.daily_rate}" required />`, 'c3')}
      ${field('Depozito (₺)', html`<input name="deposit_amount" type="number" step="0.01" value="${x.deposit_amount}" />`, 'c3')}
      ${field('Günlük km limiti (0 = sınırsız)', html`<input name="km_limit_per_day" type="number" value="${x.km_limit_per_day}" />`, 'c3')}
      ${field('Km aşım ücreti (₺/km)', html`<input name="extra_km_fee" type="number" step="0.01" value="${x.extra_km_fee}" />`, 'c3')}
      ${field('Güncel km', html`<input name="current_km" type="number" value="${x.current_km}" />`, 'c3')}
      ${field('Sonraki bakım km', html`<input name="next_service_km" type="number" value="${x.next_service_km}" />`, 'c3')}
      <div class="form-section">Belgeler</div>
      ${field('Trafik sigortası bitiş', html`<input name="insurance_expiry" type="date" value="${x.insurance_expiry}" />`, 'c4')}
      ${field('Kasko bitiş', html`<input name="kasko_expiry" type="date" value="${x.kasko_expiry}" />`, 'c4')}
      ${field('Muayene bitiş', html`<input name="inspection_expiry" type="date" value="${x.inspection_expiry}" />`, 'c4')}
      ${field('Notlar', html`<textarea name="notes">${x.notes}</textarea>`, 'c12')}
    </div>`,
    onSubmit: async (data) => {
      const saved = v ? await api('PUT', `/api/vehicles/${v.id}`, data) : await api('POST', '/api/vehicles', data);
      toast('Araç kaydedildi');
      onDone(saved);
    },
  });
}

export async function detail(el, { id, query }) {
  const v = await api('GET', `/api/vehicles/${id}`);
  const tab = query.tab || 'rentals';
  const reload = () => detail(el, { id, query: { tab: el.querySelector('.tabs .active')?.dataset.tab } });
  const tabs = [
    ['rentals', `Kiralamalar (${v.rentals.length})`],
    ['reservations', `Rezervasyonlar (${v.reservations.length})`],
    ['maintenance', `Bakım (${v.maintenance.length})`],
    ['damages', `Hasar (${v.damages.length})`],
    ['expenses', `Masraflar (${v.expenses.length})`],
  ];
  setView(
    el,
    html`<div class="page-head">
      <div><h1>${v.plate} ${badge('vehicleStatus', v.status)}</h1><div class="sub">${v.brand} ${v.model} · ${v.year || ''} · ${v.category}</div></div>
      <div class="actions">
        ${v.status === 'available' ? html`<a class="btn primary" href="#/booking?vehicle_id=${v.id}">Kirala / Rezerve et</a>` : ''}
        <button id="edit">Düzenle</button>
        ${v.status === 'available' ? html`<button id="oos">Hizmet dışı yap</button>` : ''}
        ${v.status === 'out_of_service' ? html`<button id="ins">Hizmete al</button>` : ''}
        ${isAdmin() ? html`<button class="danger" id="del">Sil</button>` : ''}
      </div>
    </div>
    <div class="grid grid-4 mb">
      ${stat('Toplam ciro', money(v.stats.revenue))}
      ${stat('Kiralanan gün', numf(v.stats.rented_days))}
      ${stat('Bakım + masraf', money(v.stats.costs))}
      ${stat('Net katkı', money(v.stats.profit))}
    </div>
    <div class="grid grid-2 mb">
      <div class="card"><div class="card-head"><h2>Araç bilgileri</h2></div><div class="card-body"><dl class="kv">
        <dt>Yakıt / Vites</dt><dd>${v.fuel_type} / ${v.transmission}</dd>
        <dt>Koltuk / Renk</dt><dd>${v.seats} / ${v.color || '—'}</dd>
        <dt>Şasi no</dt><dd>${v.vin || '—'}</dd>
        <dt>Şube</dt><dd>${v.branch_name || '—'}</dd>
        <dt>Güncel km</dt><dd>${numf(v.current_km)} km</dd>
        <dt>Sonraki bakım</dt><dd>${v.next_service_km ? numf(v.next_service_km) + ' km' : '—'}</dd>
        ${v.active_contract ? html`<dt>Aktif sözleşme</dt><dd>${v.active_contract} (dönüş ${dt(v.active_return_at)})</dd>` : ''}
        ${v.notes ? html`<dt>Notlar</dt><dd>${v.notes}</dd>` : ''}
      </dl></div></div>
      <div class="card"><div class="card-head"><h2>Fiyat & belgeler</h2></div><div class="card-body"><dl class="kv">
        <dt>Günlük fiyat</dt><dd>${money(v.daily_rate)}</dd>
        <dt>Depozito</dt><dd>${money(v.deposit_amount)}</dd>
        <dt>Km limiti</dt><dd>${v.km_limit_per_day ? `${v.km_limit_per_day} km/gün, aşım ${money(v.extra_km_fee)}/km` : 'Sınırsız'}</dd>
        <dt>Trafik sigortası</dt><dd>${expiry(v.insurance_expiry)}</dd>
        <dt>Kasko</dt><dd>${expiry(v.kasko_expiry)}</dd>
        <dt>Muayene</dt><dd>${expiry(v.inspection_expiry)}</dd>
      </dl></div></div>
    </div>
    <div class="card"><div class="card-body">
      <div class="tabs">${tabs.map(([k, l]) => html`<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`)}</div>
      <div id="tab"></div>
    </div></div>`,
  );

  const panels = {
    rentals: () =>
      table(
        ['Sözleşme', 'Müşteri', 'Teslim', 'Dönüş', ['Km', 'num'], ['Tutar', 'num'], 'Durum'],
        v.rentals.map(
          (r) => html`<tr class="click" onclick="location.hash='#/rentals/${r.id}'"><td>${r.contract_no}</td><td>${r.customer_name}</td>
            <td>${dt(r.pickup_at)}</td><td>${dt(r.actual_return_at || r.planned_return_at)}</td>
            <td class="num">${r.end_km ? numf(r.end_km - r.start_km) : '—'}</td><td class="num">${money(r.total_amount)}</td>
            <td>${badge('rentalStatus', r.status)}</td></tr>`,
        ),
      ),
    reservations: () =>
      table(
        ['Kod', 'Müşteri', 'Alış', 'Dönüş', ['Tutar', 'num'], 'Durum'],
        v.reservations.map(
          (r) => html`<tr class="click" onclick="location.hash='#/reservations/${r.id}'"><td>${r.code}</td><td>${r.customer_name}</td>
            <td>${dt(r.pickup_at)}</td><td>${dt(r.return_at)}</td><td class="num">${money(r.total_amount)}</td><td>${badge('reservationStatus', r.status)}</td></tr>`,
        ),
      ),
    maintenance: () =>
      html`<div class="actions mb"><button class="sm primary" data-act="maint">+ Bakım kaydı</button></div>${table(
        ['Tarih', 'Tip', 'Açıklama', 'Servis', ['Km', 'num'], ['Maliyet', 'num'], 'Durum'],
        v.maintenance.map(
          (m) => html`<tr class="click" data-maint="${m.id}"><td class="nowrap">${d(m.start_date)}${m.end_date && m.end_date !== m.start_date ? html` → ${d(m.end_date)}` : ''}</td>
            <td>${LABELS.maintenanceType[m.type]}</td><td>${m.description}</td><td>${m.vendor}</td><td class="num">${m.km ? numf(m.km) : ''}</td>
            <td class="num">${money(m.cost)}</td><td>${badge('maintenanceStatus', m.status)}</td></tr>`,
        ),
      )}`,
    damages: () =>
      html`<div class="actions mb"><button class="sm primary" data-act="damage">+ Hasar kaydı</button></div>${table(
        ['Tarih', 'Konum', 'Açıklama', 'Önem', ['Onarım', 'num'], ['Müşteriye', 'num'], 'Durum'],
        v.damages.map(
          (x) => html`<tr class="click" data-damage="${x.id}"><td>${d(x.reported_at)}</td><td>${x.location}</td><td>${x.description}</td>
            <td>${badge('severity', x.severity)}</td><td class="num">${money(x.repair_cost)}</td><td class="num">${money(x.customer_charge)}</td>
            <td>${badge('damageStatus', x.status)}</td></tr>`,
        ),
      )}`,
    expenses: () =>
      html`<div class="actions mb"><button class="sm primary" data-act="expense">+ Masraf</button></div>${table(
        ['Tarih', 'Kategori', 'Açıklama', ['Tutar', 'num']],
        v.expenses.map(
          (x) => html`<tr class="click" data-expense="${x.id}"><td>${d(x.expense_date)}</td><td>${x.category}</td><td>${x.description}</td><td class="num">${money(x.amount)}</td></tr>`,
        ),
      )}`,
  };
  const showTab = (k) => {
    el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === k));
    const t = el.querySelector('#tab');
    setView(t, panels[k]());
    t.querySelector('[data-act=maint]')?.addEventListener('click', () => maintenanceModal(null, { vehicle_id: v.id, km: v.current_km }, reload));
    t.querySelector('[data-act=damage]')?.addEventListener('click', () => damageModal(null, { vehicle_id: v.id }, reload));
    t.querySelector('[data-act=expense]')?.addEventListener('click', () => expenseModal(null, { vehicle_id: v.id, expense_date: todayStr() }, reload));
    t.querySelectorAll('[data-maint]').forEach((r) => (r.onclick = () => maintenanceModal(v.maintenance.find((m) => m.id == r.dataset.maint), {}, reload)));
    t.querySelectorAll('[data-damage]').forEach((r) => (r.onclick = () => damageModal(v.damages.find((m) => m.id == r.dataset.damage), {}, reload)));
    t.querySelectorAll('[data-expense]').forEach((r) => (r.onclick = () => expenseModal(v.expenses.find((m) => m.id == r.dataset.expense), {}, reload)));
  };
  el.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab(tab);

  el.querySelector('#edit').onclick = () => vehicleModal(v, reload);
  const setStatus = async (status) => {
    await api('PUT', `/api/vehicles/${v.id}`, { status });
    toast('Durum güncellendi');
    reload();
  };
  el.querySelector('#oos')?.addEventListener('click', () => setStatus('out_of_service'));
  el.querySelector('#ins')?.addEventListener('click', () => setStatus('available'));
  el.querySelector('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`${v.plate} plakalı araç silinsin mi?`, { okLabel: 'Sil' }))) return;
    try {
      await api('DELETE', `/api/vehicles/${v.id}`);
      toast('Araç silindi');
      location.hash = '#/vehicles';
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function stat(label, value) {
  return html`<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function expiry(date) {
  if (!date) return raw('<span class="muted">—</span>');
  const t = todayStr();
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const s = soon.toISOString().slice(0, 10);
  if (date < t) return html`<span class="danger-text">${d(date)} (süresi doldu)</span>`;
  if (date <= s) return html`<span class="badge warn">${d(date)}</span>`;
  return d(date);
}
