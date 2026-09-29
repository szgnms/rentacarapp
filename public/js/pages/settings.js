import {
  api, html, setView, money, table, options, field, openModal, toast, confirmDialog, isAdmin, state, loadLookups, LABELS,
} from '../core.js';

export async function render(el, { query }) {
  const tab = query.tab || 'general';
  const admin = isAdmin();
  const reload = async () => {
    await loadLookups();
    window.dispatchEvent(new Event('refresh-view'));
  };
  const tabs = [['general', 'Genel & fiyat kuralları'], ['branches', 'Şubeler'], ['extras', 'Ek hizmetler'], ...(admin ? [['users', 'Kullanıcılar']] : []), ['account', 'Hesabım']];
  setView(
    el,
    html`<div class="page-head"><div><h1>Ayarlar</h1><div class="sub">${admin ? 'Sistem yapılandırması' : 'Yalnızca yöneticiler ayarları değiştirebilir'}</div></div></div>
    <div class="tabs">${tabs.map(([k, l]) => html`<button class="${k === tab ? 'active' : ''}" onclick="location.hash='#/settings?tab=${k}'">${l}</button>`)}</div>
    <div id="panel"></div>`,
  );
  const panel = el.querySelector('#panel');
  if (tab === 'general') {
    const s = state.settings;
    const f = (key, label, type = 'text', cls = 'c4') =>
      field(label, type === 'textarea' ? html`<textarea name="${key}" ${admin ? '' : 'disabled'} rows="5">${s[key]}</textarea>` : html`<input name="${key}" type="${type}" step="any" value="${s[key]}" ${admin ? '' : 'disabled'} />`, cls);
    setView(
      panel,
      html`<form class="card" id="sf"><div class="card-body form-grid">
        <div class="form-section">Şirket</div>
        ${f('company_name', 'Şirket adı')}${f('company_phone', 'Telefon')}${f('company_tax_no', 'Vergi no')}
        ${f('company_address', 'Adres', 'text', 'c12')}
        <div class="form-section">Fiyatlandırma</div>
        ${f('grace_hours', 'Tolerans süresi (saat)', 'number', 'c3')}
        ${f('weekly_discount_pct', '7+ gün indirimi (%)', 'number', 'c3')}
        ${f('monthly_discount_pct', '30+ gün indirimi (%)', 'number', 'c3')}
        ${f('one_way_fee', 'Tek yön ücreti (₺)', 'number', 'c3')}
        ${f('fuel_price_per_eighth', 'Yakıt farkı (₺ / 1/8 depo)', 'number', 'c3')}
        ${f('late_fee_multiplier', 'Geç iade gün çarpanı', 'number', 'c3')}
        ${f('vat_rate', 'KDV oranı (%)', 'number', 'c3')}
        <div class="form-section">Sürücü kuralları</div>
        ${f('min_driver_age', 'Minimum sürücü yaşı', 'number', 'c3')}
        ${f('min_license_years', 'Minimum ehliyet yılı', 'number', 'c3')}
        ${f('contract_terms', 'Sözleşme genel şartları', 'textarea', 'c12')}
      </div>${admin ? html`<div class="modal-foot"><button class="primary" type="submit">Kaydet</button></div>` : ''}</form>`,
    );
    panel.querySelector('#sf').onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        await api('PUT', '/api/settings', data);
        toast('Ayarlar kaydedildi');
        await loadLookups();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  if (tab === 'branches') {
    setView(
      panel,
      html`${admin ? html`<div class="actions mb"><button class="primary" id="add">+ Şube</button></div>` : ''}
      <div class="card">${table(
        ['Şube', 'Şehir', 'Adres', 'Telefon', 'Durum', ''],
        state.branches.map(
          (b) => html`<tr><td><strong>${b.name}</strong></td><td>${b.city}</td><td>${b.address}</td><td>${b.phone}</td>
            <td>${b.active ? html`<span class="badge ok">Aktif</span>` : html`<span class="badge">Pasif</span>`}</td>
            <td class="right">${admin ? html`<button class="sm" data-edit="${b.id}">Düzenle</button> <button class="sm danger" data-del="${b.id}">Sil</button>` : ''}</td></tr>`,
        ),
      )}</div>`,
    );
    const modal = (b) =>
      openModal({
        title: b ? 'Şube düzenle' : 'Yeni şube',
        body: html`<div class="form-grid">
          ${field('Şube adı *', html`<input name="name" value="${b?.name}" required />`)}${field('Şehir', html`<input name="city" value="${b?.city}" />`)}
          ${field('Telefon', html`<input name="phone" value="${b?.phone}" />`)}
          <label class="check"><input type="checkbox" name="active" ${!b || b.active ? 'checked' : ''} /> Aktif</label>
          ${field('Adres', html`<input name="address" value="${b?.address}" />`, 'c12')}</div>`,
        onSubmit: async (data) => {
          if (b) await api('PUT', `/api/branches/${b.id}`, data);
          else await api('POST', '/api/branches', data);
          toast('Şube kaydedildi');
          reload();
        },
      });
    panel.querySelector('#add')?.addEventListener('click', () => modal());
    panel.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => modal(state.branches.find((x) => x.id == b.dataset.edit))));
    panel.querySelectorAll('[data-del]').forEach(
      (b) =>
        (b.onclick = async () => {
          if (!(await confirmDialog('Şube silinsin mi? (Kullanımdaysa pasife alınır)', { okLabel: 'Sil' }))) return;
          await api('DELETE', `/api/branches/${b.dataset.del}`);
          reload();
        }),
    );
  }

  if (tab === 'extras') {
    setView(
      panel,
      html`${admin ? html`<div class="actions mb"><button class="primary" id="add">+ Ek hizmet</button></div>` : ''}
      <div class="card">${table(
        ['Hizmet', 'Fiyat tipi', ['Fiyat', 'num'], ['Üst limit', 'num'], 'Durum', ''],
        state.extras.map(
          (x) => html`<tr><td><strong>${x.name}</strong></td><td>${x.price_type === 'daily' ? 'Günlük' : 'Kiralama başı'}</td>
            <td class="num">${money(x.price)}</td><td class="num">${x.max_price ? money(x.max_price) : '—'}</td>
            <td>${x.active ? html`<span class="badge ok">Aktif</span>` : html`<span class="badge">Pasif</span>`}</td>
            <td class="right">${admin ? html`<button class="sm" data-edit="${x.id}">Düzenle</button> <button class="sm danger" data-del="${x.id}">Sil</button>` : ''}</td></tr>`,
        ),
      )}</div>`,
    );
    const modal = (x) =>
      openModal({
        title: x ? 'Ek hizmet düzenle' : 'Yeni ek hizmet',
        body: html`<div class="form-grid">
          ${field('Ad *', html`<input name="name" value="${x?.name}" required />`)}
          ${field('Fiyat tipi', html`<select name="price_type">${options([['daily', 'Günlük'], ['per_rental', 'Kiralama başı']], x?.price_type || 'daily')}</select>`)}
          ${field('Fiyat (₺)', html`<input type="number" step="0.01" name="price" value="${x?.price}" />`)}
          ${field('Üst limit (₺, opsiyonel)', html`<input type="number" step="0.01" name="max_price" value="${x?.max_price}" />`)}
          <label class="check"><input type="checkbox" name="active" ${!x || x.active ? 'checked' : ''} /> Aktif</label></div>`,
        onSubmit: async (data) => {
          if (x) await api('PUT', `/api/extras/${x.id}`, data);
          else await api('POST', '/api/extras', data);
          toast('Kaydedildi');
          reload();
        },
      });
    panel.querySelector('#add')?.addEventListener('click', () => modal());
    panel.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => modal(state.extras.find((x) => x.id == b.dataset.edit))));
    panel.querySelectorAll('[data-del]').forEach(
      (b) =>
        (b.onclick = async () => {
          if (!(await confirmDialog('Ek hizmet silinsin mi? (Kullanımdaysa pasife alınır)', { okLabel: 'Sil' }))) return;
          await api('DELETE', `/api/extras/${b.dataset.del}`);
          reload();
        }),
    );
  }

  if (tab === 'users' && admin) {
    const users = await api('GET', '/api/users');
    setView(
      panel,
      html`<div class="actions mb"><button class="primary" id="add">+ Kullanıcı</button></div>
      <div class="card">${table(
        ['Kullanıcı adı', 'Ad soyad', 'Rol', 'Durum', ''],
        users.map(
          (u) => html`<tr><td><strong>${u.username}</strong></td><td>${u.full_name}</td><td>${LABELS.role[u.role]}</td>
            <td>${u.active ? html`<span class="badge ok">Aktif</span>` : html`<span class="badge">Pasif</span>`}</td>
            <td class="right"><button class="sm" data-edit="${u.id}">Düzenle</button></td></tr>`,
        ),
      )}</div>`,
    );
    const modal = (u) =>
      openModal({
        title: u ? `${u.username} düzenle` : 'Yeni kullanıcı',
        body: html`<div class="form-grid">
          ${u ? '' : field('Kullanıcı adı *', html`<input name="username" required />`)}
          ${field('Ad soyad *', html`<input name="full_name" value="${u?.full_name}" required />`)}
          ${field('Rol', html`<select name="role">${options([['staff', 'Personel'], ['admin', 'Yönetici']], u?.role || 'staff')}</select>`)}
          ${field(u ? 'Yeni şifre (boş = değişmez)' : 'Şifre * (en az 6 karakter)', html`<input type="password" name="password" autocomplete="new-password" />`)}
          <label class="check"><input type="checkbox" name="active" ${!u || u.active ? 'checked' : ''} /> Aktif</label></div>`,
        onSubmit: async (data) => {
          if (u) await api('PUT', `/api/users/${u.id}`, data);
          else await api('POST', '/api/users', data);
          toast('Kullanıcı kaydedildi');
          reload();
        },
      });
    panel.querySelector('#add').onclick = () => modal();
    panel.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => modal(users.find((x) => x.id == b.dataset.edit))));
  }

  if (tab === 'account') {
    setView(
      panel,
      html`<div class="card" style="max-width:520px"><div class="card-body">
        <dl class="kv mb"><dt>Kullanıcı</dt><dd>${state.user.username}</dd><dt>Ad soyad</dt><dd>${state.user.full_name}</dd><dt>Rol</dt><dd>${LABELS.role[state.user.role]}</dd></dl>
        <button class="primary" id="pw">Şifremi değiştir</button>
      </div></div>`,
    );
    panel.querySelector('#pw')?.addEventListener('click', () =>
      openModal({
        title: 'Şifre değiştir',
        body: html`<div class="form-grid">
          ${field('Mevcut şifre', html`<input type="password" name="current_password" autocomplete="current-password" required />`, 'c12')}
          ${field('Yeni şifre (en az 6 karakter)', html`<input type="password" name="new_password" autocomplete="new-password" required />`, 'c12')}</div>`,
        onSubmit: async (data) => {
          await api('POST', '/api/auth/password', data);
          toast('Şifre değiştirildi');
        },
      }),
    );
  }
}
