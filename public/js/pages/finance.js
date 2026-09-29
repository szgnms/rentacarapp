import {
  api, html, setView, money, d, dt, table, badge, options, mapOptions, LABELS, field, openModal, toast, confirmDialog,
  qs, debounce, isAdmin, state, todayStr,
} from '../core.js';

const monthStart = () => todayStr().slice(0, 8) + '01';

export async function payments(el, { query }) {
  const f = { from: query.from || monthStart(), to: query.to || todayStr(), type: query.type || '', method: query.method || '' };
  setView(
    el,
    html`<div class="page-head"><div><h1>Ödemeler</h1><div class="sub">Tahsilat, iade ve depozito hareketleri</div></div></div>
    <div class="filters">
      <input type="date" name="from" value="${f.from}" /><input type="date" name="to" value="${f.to}" />
      <select name="type">${options(mapOptions(LABELS.paymentType), f.type, { empty: 'Tüm işlemler' })}</select>
      <select name="method">${options(Object.entries(LABELS.method), f.method, { empty: 'Tüm yöntemler' })}</select>
    </div>
    <div class="grid grid-4 mb" id="totals"></div>
    <div class="card" id="list"></div>`,
  );
  const load = async () => {
    const rows = await api('GET', '/api/payments?' + qs(f));
    const sum = (t) => rows.filter((p) => p.type === t).reduce((a, p) => a + p.amount, 0);
    setView(
      el.querySelector('#totals'),
      html`${[['Tahsilat', sum('payment')], ['İade', sum('refund')], ['Net', sum('payment') - sum('refund')], ['Depozito (alınan − iade)', sum('deposit_in') - sum('deposit_out')]].map(
        ([l, v]) => html`<div class="card stat"><div class="label">${l}</div><div class="value">${money(v)}</div></div>`,
      )}`,
    );
    setView(
      el.querySelector('#list'),
      table(
        ['Tarih', 'Müşteri', 'Bağlı kayıt', 'İşlem', 'Yöntem', 'Açıklama', 'Kaydeden', ['Tutar', 'num'], ''],
        rows.map(
          (p) => html`<tr><td class="nowrap">${dt(p.paid_at)}</td><td><a href="#/customers/${p.customer_id}">${p.customer_name}</a></td>
            <td>${p.contract_no ? html`<a href="#/rentals/${p.rental_id}">${p.contract_no}</a>` : p.reservation_code ? html`<a href="#/reservations/${p.reservation_id}">${p.reservation_code}</a>` : '—'}</td>
            <td>${badge('paymentType', p.type)}</td><td>${LABELS.method[p.method]}</td><td>${p.description}</td><td class="small">${p.created_by_name}</td>
            <td class="num">${money(p.amount)}</td><td>${isAdmin() ? html`<button class="sm" data-del="${p.id}">Sil</button>` : ''}</td></tr>`,
        ),
      ),
    );
    el.querySelectorAll('[data-del]').forEach(
      (b) =>
        (b.onclick = async () => {
          if (!(await confirmDialog('Ödeme kaydı silinsin mi?', { okLabel: 'Sil' }))) return;
          await api('DELETE', `/api/payments/${b.dataset.del}`);
          toast('Silindi');
          load();
        }),
    );
  };
  const onChange = debounce(() => {
    for (const k of Object.keys(f)) f[k] = el.querySelector(`[name=${k}]`).value;
    history.replaceState(null, '', '#/payments?' + qs(f));
    load();
  }, 250);
  el.querySelectorAll('.filters [name]').forEach((i) => i.addEventListener('input', onChange));
  await load();
}

export async function expenseModal(e, defaults, onDone) {
  const x = e || { category: 'Diğer', expense_date: todayStr(), ...defaults };
  const vs = await api('GET', '/api/vehicles');
  openModal({
    title: e ? 'Masraf düzenle' : 'Yeni masraf',
    body: html`<div class="form-grid">
      ${field('Kategori', html`<select name="category">${options(state.expenseCategories, x.category)}</select>`)}
      ${field('Tarih', html`<input type="date" name="expense_date" value="${x.expense_date}" />`)}
      ${field('Tutar (₺) *', html`<input type="number" step="0.01" name="amount" value="${x.amount}" required />`)}
      ${field('Araç (opsiyonel)', html`<select name="vehicle_id">${options(vs.map((v) => [v.id, `${v.plate} · ${v.brand} ${v.model}`]), x.vehicle_id, { empty: 'Genel gider' })}</select>`)}
      ${field('Açıklama', html`<input name="description" value="${x.description}" />`, 'c12')}
    </div>`,
    onSubmit: async (data) => {
      if (e) await api('PUT', `/api/expenses/${e.id}`, data);
      else await api('POST', '/api/expenses', data);
      toast('Masraf kaydedildi');
      onDone();
    },
  });
}

export async function expenses(el, { query }) {
  const f = { from: query.from || monthStart(), to: query.to || todayStr(), category: query.category || '' };
  setView(
    el,
    html`<div class="page-head"><div><h1>Masraflar</h1><div class="sub">Genel ve araç bazlı giderler</div></div>
      <div class="actions"><button class="primary" id="add">+ Masraf</button></div></div>
    <div class="filters">
      <input type="date" name="from" value="${f.from}" /><input type="date" name="to" value="${f.to}" />
      <select name="category">${options(state.expenseCategories, f.category, { empty: 'Tüm kategoriler' })}</select>
    </div>
    <div class="card" id="list"></div>`,
  );
  const load = async () => {
    const rows = await api('GET', '/api/expenses?' + qs(f));
    const total = rows.reduce((a, x) => a + x.amount, 0);
    setView(
      el.querySelector('#list'),
      html`${table(
        ['Tarih', 'Kategori', 'Araç', 'Açıklama', ['Tutar', 'num'], ''],
        rows.map(
          (x) => html`<tr class="click" data-id="${x.id}"><td>${d(x.expense_date)}</td><td>${x.category}</td><td>${x.plate || html`<span class="muted">Genel</span>`}</td>
            <td>${x.description}</td><td class="num">${money(x.amount)}</td><td class="right">${isAdmin() ? html`<button class="sm" data-del="${x.id}">Sil</button>` : ''}</td></tr>`,
        ),
      )}<div class="card-body right"><strong>Toplam: ${money(total)}</strong></div>`,
    );
    el.querySelectorAll('tr[data-id]').forEach(
      (tr) =>
        (tr.onclick = (ev) => {
          if (ev.target.closest('button')) return;
          expenseModal(rows.find((x) => x.id == tr.dataset.id), {}, load);
        }),
    );
    el.querySelectorAll('[data-del]').forEach(
      (b) =>
        (b.onclick = async () => {
          if (!(await confirmDialog('Masraf silinsin mi?', { okLabel: 'Sil' }))) return;
          await api('DELETE', `/api/expenses/${b.dataset.del}`);
          toast('Silindi');
          load();
        }),
    );
  };
  el.querySelector('#add').onclick = () => expenseModal(null, {}, load);
  const onChange = debounce(() => {
    for (const k of Object.keys(f)) f[k] = el.querySelector(`[name=${k}]`).value;
    history.replaceState(null, '', '#/expenses?' + qs(f));
    load();
  }, 250);
  el.querySelectorAll('.filters [name]').forEach((i) => i.addEventListener('input', onChange));
  await load();
}
