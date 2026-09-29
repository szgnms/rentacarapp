import {
  api, html, setView, money, numf, dt, d, table, badge, options, LABELS, field, openModal, toast, confirmDialog,
  qs, debounce, fuelOptions, localInput, customerName, errorHtml, isAdmin, branchOptions, state, FUEL, mapOptions,
} from '../core.js';

const METHODS = [['credit_card', 'Kredi kartı'], ['cash', 'Nakit'], ['bank_transfer', 'Havale/EFT']];

export async function list(el, { query }) {
  const f = { q: query.q || '', status: query.status || 'active', from: query.from || '', to: query.to || '' };
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Kiralamalar</h1><div class="sub">Kira sözleşmeleri, teslim ve iade işlemleri</div></div>
      <div class="actions"><a class="btn primary" href="#/booking?mode=rental">+ Kapıdan kiralama</a></div>
    </div>
    <div class="filters">
      <input type="search" name="q" placeholder="Sözleşme no, müşteri, plaka ara…" value="${f.q}" />
      <select name="status">${options([['active', 'Aktif'], ['overdue', 'Gecikmiş'], ['completed', 'Tamamlandı'], ['cancelled', 'İptal']], f.status, { empty: 'Tümü' })}</select>
      <input type="date" name="from" value="${f.from}" title="Teslim tarihi (başlangıç)" />
      <input type="date" name="to" value="${f.to}" title="Teslim tarihi (bitiş)" />
    </div>
    <div class="card" id="list"></div>`,
  );
  const load = async () => {
    const rows = await api('GET', '/api/rentals?' + qs(f));
    setView(
      el.querySelector('#list'),
      table(
        ['Sözleşme', 'Müşteri', 'Araç', 'Teslim', 'Dönüş', ['Tutar', 'num'], ['Bakiye', 'num'], 'Durum'],
        rows.map(
          (r) => html`<tr class="click" onclick="location.hash='#/rentals/${r.id}'">
            <td><strong>${r.contract_no}</strong></td><td>${r.customer_name}<div class="muted small">${r.customer_phone}</div></td>
            <td>${r.plate}<div class="muted small">${r.brand} ${r.model}</div></td>
            <td class="nowrap">${dt(r.pickup_at)}</td>
            <td class="nowrap">${dt(r.actual_return_at || r.planned_return_at)}</td>
            <td class="num">${money(r.total_amount)}</td>
            <td class="num ${r.balance > 0.009 ? 'danger-text' : ''}">${money(r.balance)}</td>
            <td>${r.overdue ? badge('rentalStatus', 'overdue') : badge('rentalStatus', r.status)}</td></tr>`,
        ),
      ),
    );
  };
  const onChange = debounce(() => {
    for (const k of Object.keys(f)) f[k] = el.querySelector(`[name=${k}]`).value;
    history.replaceState(null, '', '#/rentals?' + qs(f));
    load();
  }, 250);
  el.querySelectorAll('.filters [name]').forEach((i) => i.addEventListener('input', onChange));
  await load();
}

export async function detail(el, { id }) {
  const r = await api('GET', `/api/rentals/${id}`);
  const reload = () => detail(el, { id });
  const f = r.finance;
  const active = r.status === 'active';
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Sözleşme ${r.contract_no} ${r.overdue ? badge('rentalStatus', 'overdue') : badge('rentalStatus', r.status)}</h1>
        <div class="sub">${r.reservation_code ? html`Rezervasyon: <a href="#/reservations/${r.reservation_id}">${r.reservation_code}</a> · ` : ''}Oluşturma: ${dt(r.created_at)}</div></div>
      <div class="actions">
        ${active ? html`<button class="success" id="checkin">↩︎ İade al</button>` : ''}
        ${r.status !== 'cancelled' ? html`<button class="primary" id="pay">Ödeme / depozito</button>` : ''}
        ${active ? html`<button id="extend">Süre uzat</button>` : ''}
        ${r.status !== 'cancelled' ? html`<button id="charge">Ek ücret</button>` : ''}
        <a class="btn" href="#/rentals/${r.id}/contract">🖨️ Sözleşme</a>
        ${active && isAdmin() ? html`<button class="danger" id="cancel">İptal</button>` : ''}
      </div>
    </div>
    ${r.overdue ? html`<div class="alert danger">Planlanan dönüş (${dt(r.planned_return_at)}) geçti. Müşteriyle iletişime geçin: ${r.customer_phone}</div>` : ''}
    <div class="grid grid-4 mb">
      ${stat('Toplam', money(f.total))}
      ${stat('Ödenen', money(f.paid))}
      ${stat('Kalan bakiye', html`<span class="${f.balance > 0.009 ? 'danger-text' : f.balance < -0.009 ? 'ok-text' : ''}">${money(f.balance)}</span>`, f.balance < -0.009 ? 'Müşteriye iade edilecek' : '')}
      ${stat('Tutulan depozito', money(f.deposit_held), `Belirlenen: ${money(r.deposit_amount)}`)}
    </div>
    <div class="grid grid-2 mb">
      <div class="card"><div class="card-head"><h2>Sözleşme bilgileri</h2></div><div class="card-body"><dl class="kv">
        <dt>Müşteri</dt><dd><a href="#/customers/${r.customer_id}">${customerName(r.customer)}</a> · ${r.customer_phone}</dd>
        <dt>Ehliyet</dt><dd>${r.customer.license_no || '—'} (${d(r.customer.license_date)})</dd>
        ${r.additional_driver ? html`<dt>Ek sürücü</dt><dd>${r.additional_driver}</dd>` : ''}
        <dt>Araç</dt><dd><a href="#/vehicles/${r.vehicle_id}">${r.plate}</a> · ${r.brand} ${r.model}</dd>
        <dt>Teslim</dt><dd>${dt(r.pickup_at)} · ${r.pickup_branch_name || '—'}</dd>
        <dt>Planlanan dönüş</dt><dd>${dt(r.planned_return_at)} · ${r.return_branch_name || '—'}</dd>
        ${r.actual_return_at ? html`<dt>Gerçek dönüş</dt><dd>${dt(r.actual_return_at)}</dd>` : ''}
        <dt>Km</dt><dd>${numf(r.start_km)}${r.end_km !== null ? html` → ${numf(r.end_km)} <span class="muted">(${numf(r.end_km - r.start_km)} km)</span>` : ''}</dd>
        <dt>Yakıt</dt><dd>${FUEL(r.start_fuel)}${r.end_fuel !== null ? ` → ${FUEL(r.end_fuel)}` : ''}</dd>
        ${r.checkout_notes ? html`<dt>Teslim notu</dt><dd>${r.checkout_notes}</dd>` : ''}
        ${r.checkin_notes ? html`<dt>İade notu</dt><dd>${r.checkin_notes}</dd>` : ''}
      </dl></div></div>
      <div class="card"><div class="card-head"><h2>Ücret dökümü</h2></div><div class="card-body">
        <div class="sum-row"><span>${r.days} gün × ${money(r.daily_rate)}</span><span>${money(r.base_amount)}</span></div>
        ${r.long_term_discount ? html`<div class="sum-row"><span>Uzun dönem indirimi</span><span>-${money(r.long_term_discount)}</span></div>` : ''}
        ${r.extras.map((x) => html`<div class="sum-row"><span>${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}</span><span>${money(x.amount)}</span></div>`)}
        ${r.one_way_fee ? html`<div class="sum-row"><span>Tek yön ücreti</span><span>${money(r.one_way_fee)}</span></div>` : ''}
        ${r.discount ? html`<div class="sum-row"><span>İndirim</span><span>-${money(r.discount)}</span></div>` : ''}
        ${r.charges.map(
          (c) => html`<div class="sum-row"><span>${LABELS.chargeType[c.type]}${c.description ? html` <span class="muted small">${c.description}</span>` : ''}
            ${isAdmin() ? html`<button class="sm x" data-del-charge="${c.id}" title="Sil">×</button>` : ''}</span><span>${money(c.amount)}</span></div>`,
        )}
        <div class="sum-row total"><span>Toplam</span><span>${money(r.total_amount)}</span></div>
      </div></div>
    </div>
    <div class="card mb"><div class="card-head"><h2>Ödeme hareketleri</h2></div>
      ${table(
        ['Tarih', 'İşlem', 'Yöntem', 'Açıklama', ['Tutar', 'num'], ''],
        r.payments.map(
          (p) => html`<tr><td>${dt(p.paid_at)}</td><td>${badge('paymentType', p.type)}</td><td>${LABELS.method[p.method]}</td><td>${p.description}</td>
            <td class="num">${money(p.amount)}</td><td class="right">${isAdmin() ? html`<button class="sm" data-del-pay="${p.id}">Sil</button>` : ''}</td></tr>`,
        ),
        { empty: 'Henüz ödeme yok' },
      )}
    </div>
    ${r.damages.length
      ? html`<div class="card"><div class="card-head"><h2>Hasarlar</h2></div>${table(
          ['Tarih', 'Konum', 'Açıklama', 'Önem', ['Müşteriye yansıyan', 'num'], 'Durum'],
          r.damages.map((x) => html`<tr><td>${d(x.reported_at)}</td><td>${x.location}</td><td>${x.description}</td><td>${badge('severity', x.severity)}</td><td class="num">${money(x.customer_charge)}</td><td>${badge('damageStatus', x.status)}</td></tr>`),
        )}</div>`
      : ''}`,
  );

  el.querySelector('#pay')?.addEventListener('click', () => paymentModal({ rental_id: r.id, suggested: f.balance, deposit_held: f.deposit_held, deposit_amount: r.deposit_amount }, reload));
  el.querySelector('#extend')?.addEventListener('click', () => extendModal(r, reload));
  el.querySelector('#charge')?.addEventListener('click', () => chargeModal(r, reload));
  el.querySelector('#checkin')?.addEventListener('click', () => checkinModal(r, reload));
  el.querySelector('#cancel')?.addEventListener('click', async () => {
    const reason = await confirmDialog('Sözleşme iptal edilsin ve araç müsait duruma alınsın mı? (Tahsilatlar ayrıca iade edilmelidir)', { okLabel: 'İptal et', input: 'İptal nedeni' });
    if (reason === null) return;
    try {
      await api('POST', `/api/rentals/${r.id}/cancel`, { reason });
      toast('Sözleşme iptal edildi');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  el.querySelectorAll('[data-del-pay]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!(await confirmDialog('Ödeme kaydı silinsin mi?', { okLabel: 'Sil' }))) return;
        await api('DELETE', `/api/payments/${b.dataset.delPay}`);
        toast('Ödeme silindi');
        reload();
      }),
  );
  el.querySelectorAll('[data-del-charge]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!(await confirmDialog('Ek ücret silinsin mi?', { okLabel: 'Sil' }))) return;
        await api('DELETE', `/api/rentals/${r.id}/charges/${b.dataset.delCharge}`);
        reload();
      }),
  );
}

function stat(label, value, hint = '') {
  return html`<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
}

/** Ödeme / iade / depozito modalı. ctx: { rental_id | reservation_id, suggested, deposit_held } */
export function paymentModal(ctx, onDone) {
  const types = ctx.rental_id
    ? [['payment', 'Tahsilat'], ['refund', 'Müşteriye iade'], ['deposit_in', 'Depozito al'], ['deposit_out', 'Depozito iade et']]
    : [['payment', 'Ön ödeme tahsilatı'], ['refund', 'Müşteriye iade']];
  const suggested = Math.max(0, Math.round((ctx.suggested || 0) * 100) / 100);
  const m = openModal({
    title: 'Ödeme işlemi',
    body: html`<div class="form-grid">
      ${field('İşlem', html`<select name="type">${options(types, 'payment')}</select>`)}
      ${field('Yöntem', html`<select name="method">${options(METHODS, 'credit_card')}</select>`)}
      ${field('Tutar (₺)', html`<input type="number" step="0.01" name="amount" value="${suggested || ''}" required />`)}
      ${field('Tarih', html`<input type="datetime-local" name="paid_at" value="${localInput()}" />`)}
      ${field('Açıklama', html`<input name="description" />`, 'c12')}
      <div class="c12 muted small" id="pay-hint">${ctx.rental_id ? `Kalan bakiye: ${money(ctx.suggested)} · Tutulan depozito: ${money(ctx.deposit_held)}` : `Kalan: ${money(ctx.suggested)}`}</div>
    </div>`,
    onSubmit: async (data) => {
      await api('POST', '/api/payments', { ...data, rental_id: ctx.rental_id, reservation_id: ctx.reservation_id });
      toast('Ödeme kaydedildi');
      onDone();
    },
  });
  const type = m.form.querySelector('[name=type]');
  const amount = m.form.querySelector('[name=amount]');
  type.onchange = () => {
    const v = type.value;
    amount.value =
      v === 'payment' ? suggested || '' : v === 'deposit_in' ? Math.max(0, (ctx.deposit_amount || 0) - (ctx.deposit_held || 0)) || '' : v === 'deposit_out' ? ctx.deposit_held || '' : ctx.suggested < 0 ? -ctx.suggested : '';
  };
}

function extendModal(r, onDone) {
  openModal({
    title: `Süre uzatma · ${r.contract_no}`,
    body: html`<div class="alert info">Mevcut dönüş: ${dt(r.planned_return_at)} · ${r.days} gün · Günlük ${money(r.daily_rate)}</div>
      <div class="form-grid">
        ${field('Yeni dönüş tarihi', html`<input type="datetime-local" name="return_at" value="${r.planned_return_at}" required />`)}
        ${field('Günlük fiyat (₺)', html`<input type="number" step="0.01" name="daily_rate" value="${r.daily_rate}" />`)}
      </div>
      <div class="muted small">Araç müsaitliği kontrol edilir; gün sayısı, ek hizmetler ve toplam tutar yeniden hesaplanır.</div>`,
    submitLabel: 'Uzat',
    onSubmit: async (data) => {
      await api('POST', `/api/rentals/${r.id}/extend`, data);
      toast('Kiralama süresi uzatıldı');
      onDone();
    },
  });
}

function chargeModal(r, onDone) {
  openModal({
    title: 'Ek ücret ekle',
    body: html`<div class="form-grid">
      ${field('Tip', html`<select name="type">${options(mapOptions(LABELS.chargeType), 'traffic_fine')}</select>`)}
      ${field('Tutar (₺)', html`<input type="number" step="0.01" name="amount" required />`)}
      ${field('Açıklama', html`<input name="description" placeholder="Örn: 12.03 tarihli hız cezası" />`, 'c12')}
    </div>`,
    onSubmit: async (data) => {
      await api('POST', `/api/rentals/${r.id}/charges`, data);
      toast('Ek ücret eklendi');
      onDone();
    },
  });
}

function checkinModal(r, onDone) {
  const dmgRow = () => html`<div class="dyn-row" data-row="damage">
    ${field('Hasar açıklaması', html`<input data-k="description" />`)}
    ${field('Konum', html`<input data-k="location" placeholder="Ön tampon" />`)}
    ${field('Önem', html`<select data-k="severity">${options(mapOptions(LABELS.severity), 'minor')}</select>`)}
    ${field('Müşteriye (₺)', html`<input type="number" step="0.01" data-k="customer_charge" />`)}
    <button type="button" class="sm" data-rm>×</button></div>`;
  const chargeRow = () => html`<div class="dyn-row" data-row="charge" style="grid-template-columns:1fr 2fr 1fr auto">
    ${field('Tip', html`<select data-k="type">${options(mapOptions(LABELS.chargeType).filter(([k]) => !['late_return', 'extra_km', 'fuel', 'damage'].includes(k)), 'cleaning')}</select>`)}
    ${field('Açıklama', html`<input data-k="description" />`)}
    ${field('Tutar (₺)', html`<input type="number" step="0.01" data-k="amount" />`)}
    <button type="button" class="sm" data-rm>×</button></div>`;

  const m = openModal({
    title: `İade al · ${r.contract_no}`,
    wide: true,
    body: html`<div class="alert info">${r.plate} · Çıkış: ${numf(r.start_km)} km, yakıt ${FUEL(r.start_fuel)} · Planlanan dönüş: ${dt(r.planned_return_at)}
        ${r.vehicle.km_limit_per_day ? ` · Km limiti ${r.vehicle.km_limit_per_day}/gün` : ''}</div>
      <div class="form-grid">
        ${field('İade zamanı', html`<input type="datetime-local" name="actual_return_at" value="${localInput()}" />`, 'c3')}
        ${field('Dönüş km *', html`<input type="number" name="end_km" min="${r.start_km}" required />`, 'c3')}
        ${field('Yakıt seviyesi', html`<select name="end_fuel">${fuelOptions(r.start_fuel)}</select>`, 'c3')}
        ${field('İade şubesi', html`<select name="return_branch_id">${branchOptions(r.return_branch_id, '—')}</select>`, 'c3')}
        <div class="c12 actions">
          <label class="check"><input type="checkbox" name="waive_late" /> Geç iade ücretini alma</label>
          <label class="check"><input type="checkbox" name="waive_km" /> Km aşımını alma</label>
          <label class="check"><input type="checkbox" name="waive_fuel" /> Yakıt farkını alma</label>
        </div>
        <div class="form-section">Hasarlar <button type="button" class="sm" id="add-dmg">+ Hasar ekle</button></div>
        <div class="c12" id="dmg-rows"></div>
        <div class="form-section">Diğer ek ücretler <button type="button" class="sm" id="add-chg">+ Ücret ekle</button></div>
        <div class="c12" id="chg-rows"></div>
        <div class="form-section">Hesap</div>
        <div class="c12" id="preview"><div class="muted">Dönüş km'sini girin, ücretler otomatik hesaplanır.</div></div>
        <div class="form-section">Tahsilat & depozito</div>
        ${field('Tahsilat (₺)', html`<input type="number" step="0.01" name="payment_amount" />`, 'c3')}
        ${field('Yöntem', html`<select name="payment_method">${options(METHODS, 'credit_card')}</select>`, 'c3')}
        ${field('Depozito', html`<select name="deposit_action">${options([['return', 'Tamamını iade et'], ['offset', 'Bakiyeye mahsup et, kalanı iade et'], ['none', 'Şimdilik tut']], 'offset')}</select>`, 'c6')}
        <label class="check c12"><input type="checkbox" name="send_to_maintenance" /> Aracı iade sonrası bakıma/onarıma al</label>
        ${field('İade notları', html`<textarea name="checkin_notes"></textarea>`, 'c12')}
      </div>`,
    submitLabel: 'İadeyi tamamla',
    submitClass: 'success',
    onSubmit: async (data, form) => {
      const body = collect(data, form);
      await api('POST', `/api/rentals/${r.id}/checkin`, body);
      toast('İade tamamlandı');
      onDone();
    },
  });
  const form = m.form;
  const collect = (data, f) => ({
    ...data,
    damages: [...f.querySelectorAll('[data-row=damage]')].map(rowData),
    extra_charges: [...f.querySelectorAll('[data-row=charge]')].map(rowData),
  });
  const rowData = (row) => Object.fromEntries([...row.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value]));

  const preview = debounce(async () => {
    const box = form.querySelector('#preview');
    if (!form.end_km.value) return;
    const data = Object.fromEntries([...form.elements].filter((x) => x.name).map((x) => [x.name, x.type === 'checkbox' ? x.checked : x.value]));
    try {
      const p = await api('POST', `/api/rentals/${r.id}/checkin/preview`, collect(data, form));
      setView(
        box,
        html`<div class="grid grid-2">
          <div>
            <div class="sum-row"><span>Kullanılan km</span><span>${numf(p.km_driven)} km</span></div>
            <div class="sum-row"><span>Gerçekleşen süre</span><span>${p.actual_days} gün ${p.late_days ? html`<span class="badge danger">+${p.late_days} gün gecikme</span>` : ''}</span></div>
            ${p.charges.length ? p.charges.map((c) => html`<div class="sum-row"><span>${LABELS.chargeType[c.type]} <span class="muted small">${c.description}</span></span><span>${money(c.amount)}</span></div>`) : html`<div class="sum-row muted"><span>Ek ücret yok</span><span></span></div>`}
          </div>
          <div>
            <div class="sum-row"><span>Yeni toplam</span><span>${money(p.new_total)}</span></div>
            <div class="sum-row"><span>Ödenen</span><span>${money(p.paid)}</span></div>
            <div class="sum-row total"><span>Kalan bakiye</span><span class="${p.balance > 0 ? 'danger-text' : ''}">${money(p.balance)}</span></div>
            <div class="sum-row"><span>Tutulan depozito</span><span>${money(p.deposit_held)}</span></div>
          </div></div>`,
      );
      m.setError(null);
    } catch (e) {
      setView(box, errorHtml(e));
    }
  }, 300);

  const addRow = (container, tpl) => {
    container.insertAdjacentHTML('beforeend', tpl().s);
    const row = container.lastElementChild;
    row.querySelector('[data-rm]').onclick = () => {
      row.remove();
      preview();
    };
    row.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', preview));
  };
  form.querySelector('#add-dmg').onclick = () => addRow(form.querySelector('#dmg-rows'), dmgRow);
  form.querySelector('#add-chg').onclick = () => addRow(form.querySelector('#chg-rows'), chargeRow);
  form.querySelectorAll('[name]').forEach((i) => i.addEventListener('input', preview));
}

// ---------- Yazdırılabilir sözleşme ----------
export async function contract(el, { id }) {
  const r = await api('GET', `/api/rentals/${id}`);
  const s = state.settings;
  const c = r.customer;
  const v = r.vehicle;
  setView(
    el,
    html`<div class="no-print actions mb"><a class="btn" href="#/rentals/${r.id}">← Geri</a><button class="primary" onclick="window.print()">🖨️ Yazdır</button></div>
    <div class="contract">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div><h1>${s.company_name}</h1><div>${s.company_address}</div><div>${s.company_phone}</div>${s.company_tax_no ? html`<div>VKN: ${s.company_tax_no}</div>` : ''}</div>
        <div class="right"><h1>ARAÇ KİRALAMA SÖZLEŞMESİ</h1><div>No: <strong>${r.contract_no}</strong></div><div>Tarih: ${dt(r.created_at)}</div></div>
      </div>
      <h3 style="margin:18px 0 6px">Kiracı</h3>
      <table><tbody>
        <tr><th>Ad Soyad</th><td>${customerName(c)}</td><th>T.C. / Pasaport</th><td>${c.national_id || c.passport_no || ''}</td></tr>
        <tr><th>Telefon</th><td>${c.phone}</td><th>E-posta</th><td>${c.email}</td></tr>
        <tr><th>Ehliyet no / sınıf</th><td>${c.license_no} / ${c.license_class}</td><th>Ehliyet tarihi</th><td>${d(c.license_date)}</td></tr>
        <tr><th>Adres</th><td colspan="3">${c.address}</td></tr>
        ${r.additional_driver ? html`<tr><th>Ek sürücü</th><td colspan="3">${r.additional_driver}</td></tr>` : ''}
      </tbody></table>
      <h3 style="margin:18px 0 6px">Araç ve kiralama</h3>
      <table><tbody>
        <tr><th>Plaka</th><td>${v.plate}</td><th>Marka / Model</th><td>${v.brand} ${v.model} (${v.year || ''})</td></tr>
        <tr><th>Teslim</th><td>${dt(r.pickup_at)} · ${r.pickup_branch_name || ''}</td><th>Dönüş</th><td>${dt(r.planned_return_at)} · ${r.return_branch_name || ''}</td></tr>
        <tr><th>Çıkış km / yakıt</th><td>${numf(r.start_km)} / ${FUEL(r.start_fuel)}</td><th>Dönüş km / yakıt</th><td>${r.end_km !== null ? `${numf(r.end_km)} / ${FUEL(r.end_fuel)}` : '………… / ……'}</td></tr>
        <tr><th>Km limiti</th><td>${v.km_limit_per_day ? `${v.km_limit_per_day} km/gün (aşım ${money(v.extra_km_fee)}/km)` : 'Sınırsız'}</td><th>Depozito</th><td>${money(r.deposit_amount)}</td></tr>
      </tbody></table>
      <h3 style="margin:18px 0 6px">Ücretler</h3>
      <table><tbody>
        <tr><td>${r.days} gün × ${money(r.daily_rate)}</td><td class="num">${money(r.base_amount)}</td></tr>
        ${r.long_term_discount ? html`<tr><td>Uzun dönem indirimi</td><td class="num">-${money(r.long_term_discount)}</td></tr>` : ''}
        ${r.extras.map((x) => html`<tr><td>${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}</td><td class="num">${money(x.amount)}</td></tr>`)}
        ${r.one_way_fee ? html`<tr><td>Tek yön ücreti</td><td class="num">${money(r.one_way_fee)}</td></tr>` : ''}
        ${r.discount ? html`<tr><td>İndirim</td><td class="num">-${money(r.discount)}</td></tr>` : ''}
        ${r.charges.map((x) => html`<tr><td>${LABELS.chargeType[x.type]} ${x.description ? '— ' + x.description : ''}</td><td class="num">${money(x.amount)}</td></tr>`)}
        <tr><th>TOPLAM (KDV %${s.vat_rate} dahil)</th><th class="num">${money(r.total_amount)}</th></tr>
        <tr><td>Ödenen</td><td class="num">${money(r.finance.paid)}</td></tr>
        <tr><td>Kalan</td><td class="num">${money(r.finance.balance)}</td></tr>
      </tbody></table>
      ${r.checkout_notes ? html`<p><strong>Teslim notları:</strong> ${r.checkout_notes}</p>` : ''}
      <h3 style="margin:18px 0 6px">Genel şartlar</h3>
      <p style="font-size:12px;white-space:pre-line">${s.contract_terms}</p>
      <div class="sig"><div>Kiraya veren<br />${s.company_name}</div><div>Kiracı<br />${customerName(c)}</div></div>
    </div>`,
  );
}
