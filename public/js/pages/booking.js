import {
  api, html, setView, money, numf, dt, options, field, toast, qs, debounce, state, branchOptions, fuelOptions,
  localInput, addDaysStr, errorHtml, customerName,
} from '../core.js';
import { customerModal } from './customers.js';

const METHODS = [['credit_card', 'Kredi kartı'], ['cash', 'Nakit'], ['bank_transfer', 'Havale/EFT']];

export async function render(el, { query }) {
  let editing = null;
  if (query.reservation_id) editing = await api('GET', `/api/reservations/${query.reservation_id}`);

  const branch = state.branches.find((b) => b.active)?.id || '';
  const s = {
    mode: editing ? 'reservation' : query.mode || 'reservation',
    pickup_at: editing?.pickup_at || addDaysStr(query.mode === 'rental' ? 0 : 1, 10),
    return_at: editing?.return_at || addDaysStr(query.mode === 'rental' ? 3 : 4, 10),
    pickup_branch_id: editing?.pickup_branch_id ?? branch,
    return_branch_id: editing?.return_branch_id ?? branch,
    category: '',
    transmission: '',
    vehicle_id: editing?.vehicle_id || (query.vehicle_id ? Number(query.vehicle_id) : null),
    customer: null,
    extras: Object.fromEntries((editing?.extras || []).map((x) => [x.extra_id, x.quantity])),
    vehicles: [],
    quote: null,
  };
  if (s.mode === 'rental') s.pickup_at = localInput();
  const customerId = editing?.customer_id || query.customer_id;
  if (customerId) s.customer = await api('GET', `/api/customers/${customerId}`);

  const activeExtras = state.extras.filter((x) => x.active || s.extras[x.id]);

  setView(
    el,
    html`<div class="page-head">
      <div><h1>${editing ? `Rezervasyon düzenle · ${editing.code}` : 'Yeni kiralama / rezervasyon'}</h1>
      <div class="sub">Tarih seçin, müsait aracı seçin, müşteriyi belirleyin ve kaydedin</div></div>
    </div>
    <form id="bk" class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start" novalidate>
      <div class="grid">
        ${editing ? '' : html`<div class="card"><div class="card-body">
          <div class="tabs" style="margin-bottom:0">
            <button type="button" data-mode="reservation" class="${s.mode === 'reservation' ? 'active' : ''}">📅 Rezervasyon (ileri tarihli)</button>
            <button type="button" data-mode="rental" class="${s.mode === 'rental' ? 'active' : ''}">🔑 Hemen teslim (kapıdan kiralama)</button>
          </div></div></div>`}

        <div class="card"><div class="card-head"><h2>1. Tarih & şube</h2></div><div class="card-body form-grid">
          ${field('Alış tarihi', html`<input type="datetime-local" name="pickup_at" value="${s.pickup_at}" />`, 'c3')}
          ${field('Dönüş tarihi', html`<input type="datetime-local" name="return_at" value="${s.return_at}" />`, 'c3')}
          ${field('Alış şubesi', html`<select name="pickup_branch_id">${branchOptions(s.pickup_branch_id, '—')}</select>`, 'c3')}
          ${field('Dönüş şubesi', html`<select name="return_branch_id">${branchOptions(s.return_branch_id, '—')}</select>`, 'c3')}
          ${field('Kategori', html`<select name="category">${options(state.meta.categories, '', { empty: 'Tümü' })}</select>`, 'c3')}
          ${field('Vites', html`<select name="transmission">${options(state.meta.transmissions, '', { empty: 'Tümü' })}</select>`, 'c3')}
        </div></div>

        <div class="card"><div class="card-head"><h2>2. Araç seçimi</h2><span class="muted small" id="v-count"></span></div>
          <div class="card-body"><div id="vehicles" class="vehicle-cards"></div></div></div>

        <div class="card"><div class="card-head"><h2>3. Müşteri</h2><button type="button" class="sm" id="new-cust">+ Yeni müşteri</button></div>
          <div class="card-body"><div id="cust"></div></div></div>

        <div class="card"><div class="card-head"><h2>4. Ek hizmetler & fiyat</h2></div><div class="card-body">
          ${activeExtras.length
            ? activeExtras.map(
                (x) => html`<div class="extra-row">
                  <label class="check" style="flex:1"><input type="checkbox" data-extra="${x.id}" ${s.extras[x.id] ? 'checked' : ''} />
                    ${x.name} <span class="muted small">${money(x.price)} ${x.price_type === 'daily' ? '/ gün' : '/ kiralama'}${x.max_price ? ` (en fazla ${money(x.max_price)})` : ''}</span></label>
                  <input type="number" min="1" data-qty="${x.id}" value="${s.extras[x.id] || 1}" title="Adet" />
                </div>`,
              )
            : html`<div class="muted">Tanımlı ek hizmet yok.</div>`}
          <div class="form-grid" style="margin-top:12px">
            ${field('Özel günlük fiyat (boş = liste fiyatı)', html`<input type="number" step="0.01" name="daily_rate" value="${editing?.daily_rate ?? ''}" />`, 'c4')}
            ${field('İndirim (₺)', html`<input type="number" step="0.01" name="discount" value="${editing?.discount || ''}" />`, 'c4')}
            ${field('Depozito (₺, boş = araç depozitosu)', html`<input type="number" step="0.01" name="deposit_amount" value="${editing?.deposit_amount ?? ''}" />`, 'c4')}
          </div>
        </div></div>

        <div class="card" id="mode-res"><div class="card-head"><h2>5. Rezervasyon bilgileri</h2></div><div class="card-body form-grid">
          ${field('Durum', html`<select name="status">${options([['confirmed', 'Onaylı'], ['pending', 'Beklemede']], editing?.status || 'confirmed')}</select>`, 'c4')}
          ${field('Kaynak', html`<select name="source">${options(['Ofis', 'Telefon', 'Web', 'Acente', 'Kurumsal'], editing?.source || 'Ofis')}</select>`, 'c4')}
          ${editing ? '' : field('Ön ödeme (₺)', html`<input type="number" step="0.01" name="prepayment" />`, 'c4')}
          ${editing ? '' : field('Ön ödeme yöntemi', html`<select name="prepayment_method">${options(METHODS, 'credit_card')}</select>`, 'c4')}
          ${field('Notlar', html`<textarea name="notes">${editing?.notes}</textarea>`, 'c12')}
        </div></div>

        <div class="card" id="mode-rent"><div class="card-head"><h2>5. Teslim (check-out) bilgileri</h2></div><div class="card-body form-grid">
          ${field('Çıkış km', html`<input type="number" name="start_km" placeholder="Aracın güncel km'si" />`, 'c4')}
          ${field('Yakıt seviyesi', html`<select name="start_fuel">${fuelOptions(8)}</select>`, 'c4')}
          ${field('Ek sürücü (ad soyad, ehliyet)', html`<input name="additional_driver" />`, 'c4')}
          ${field('Alınan depozito (₺)', html`<input type="number" step="0.01" name="deposit_collected" />`, 'c3')}
          ${field('Depozito yöntemi', html`<select name="deposit_method">${options(METHODS, 'credit_card')}</select>`, 'c3')}
          ${field('Tahsilat (₺)', html`<input type="number" step="0.01" name="payment_amount" />`, 'c3')}
          ${field('Tahsilat yöntemi', html`<select name="payment_method">${options(METHODS, 'credit_card')}</select>`, 'c3')}
          ${field('Teslim notları (hasar, aksesuar vb.)', html`<textarea name="checkout_notes"></textarea>`, 'c12')}
        </div></div>
      </div>

      <div class="card sticky"><div class="card-head"><h2>Özet</h2></div><div class="card-body" id="summary"></div>
        <div class="card-body" style="border-top:1px solid var(--border)">
          <div id="err"></div>
          <button type="submit" class="primary" style="width:100%;justify-content:center" id="submit"></button>
        </div>
      </div>
    </form>`,
  );

  const form = el.querySelector('#bk');
  const $ = (n) => form.querySelector(`[name=${n}]`);

  const applyMode = () => {
    el.querySelector('#mode-res').style.display = s.mode === 'reservation' ? '' : 'none';
    el.querySelector('#mode-rent').style.display = s.mode === 'rental' ? '' : 'none';
    el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === s.mode));
    el.querySelector('#submit').textContent = editing ? 'Değişiklikleri kaydet' : s.mode === 'rental' ? 'Sözleşmeyi oluştur ve teslim et' : 'Rezervasyonu oluştur';
  };
  el.querySelectorAll('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        s.mode = b.dataset.mode;
        if (s.mode === 'rental') $('pickup_at').value = localInput();
        applyMode();
        searchVehicles();
      }),
  );
  applyMode();

  // ----- Araçlar -----
  const searchVehicles = debounce(async () => {
    const box = el.querySelector('#vehicles');
    try {
      const list = await api(
        'GET',
        '/api/vehicles/available?' +
          qs({
            pickup_at: $('pickup_at').value,
            return_at: $('return_at').value,
            category: $('category').value,
            transmission: $('transmission').value,
            exclude_reservation_id: editing?.id,
          }),
      );
      s.vehicles = list;
      if (s.vehicle_id && !list.some((v) => v.id === s.vehicle_id)) {
        const lost = s.vehicle_id;
        s.vehicle_id = null;
        toast(`Seçili araç (#${lost}) bu tarihlerde müsait değil`, 'error');
      }
      el.querySelector('#v-count').textContent = `${list.length} müsait araç`;
      setView(
        box,
        list.length
          ? list.map(
              (v) => html`<div class="vcard ${v.id === s.vehicle_id ? 'selected' : ''}" data-v="${v.id}">
                <div class="t">${v.brand} ${v.model}</div>
                <div class="muted small">${v.plate} · ${v.category} · ${v.transmission} · ${v.fuel_type}</div>
                <div class="muted small">${v.branch_name || ''} · ${numf(v.current_km)} km</div>
                <div class="price">${money(v.quote.total_amount)}</div>
                <div class="muted small">${v.quote.days} gün × ${money(v.daily_rate)}${v.quote.long_term_discount ? ` · %${v.quote.long_term_discount_pct} uzun dönem ind.` : ''}</div>
              </div>`,
            )
          : html`<div class="muted">Seçilen kriterlerde müsait araç bulunamadı.</div>`,
      );
      box.querySelectorAll('[data-v]').forEach(
        (c) =>
          (c.onclick = () => {
            s.vehicle_id = Number(c.dataset.v);
            box.querySelectorAll('.vcard').forEach((x) => x.classList.toggle('selected', x === c));
            const v = s.vehicles.find((x) => x.id === s.vehicle_id);
            $('start_km').placeholder = `${v.current_km} (güncel)`;
            if (!$('deposit_collected').value) $('deposit_collected').placeholder = v.deposit_amount;
            refreshQuote();
          }),
      );
      refreshQuote();
    } catch (e) {
      setView(box, errorHtml(e));
    }
  }, 250);

  // ----- Müşteri -----
  const renderCustomer = () => {
    const box = el.querySelector('#cust');
    if (s.customer) {
      const c = s.customer;
      setView(
        box,
        html`<div style="display:flex;justify-content:space-between;gap:10px;align-items:start">
          <div><strong>${customerName(c)}</strong> ${c.blacklisted ? html`<span class="badge danger">Kara liste</span>` : ''}
            <div class="muted small">${c.phone} · ${c.national_id || c.passport_no || 'kimlik yok'} · Ehliyet: ${c.license_no || 'yok'}</div></div>
          <button type="button" class="sm" id="change-cust">Değiştir</button>
        </div>
        ${c.issues?.length ? html`<div class="alert warn" style="margin-top:10px">${c.issues.map((i) => html`<div>• ${i}</div>`)}</div>` : ''}`,
      );
      box.querySelector('#change-cust').onclick = () => {
        s.customer = null;
        renderCustomer();
      };
      return;
    }
    setView(box, html`<input type="search" id="cust-q" placeholder="Ad, telefon, T.C. no ile müşteri ara…" /><div id="cust-res"></div>`);
    const q = box.querySelector('#cust-q');
    q.oninput = debounce(async () => {
      const res = box.querySelector('#cust-res');
      if (!q.value.trim()) return (res.innerHTML = '');
      const list = await api('GET', '/api/customers?' + qs({ q: q.value }));
      setView(
        res,
        html`<div class="cust-results">${list.length
          ? list.slice(0, 20).map((c) => html`<div data-c="${c.id}"><strong>${customerName(c)}</strong> <span class="muted small">${c.phone} ${c.national_id || ''}</span>
              ${c.blacklisted ? html`<span class="badge danger">Kara liste</span>` : ''}</div>`)
          : html`<div class="muted">Sonuç yok</div>`}</div>`,
      );
      res.querySelectorAll('[data-c]').forEach((d) => (d.onclick = () => selectCustomer(d.dataset.c)));
    }, 250);
    q.focus();
  };
  const selectCustomer = async (id) => {
    s.customer = await api('GET', `/api/customers/${id}`);
    renderCustomer();
  };
  el.querySelector('#new-cust').onclick = () => customerModal(null, (c) => selectCustomer(c.id));
  renderCustomer();

  // ----- Ek hizmetler -----
  const readExtras = () =>
    [...form.querySelectorAll('[data-extra]')]
      .filter((c) => c.checked)
      .map((c) => ({ extra_id: Number(c.dataset.extra), quantity: Number(form.querySelector(`[data-qty="${c.dataset.extra}"]`).value) || 1 }));

  // ----- Özet -----
  const refreshQuote = debounce(async () => {
    const box = el.querySelector('#summary');
    const v = s.vehicles.find((x) => x.id === s.vehicle_id);
    if (!v) return setView(box, html`<div class="muted">Fiyatı görmek için bir araç seçin.</div>`);
    try {
      const q = await api('POST', '/api/quote', {
        vehicle_id: v.id,
        pickup_at: $('pickup_at').value,
        return_at: $('return_at').value,
        pickup_branch_id: $('pickup_branch_id').value,
        return_branch_id: $('return_branch_id').value,
        extras: readExtras(),
        discount: $('discount').value,
        daily_rate: $('daily_rate').value,
      });
      s.quote = q;
      const dep = $('deposit_amount').value !== '' ? Number($('deposit_amount').value) : q.deposit_amount;
      setView(
        box,
        html`<div><strong>${v.brand} ${v.model}</strong> <span class="muted">${v.plate}</span></div>
        <div class="muted small" style="margin-bottom:10px">${dt($('pickup_at').value)} → ${dt($('return_at').value)}</div>
        <div class="sum-row"><span>${q.days} gün × ${money(q.daily_rate)}</span><span>${money(q.base_amount)}</span></div>
        ${q.long_term_discount ? html`<div class="sum-row"><span>Uzun dönem indirimi (%${q.long_term_discount_pct})</span><span>-${money(q.long_term_discount)}</span></div>` : ''}
        ${q.extras.map((x) => html`<div class="sum-row"><span>${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}</span><span>${money(x.amount)}</span></div>`)}
        ${q.one_way_fee ? html`<div class="sum-row"><span>Tek yön ücreti</span><span>${money(q.one_way_fee)}</span></div>` : ''}
        ${q.discount ? html`<div class="sum-row"><span>İndirim</span><span>-${money(q.discount)}</span></div>` : ''}
        <div class="sum-row total"><span>Toplam</span><span>${money(q.total_amount)}</span></div>
        <div class="muted small">Depozito: ${money(dep)} (iade edilir) · KDV dahil</div>`,
      );
    } catch (e) {
      setView(box, errorHtml(e));
    }
  }, 200);

  // ----- Olaylar -----
  for (const n of ['pickup_at', 'return_at', 'category', 'transmission']) $(n).addEventListener('change', searchVehicles);
  for (const n of ['pickup_branch_id', 'return_branch_id', 'discount', 'daily_rate', 'deposit_amount']) $(n).addEventListener('input', refreshQuote);
  form.querySelectorAll('[data-extra],[data-qty]').forEach((i) => i.addEventListener('input', refreshQuote));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el.querySelector('#err');
    err.innerHTML = '';
    if (!s.vehicle_id) return (err.innerHTML = '<div class="alert danger">Lütfen bir araç seçin</div>');
    if (!s.customer) return (err.innerHTML = '<div class="alert danger">Lütfen bir müşteri seçin</div>');
    const data = Object.fromEntries([...form.elements].filter((x) => x.name).map((x) => [x.name, x.value]));
    const body = { ...data, vehicle_id: s.vehicle_id, customer_id: s.customer.id, extras: readExtras() };
    const btn = el.querySelector('#submit');
    btn.disabled = true;
    try {
      if (editing) {
        await api('PUT', `/api/reservations/${editing.id}`, body);
        toast('Rezervasyon güncellendi');
        location.hash = `#/reservations/${editing.id}`;
      } else if (s.mode === 'rental') {
        const r = await api('POST', '/api/rentals', body);
        toast(`Sözleşme ${r.contract_no} oluşturuldu, araç teslim edildi`);
        location.hash = `#/rentals/${r.id}`;
      } else {
        const r = await api('POST', '/api/reservations', body);
        toast(`Rezervasyon ${r.code} oluşturuldu`);
        location.hash = `#/reservations/${r.id}`;
      }
    } catch (ex) {
      err.innerHTML = errorHtml(ex).s;
    } finally {
      btn.disabled = false;
    }
  });

  searchVehicles();
  // Ekran genişliği küçükse özet alta insin
  if (window.innerWidth < 900) form.style.gridTemplateColumns = 'minmax(0,1fr)';
}
