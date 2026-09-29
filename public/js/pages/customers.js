import {
  api, html, setView, money, d, dt, table, badge, options, field, openModal, toast, confirmDialog, qs, debounce, isAdmin,
  customerName, LABELS,
} from '../core.js';

export async function list(el, { query }) {
  const f = { q: query.q || '', blacklisted: query.blacklisted || '' };
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Müşteriler</h1><div class="sub">Bireysel ve kurumsal müşteri kayıtları</div></div>
      <div class="actions"><button class="primary" id="add">+ Müşteri ekle</button></div>
    </div>
    <div class="filters">
      <input type="search" name="q" placeholder="Ad, telefon, T.C., ehliyet no ara…" value="${f.q}" />
      <select name="blacklisted">${options([['0', 'Aktif'], ['1', 'Kara liste']], f.blacklisted, { empty: 'Tümü' })}</select>
    </div>
    <div class="card" id="list"></div>`,
  );
  const load = async () => {
    const rows = await api('GET', '/api/customers?' + qs(f));
    setView(
      el.querySelector('#list'),
      table(
        ['Müşteri', 'Telefon', 'E-posta', 'Kimlik', 'Ehliyet', ['Kiralama', 'num'], ['Toplam', 'num'], ''],
        rows.map(
          (c) => html`<tr class="click" onclick="location.hash='#/customers/${c.id}'">
            <td><strong>${customerName(c)}</strong>${c.type === 'corporate' ? html` <span class="badge violet">Kurumsal</span>` : ''}</td>
            <td class="nowrap">${c.phone}</td><td>${c.email}</td><td>${c.national_id || c.passport_no || '—'}</td>
            <td>${c.license_no || html`<span class="muted">—</span>`}</td>
            <td class="num">${c.rental_count}</td><td class="num">${money(c.total_spent)}</td>
            <td>${c.blacklisted ? html`<span class="badge danger">Kara liste</span>` : ''}</td>
          </tr>`,
        ),
      ),
    );
  };
  const onChange = debounce(() => {
    for (const k of Object.keys(f)) f[k] = el.querySelector(`[name=${k}]`).value;
    history.replaceState(null, '', '#/customers?' + qs(f));
    load();
  }, 250);
  el.querySelectorAll('.filters [name]').forEach((i) => i.addEventListener('input', onChange));
  el.querySelector('#add').onclick = () => customerModal(null, (c) => (location.hash = `#/customers/${c.id}`));
  await load();
}

export function customerModal(c, onDone) {
  const x = c || { type: 'individual', nationality: 'TR', license_class: 'B' };
  const m = openModal({
    title: c ? 'Müşteri düzenle' : 'Yeni müşteri',
    wide: true,
    body: html`<div class="form-grid">
      ${field('Müşteri tipi', html`<select name="type">${options([['individual', 'Bireysel'], ['corporate', 'Kurumsal']], x.type)}</select>`, 'c4')}
      ${field('Ad *', html`<input name="first_name" value="${x.first_name}" required />`, 'c4')}
      ${field('Soyad *', html`<input name="last_name" value="${x.last_name}" required />`, 'c4')}
      <div class="corp c12 form-grid" style="display:${x.type === 'corporate' ? 'grid' : 'none'};padding:0">
        ${field('Firma unvanı', html`<input name="company_name" value="${x.company_name}" />`, 'c4')}
        ${field('Vergi dairesi', html`<input name="tax_office" value="${x.tax_office}" />`, 'c4')}
        ${field('Vergi no', html`<input name="tax_no" value="${x.tax_no}" />`, 'c4')}
      </div>
      ${field('Telefon *', html`<input name="phone" value="${x.phone}" required />`, 'c4')}
      ${field('E-posta', html`<input name="email" type="email" value="${x.email}" />`, 'c4')}
      ${field('Doğum tarihi', html`<input name="birth_date" type="date" value="${x.birth_date}" />`, 'c4')}
      ${field('T.C. kimlik no', html`<input name="national_id" maxlength="11" value="${x.national_id}" />`, 'c4')}
      ${field('Pasaport no', html`<input name="passport_no" value="${x.passport_no}" />`, 'c4')}
      ${field('Uyruk', html`<input name="nationality" value="${x.nationality}" />`, 'c4')}
      <div class="form-section">Ehliyet</div>
      ${field('Ehliyet no', html`<input name="license_no" value="${x.license_no}" />`, 'c4')}
      ${field('Sınıf', html`<input name="license_class" value="${x.license_class}" />`, 'c4')}
      ${field('Veriliş tarihi', html`<input name="license_date" type="date" value="${x.license_date}" />`, 'c4')}
      ${field('Adres', html`<textarea name="address">${x.address}</textarea>`, 'c12')}
      <div class="form-section">Durum</div>
      <label class="check c4"><input type="checkbox" name="blacklisted" ${x.blacklisted ? 'checked' : ''} /> Kara listede</label>
      ${field('Kara liste nedeni', html`<input name="blacklist_reason" value="${x.blacklist_reason}" />`, 'c8')}
      ${field('Notlar', html`<textarea name="notes">${x.notes}</textarea>`, 'c12')}
    </div>`,
    onSubmit: async (data) => {
      const saved = c ? await api('PUT', `/api/customers/${c.id}`, data) : await api('POST', '/api/customers', data);
      toast('Müşteri kaydedildi');
      onDone(saved);
    },
  });
  const typeSel = m.form.querySelector('[name=type]');
  typeSel.onchange = () => (m.form.querySelector('.corp').style.display = typeSel.value === 'corporate' ? 'grid' : 'none');
  return m;
}

export async function detail(el, { id }) {
  const c = await api('GET', `/api/customers/${id}`);
  const reload = () => detail(el, { id });
  setView(
    el,
    html`<div class="page-head">
      <div><h1>${customerName(c)} ${c.blacklisted ? html`<span class="badge danger">Kara liste</span>` : ''}</h1>
        <div class="sub">${c.phone} ${c.email ? '· ' + c.email : ''}</div></div>
      <div class="actions">
        ${!c.blacklisted ? html`<a class="btn primary" href="#/booking?customer_id=${c.id}">Yeni kiralama / rezervasyon</a>` : ''}
        <button id="edit">Düzenle</button>
        ${isAdmin() ? html`<button class="danger" id="del">Sil</button>` : ''}
      </div>
    </div>
    ${c.blacklisted ? html`<div class="alert danger">Kara liste nedeni: ${c.blacklist_reason || 'belirtilmemiş'}</div>` : ''}
    ${!c.blacklisted && c.issues.length ? html`<div class="alert warn">Teslim öncesi tamamlanması gerekenler:<ul>${c.issues.map((i) => html`<li>${i}</li>`)}</ul></div>` : ''}
    <div class="grid grid-3 mb">
      <div class="card stat"><div class="label">Kiralama sayısı</div><div class="value">${c.rentals.filter((r) => r.status !== 'cancelled').length}</div></div>
      <div class="card stat"><div class="label">Toplam harcama</div><div class="value">${money(c.rentals.filter((r) => r.status !== 'cancelled').reduce((a, r) => a + r.total_amount, 0))}</div></div>
      <div class="card stat"><div class="label">Açık bakiye</div><div class="value ${c.balance > 0 ? 'danger-text' : ''}">${money(c.balance)}</div></div>
    </div>
    <div class="grid grid-2 mb">
      <div class="card"><div class="card-head"><h2>Kimlik & iletişim</h2></div><div class="card-body"><dl class="kv">
        <dt>Tip</dt><dd>${c.type === 'corporate' ? 'Kurumsal' : 'Bireysel'}</dd>
        ${c.type === 'corporate' ? html`<dt>Firma</dt><dd>${c.company_name}</dd><dt>Vergi</dt><dd>${c.tax_office} / ${c.tax_no}</dd>` : ''}
        <dt>T.C. / Pasaport</dt><dd>${c.national_id || '—'} / ${c.passport_no || '—'}</dd>
        <dt>Doğum tarihi</dt><dd>${d(c.birth_date)}</dd>
        <dt>Adres</dt><dd>${c.address || '—'}</dd>
        ${c.notes ? html`<dt>Notlar</dt><dd>${c.notes}</dd>` : ''}
      </dl></div></div>
      <div class="card"><div class="card-head"><h2>Ehliyet</h2></div><div class="card-body"><dl class="kv">
        <dt>Ehliyet no</dt><dd>${c.license_no || '—'}</dd>
        <dt>Sınıf</dt><dd>${c.license_class || '—'}</dd>
        <dt>Veriliş tarihi</dt><dd>${d(c.license_date)}</dd>
        <dt>Kayıt tarihi</dt><dd>${dt(c.created_at)}</dd>
      </dl></div></div>
    </div>
    <div class="card mb"><div class="card-head"><h2>Kiralamalar</h2></div>
      ${table(
        ['Sözleşme', 'Araç', 'Teslim', 'Dönüş', ['Tutar', 'num'], ['Bakiye', 'num'], 'Durum'],
        c.rentals.map(
          (r) => html`<tr class="click" onclick="location.hash='#/rentals/${r.id}'"><td>${r.contract_no}</td><td>${r.plate} <span class="muted small">${r.brand} ${r.model}</span></td>
            <td>${dt(r.pickup_at)}</td><td>${dt(r.actual_return_at || r.planned_return_at)}</td><td class="num">${money(r.total_amount)}</td>
            <td class="num ${r.balance > 0 ? 'danger-text' : ''}">${money(r.balance)}</td><td>${badge('rentalStatus', r.status)}</td></tr>`,
        ),
      )}
    </div>
    <div class="card mb"><div class="card-head"><h2>Rezervasyonlar</h2></div>
      ${table(
        ['Kod', 'Araç', 'Alış', 'Dönüş', ['Tutar', 'num'], 'Durum'],
        c.reservations.map(
          (r) => html`<tr class="click" onclick="location.hash='#/reservations/${r.id}'"><td>${r.code}</td><td>${r.plate}</td><td>${dt(r.pickup_at)}</td>
            <td>${dt(r.return_at)}</td><td class="num">${money(r.total_amount)}</td><td>${badge('reservationStatus', r.status)}</td></tr>`,
        ),
      )}
    </div>
    <div class="card"><div class="card-head"><h2>Ödeme hareketleri</h2></div>
      ${table(
        ['Tarih', 'İşlem', 'Yöntem', 'Açıklama', ['Tutar', 'num']],
        c.payments.map(
          (p) => html`<tr><td>${dt(p.paid_at)}</td><td>${badge('paymentType', p.type)}</td><td>${LABELS.method[p.method]}</td><td>${p.description}</td><td class="num">${money(p.amount)}</td></tr>`,
        ),
      )}
    </div>`,
  );
  el.querySelector('#edit').onclick = () => customerModal(c, reload);
  el.querySelector('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Müşteri kaydı silinsin mi?', { okLabel: 'Sil' }))) return;
    try {
      await api('DELETE', `/api/customers/${c.id}`);
      toast('Müşteri silindi');
      location.hash = '#/customers';
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}
