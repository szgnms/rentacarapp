import {
  api, html, setView, money, dt, table, badge, options, mapOptions, LABELS, field, openModal, toast, confirmDialog,
  qs, debounce, fuelOptions, localInput, customerName, errorHtml,
} from '../core.js';
import { paymentModal } from './rentals.js';

const METHODS = [['credit_card', 'Kredi kartı'], ['cash', 'Nakit'], ['bank_transfer', 'Havale/EFT']];

export async function list(el, { query }) {
  const f = { q: query.q || '', status: query.status || '', from: query.from || '', to: query.to || '' };
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Rezervasyonlar</h1><div class="sub">İleri tarihli araç rezervasyonları</div></div>
      <div class="actions"><a class="btn primary" href="#/booking">+ Yeni rezervasyon</a></div>
    </div>
    <div class="filters">
      <input type="search" name="q" placeholder="Kod, müşteri, plaka ara…" value="${f.q}" />
      <select name="status">${options(mapOptions(LABELS.reservationStatus), f.status, { empty: 'Tüm durumlar' })}</select>
      <input type="date" name="from" value="${f.from}" title="Alış tarihi (başlangıç)" />
      <input type="date" name="to" value="${f.to}" title="Alış tarihi (bitiş)" />
    </div>
    <div class="card" id="list"></div>`,
  );
  const load = async () => {
    const rows = await api('GET', '/api/reservations?' + qs(f));
    setView(
      el.querySelector('#list'),
      table(
        ['Kod', 'Müşteri', 'Araç', 'Alış', 'Dönüş', ['Gün', 'num'], ['Tutar', 'num'], 'Kaynak', 'Durum'],
        rows.map(
          (r) => html`<tr class="click" onclick="location.hash='#/reservations/${r.id}'">
            <td><strong>${r.code}</strong></td><td>${r.customer_name}<div class="muted small">${r.customer_phone}</div></td>
            <td>${r.plate}<div class="muted small">${r.brand} ${r.model}</div></td>
            <td class="nowrap">${dt(r.pickup_at)}<div class="muted small">${r.pickup_branch_name}</div></td>
            <td class="nowrap">${dt(r.return_at)}<div class="muted small">${r.return_branch_name}</div></td>
            <td class="num">${r.days}</td><td class="num">${money(r.total_amount)}</td><td>${r.source}</td>
            <td>${badge('reservationStatus', r.status)}</td></tr>`,
        ),
      ),
    );
  };
  const onChange = debounce(() => {
    for (const k of Object.keys(f)) f[k] = el.querySelector(`[name=${k}]`).value;
    history.replaceState(null, '', '#/reservations?' + qs(f));
    load();
  }, 250);
  el.querySelectorAll('.filters [name]').forEach((i) => i.addEventListener('input', onChange));
  await load();
}

export async function detail(el, { id }) {
  const r = await api('GET', `/api/reservations/${id}`);
  const reload = () => detail(el, { id });
  const open = ['pending', 'confirmed'].includes(r.status);
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Rezervasyon ${r.code} ${badge('reservationStatus', r.status)}</h1>
        <div class="sub">Oluşturma: ${dt(r.created_at)} · Kaynak: ${r.source}</div></div>
      <div class="actions">
        ${open ? html`<button class="success" id="checkout">🔑 Aracı teslim et</button>` : ''}
        ${r.status === 'pending' ? html`<button class="primary" id="confirm">Onayla</button>` : ''}
        ${open ? html`<a class="btn" href="#/booking?reservation_id=${r.id}">Düzenle</a>` : ''}
        ${open ? html`<button id="pay">Ön ödeme al</button>` : ''}
        ${open ? html`<button id="noshow">Gelmedi</button>` : ''}
        ${open ? html`<button class="danger" id="cancel">İptal et</button>` : ''}
        ${r.rental_id ? html`<a class="btn primary" href="#/rentals/${r.rental_id}">Sözleşmeye git →</a>` : ''}
      </div>
    </div>
    ${r.cancel_reason ? html`<div class="alert warn">Neden: ${r.cancel_reason}</div>` : ''}
    <div class="grid grid-2 mb">
      <div class="card"><div class="card-head"><h2>Detaylar</h2></div><div class="card-body"><dl class="kv">
        <dt>Müşteri</dt><dd><a href="#/customers/${r.customer_id}">${r.customer_name}</a> · ${r.customer_phone}</dd>
        <dt>Araç</dt><dd><a href="#/vehicles/${r.vehicle_id}">${r.plate}</a> · ${r.brand} ${r.model} (${r.category})</dd>
        <dt>Alış</dt><dd>${dt(r.pickup_at)} · ${r.pickup_branch_name || '—'}</dd>
        <dt>Dönüş</dt><dd>${dt(r.return_at)} · ${r.return_branch_name || '—'}</dd>
        <dt>Süre</dt><dd>${r.days} gün</dd>
        <dt>Depozito</dt><dd>${money(r.deposit_amount)}</dd>
        ${r.notes ? html`<dt>Notlar</dt><dd>${r.notes}</dd>` : ''}
      </dl></div></div>
      <div class="card"><div class="card-head"><h2>Fiyat</h2></div><div class="card-body">
        <div class="sum-row"><span>${r.days} gün × ${money(r.daily_rate)}</span><span>${money(r.base_amount)}</span></div>
        ${r.long_term_discount ? html`<div class="sum-row"><span>Uzun dönem indirimi</span><span>-${money(r.long_term_discount)}</span></div>` : ''}
        ${r.extras.map((x) => html`<div class="sum-row"><span>${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}</span><span>${money(x.amount)}</span></div>`)}
        ${r.one_way_fee ? html`<div class="sum-row"><span>Tek yön ücreti</span><span>${money(r.one_way_fee)}</span></div>` : ''}
        ${r.discount ? html`<div class="sum-row"><span>İndirim</span><span>-${money(r.discount)}</span></div>` : ''}
        <div class="sum-row total"><span>Toplam</span><span>${money(r.total_amount)}</span></div>
        <div class="sum-row"><span>Ön ödeme</span><span>${money(r.finance.paid)}</span></div>
      </div></div>
    </div>
    ${r.payments.length
      ? html`<div class="card"><div class="card-head"><h2>Ödemeler</h2></div>${table(
          ['Tarih', 'İşlem', 'Yöntem', 'Açıklama', ['Tutar', 'num']],
          r.payments.map((p) => html`<tr><td>${dt(p.paid_at)}</td><td>${badge('paymentType', p.type)}</td><td>${LABELS.method[p.method]}</td><td>${p.description}</td><td class="num">${money(p.amount)}</td></tr>`),
        )}</div>`
      : ''}`,
  );

  const act = async (path, msg, body = {}) => {
    try {
      await api('POST', `/api/reservations/${r.id}/${path}`, body);
      toast(msg);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  el.querySelector('#confirm')?.addEventListener('click', () => act('confirm', 'Rezervasyon onaylandı'));
  el.querySelector('#cancel')?.addEventListener('click', async () => {
    const reason = await confirmDialog('Rezervasyon iptal edilsin mi?', { okLabel: 'İptal et', input: 'İptal nedeni' });
    if (reason !== null) act('cancel', 'Rezervasyon iptal edildi', { reason });
  });
  el.querySelector('#noshow')?.addEventListener('click', async () => {
    if (await confirmDialog('Müşteri gelmedi olarak işaretlensin mi?')) act('no-show', 'Gelmedi olarak işaretlendi');
  });
  el.querySelector('#pay')?.addEventListener('click', () => paymentModal({ reservation_id: r.id, suggested: r.total_amount - r.finance.paid }, reload));
  el.querySelector('#checkout')?.addEventListener('click', () => checkoutModal(r));
}

async function checkoutModal(r) {
  const v = await api('GET', `/api/vehicles/${r.vehicle_id}`);
  const cust = await api('GET', `/api/customers/${r.customer_id}`);
  const balance = Math.max(0, r.total_amount - r.finance.paid);
  openModal({
    title: `Araç teslimi · ${r.code}`,
    wide: true,
    body: html`
      ${cust.issues.length ? html`<div class="alert warn">Müşteri kaydında eksik/uygunsuz bilgi var; teslimden önce <a href="#/customers/${cust.id}">müşteri kartını</a> güncelleyin:<ul>${cust.issues.map((i) => html`<li>${i}</li>`)}</ul></div>` : ''}
      ${v.status !== 'available' ? html`<div class="alert danger">Rezerve edilen araç şu an "${LABELS.vehicleStatus[v.status][0]}". Aşağıdan farklı bir araç seçebilirsiniz.</div>` : ''}
      <div class="alert info">${customerName(cust)} · ${r.plate} · ${dt(r.pickup_at)} → ${dt(r.return_at)} · Toplam ${money(r.total_amount)}</div>
      <div class="form-grid">
        ${field('Teslim zamanı', html`<input type="datetime-local" name="pickup_at" value="${localInput()}" />`, 'c4')}
        ${field('Araç (değişim / upgrade)', html`<select name="vehicle_id" id="co-vehicle"><option value="${v.id}">${v.plate} · ${v.brand} ${v.model}</option></select>`, 'c8')}
        ${field('Çıkış km', html`<input type="number" name="start_km" value="${v.current_km}" />`, 'c4')}
        ${field('Yakıt seviyesi', html`<select name="start_fuel">${fuelOptions(8)}</select>`, 'c4')}
        ${field('Ek sürücü', html`<input name="additional_driver" />`, 'c4')}
        <div class="form-section">Tahsilat</div>
        ${field('Alınan depozito (₺)', html`<input type="number" step="0.01" name="deposit_collected" value="${r.deposit_amount}" />`, 'c3')}
        ${field('Depozito yöntemi', html`<select name="deposit_method">${options(METHODS, 'credit_card')}</select>`, 'c3')}
        ${field(`Tahsilat (₺) · kalan ${money(balance)}`, html`<input type="number" step="0.01" name="payment_amount" value="${balance || ''}" />`, 'c3')}
        ${field('Tahsilat yöntemi', html`<select name="payment_method">${options(METHODS, 'credit_card')}</select>`, 'c3')}
        ${field('Teslim notları (mevcut hasarlar, aksesuarlar)', html`<textarea name="checkout_notes"></textarea>`, 'c12')}
      </div>`,
    submitLabel: 'Teslim et ve sözleşme oluştur',
    submitClass: 'success',
    onOpen: async (root) => {
      try {
        const alts = await api('GET', '/api/vehicles/available?' + qs({ pickup_at: localInput(), return_at: r.return_at, exclude_reservation_id: r.id }));
        const sel = root.querySelector('#co-vehicle');
        for (const a of alts) {
          if (a.id === v.id || a.status !== 'available') continue;
          sel.insertAdjacentHTML('beforeend', html`<option value="${a.id}" data-km="${a.current_km}">${a.plate} · ${a.brand} ${a.model} (${a.category})</option>`.s);
        }
        sel.onchange = () => {
          const km = sel.selectedOptions[0].dataset.km;
          root.querySelector('[name=start_km]').value = km ?? v.current_km;
        };
      } catch (e) {
        root.querySelector('.modal-error').innerHTML = errorHtml(e).s;
      }
    },
    onSubmit: async (data) => {
      const rental = await api('POST', `/api/reservations/${r.id}/checkout`, data);
      toast(`Sözleşme ${rental.contract_no} oluşturuldu`);
      location.hash = `#/rentals/${rental.id}`;
    },
  });
}
