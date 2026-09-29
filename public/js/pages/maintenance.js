import {
  api, html, setView, money, numf, d, table, badge, options, mapOptions, LABELS, field, openModal, toast, confirmDialog,
  qs, isAdmin, todayStr,
} from '../core.js';

async function vehicleOptions(selected) {
  const vs = await api('GET', '/api/vehicles');
  return options(vs.map((v) => [v.id, `${v.plate} · ${v.brand} ${v.model}`]), selected, { empty: 'Araç seçin' });
}

export async function maintenanceModal(m, defaults, onDone) {
  const x = m || { type: 'periodic', status: 'scheduled', start_date: todayStr(), ...defaults };
  openModal({
    title: m ? 'Bakım kaydı' : 'Yeni bakım kaydı',
    wide: true,
    body: html`<div class="form-grid">
      ${field('Araç *', html`<select name="vehicle_id" required>${await vehicleOptions(x.vehicle_id)}</select>`, 'c6')}
      ${field('Tip', html`<select name="type">${options(Object.entries(LABELS.maintenanceType), x.type)}</select>`, 'c3')}
      ${field('Durum', html`<select name="status">${options(mapOptions(LABELS.maintenanceStatus), x.status)}</select>`, 'c3')}
      ${field('Başlangıç', html`<input type="date" name="start_date" value="${x.start_date}" />`, 'c3')}
      ${field('Bitiş', html`<input type="date" name="end_date" value="${x.end_date}" />`, 'c3')}
      ${field('Km', html`<input type="number" name="km" value="${x.km}" />`, 'c3')}
      ${field('Maliyet (₺)', html`<input type="number" step="0.01" name="cost" value="${x.cost}" />`, 'c3')}
      ${field('Servis / firma', html`<input name="vendor" value="${x.vendor}" />`, 'c6')}
      ${field('Açıklama', html`<input name="description" value="${x.description}" />`, 'c6')}
      <div class="c12 muted small">"Devam ediyor" durumundaki bakım aracı <strong>Bakımda</strong> durumuna alır; planlanan bakımlar tarih aralığında rezervasyonu engeller. Tamamlandığında araç yeniden müsait olur.</div>
    </div>`,
    onSubmit: async (data) => {
      if (m) await api('PUT', `/api/maintenance/${m.id}`, data);
      else await api('POST', '/api/maintenance', data);
      toast('Bakım kaydı kaydedildi');
      onDone();
    },
  });
}

export async function damageModal(dm, defaults, onDone) {
  const x = dm || { severity: 'minor', status: 'open', reported_at: todayStr(), ...defaults };
  openModal({
    title: dm ? 'Hasar kaydı' : 'Yeni hasar kaydı',
    wide: true,
    body: html`<div class="form-grid">
      ${field('Araç *', html`<select name="vehicle_id" required>${await vehicleOptions(x.vehicle_id)}</select>`, 'c6')}
      ${field('Tarih', html`<input type="date" name="reported_at" value="${x.reported_at}" />`, 'c3')}
      ${field('Önem', html`<select name="severity">${options(mapOptions(LABELS.severity), x.severity)}</select>`, 'c3')}
      ${field('Konum', html`<input name="location" value="${x.location}" placeholder="Sol arka kapı" />`, 'c4')}
      ${field('Açıklama *', html`<input name="description" value="${x.description}" required />`, 'c8')}
      ${field('Onarım maliyeti (₺)', html`<input type="number" step="0.01" name="repair_cost" value="${x.repair_cost}" />`, 'c3')}
      ${field('Müşteriye yansıyan (₺)', html`<input type="number" step="0.01" name="customer_charge" value="${x.customer_charge}" />`, 'c3')}
      ${field('Durum', html`<select name="status">${options(mapOptions(LABELS.damageStatus), x.status)}</select>`, 'c3')}
      <label class="check c3"><input type="checkbox" name="insurance_claim" ${x.insurance_claim ? 'checked' : ''} /> Sigorta/kasko dosyası</label>
      ${x.rental_id ? html`<input type="hidden" name="rental_id" value="${x.rental_id}" />` : ''}
    </div>`,
    onSubmit: async (data) => {
      if (dm) await api('PUT', `/api/damages/${dm.id}`, data);
      else await api('POST', '/api/damages', data);
      toast('Hasar kaydı kaydedildi');
      onDone();
    },
  });
}

export async function render(el, { query }) {
  const tab = query.tab || 'maintenance';
  const status = query.status || '';
  const isM = tab === 'maintenance';
  const rows = await api('GET', `/api/${isM ? 'maintenance' : 'damages'}?` + qs({ status }));
  const reload = () => window.dispatchEvent(new Event('refresh-view'));
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Bakım & Hasar</h1><div class="sub">Servis kayıtları, onarımlar ve hasar takibi</div></div>
      <div class="actions"><button class="primary" id="add">+ ${isM ? 'Bakım kaydı' : 'Hasar kaydı'}</button></div>
    </div>
    <div class="tabs">
      <button class="${isM ? 'active' : ''}" onclick="location.hash='#/maintenance?tab=maintenance'">🔧 Bakım</button>
      <button class="${!isM ? 'active' : ''}" onclick="location.hash='#/maintenance?tab=damages'">💥 Hasar</button>
    </div>
    <div class="filters"><select id="st">${options(mapOptions(isM ? LABELS.maintenanceStatus : LABELS.damageStatus), status, { empty: 'Tüm durumlar' })}</select></div>
    <div class="card">
      ${isM
        ? table(
            ['Araç', 'Tarih', 'Tip', 'Açıklama', 'Servis', ['Km', 'num'], ['Maliyet', 'num'], 'Durum', ''],
            rows.map(
              (m) => html`<tr class="click" data-id="${m.id}"><td><strong>${m.plate}</strong><div class="muted small">${m.brand} ${m.model}</div></td>
                <td class="nowrap">${d(m.start_date)}${m.end_date && m.end_date !== m.start_date ? html`<div class="muted small">→ ${d(m.end_date)}</div>` : ''}</td>
                <td>${LABELS.maintenanceType[m.type]}</td><td>${m.description}</td><td>${m.vendor}</td>
                <td class="num">${m.km ? numf(m.km) : ''}</td><td class="num">${money(m.cost)}</td><td>${badge('maintenanceStatus', m.status)}</td>
                <td class="right nowrap">${m.status === 'scheduled' ? html`<button class="sm" data-start="${m.id}">Başlat</button>` : ''}
                  ${['scheduled', 'in_progress'].includes(m.status) ? html`<button class="sm" data-done="${m.id}">Tamamla</button>` : ''}
                  ${isAdmin() ? html`<button class="sm danger" data-del="${m.id}">Sil</button>` : ''}</td></tr>`,
            ),
          )
        : table(
            ['Araç', 'Tarih', 'Konum', 'Açıklama', 'Önem', 'Sözleşme', ['Onarım', 'num'], ['Müşteriye', 'num'], 'Durum', ''],
            rows.map(
              (x) => html`<tr class="click" data-id="${x.id}"><td><strong>${x.plate}</strong></td><td>${d(x.reported_at)}</td><td>${x.location}</td>
                <td>${x.description}${x.insurance_claim ? html` <span class="badge violet">Sigorta</span>` : ''}</td><td>${badge('severity', x.severity)}</td>
                <td>${x.contract_no ? html`<a href="#/rentals/${x.rental_id}" onclick="event.stopPropagation()">${x.contract_no}</a><div class="muted small">${x.customer_name}</div>` : '—'}</td>
                <td class="num">${money(x.repair_cost)}</td><td class="num">${money(x.customer_charge)}</td><td>${badge('damageStatus', x.status)}</td>
                <td class="right">${isAdmin() ? html`<button class="sm danger" data-del="${x.id}">Sil</button>` : ''}</td></tr>`,
            ),
          )}
    </div>`,
  );
  el.querySelector('#st').onchange = (e) => (location.hash = '#/maintenance?' + qs({ tab, status: e.target.value }));
  el.querySelector('#add').onclick = () => (isM ? maintenanceModal(null, {}, reload) : damageModal(null, {}, reload));
  el.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('button')) return;
      const item = rows.find((x) => x.id == tr.dataset.id);
      isM ? maintenanceModal(item, {}, reload) : damageModal(item, {}, reload);
    };
  });
  const upd = async (id, body, msg) => {
    try {
      await api('PUT', `/api/maintenance/${id}`, body);
      toast(msg);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  el.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => upd(b.dataset.start, { status: 'in_progress' }, 'Bakım başlatıldı, araç bakımda')));
  el.querySelectorAll('[data-done]').forEach((b) => (b.onclick = () => upd(b.dataset.done, { status: 'completed' }, 'Bakım tamamlandı')));
  el.querySelectorAll('[data-del]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!(await confirmDialog('Kayıt silinsin mi?', { okLabel: 'Sil' }))) return;
        await api('DELETE', `/api/${isM ? 'maintenance' : 'damages'}/${b.dataset.del}`);
        toast('Silindi');
        reload();
      }),
  );
}
