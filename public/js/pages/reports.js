import { api, html, setView, money, numf, table, qs, todayStr, LABELS } from '../core.js';

export async function render(el, { query }) {
  const to = query.to || todayStr();
  const from = query.from || to.slice(0, 8) + '01';
  const r = await api('GET', '/api/reports?' + qs({ from, to }));
  const s = r.summary;
  const resLabel = Object.fromEntries(Object.entries(LABELS.reservationStatus).map(([k, v]) => [k, v[0]]));
  const presets = [
    ['Bu ay', todayStr().slice(0, 8) + '01', todayStr()],
    ['Son 30 gün', shift(-30), todayStr()],
    ['Son 90 gün', shift(-90), todayStr()],
    ['Bu yıl', todayStr().slice(0, 4) + '-01-01', todayStr()],
  ];
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Raporlar</h1><div class="sub">Gelir, gider, doluluk ve araç karlılığı</div></div>
      <div class="actions">
        ${presets.map(([l, f, t]) => html`<a class="btn" href="#/reports?${qs({ from: f, to: t })}">${l}</a>`)}
        <input type="date" id="from" value="${r.from}" style="width:auto" /><input type="date" id="to" value="${r.to}" style="width:auto" />
        <button id="csv">CSV indir</button>
      </div>
    </div>
    <div class="grid grid-4 mb">
      ${tile('Net tahsilat', money(s.collected), `${r.period_days} günlük dönem`)}
      ${tile('Faturalanan (kiralama toplamı)', money(s.billed), `${s.rentals} kiralama · ${numf(s.rented_days)} gün`)}
      ${tile('Toplam gider', money(s.expenses), `Bakım: ${money(s.maintenance_cost)}`)}
      ${tile('Net kâr (tahsilat − gider)', html`<span class="${s.net_profit < 0 ? 'danger-text' : 'ok-text'}">${money(s.net_profit)}</span>`)}
      ${tile('Ortalama günlük gelir', money(s.avg_daily_revenue))}
      ${tile('Filo doluluğu (ort.)', `%${s.fleet_utilization}`)}
      ${tile('Ek hizmet geliri', money(s.extras))}
      ${tile('Ek ücretler (gecikme, km, hasar…)', money(s.charges))}
    </div>
    <div class="grid grid-3 mb">
      <div class="card"><div class="card-head"><h2>Ödeme yöntemleri</h2></div><div class="card-body">
        ${Object.keys(r.by_method).length ? Object.entries(r.by_method).map(([k, v]) => html`<div class="sum-row"><span>${LABELS.method[k]}</span><span>${money(v)}</span></div>`) : html`<div class="muted">Veri yok</div>`}
      </div></div>
      <div class="card"><div class="card-head"><h2>Gider dağılımı</h2></div><div class="card-body">
        ${r.expenses_by_category.filter((e) => e.total).map((e) => html`<div class="sum-row"><span>${e.category}</span><span>${money(e.total)}</span></div>`)}
      </div></div>
      <div class="card"><div class="card-head"><h2>Rezervasyonlar</h2></div><div class="card-body">
        ${r.reservation_stats.length ? r.reservation_stats.map((x) => html`<div class="sum-row"><span>${resLabel[x.status]}</span><span>${x.n}</span></div>`) : html`<div class="muted">Veri yok</div>`}
      </div></div>
    </div>
    <div class="card mb"><div class="card-head"><h2>Araç bazında performans</h2></div>
      ${table(
        ['Araç', 'Kategori', ['Kiralama', 'num'], ['Kiralanan gün', 'num'], 'Doluluk', ['Gelir', 'num'], ['Gider', 'num'], ['Katkı', 'num']],
        [...r.by_vehicle].sort((a, b) => b.revenue - a.revenue).map(
          (v) => html`<tr class="click" onclick="location.hash='#/vehicles/${v.id}'"><td><strong>${v.plate}</strong> <span class="muted small">${v.brand} ${v.model}</span></td>
            <td>${v.category}</td><td class="num">${v.rentals}</td><td class="num">${v.rented_days}</td>
            <td><div style="display:flex;gap:8px;align-items:center"><div class="hbar" style="flex:1"><i style="width:${v.utilization}%"></i></div><span class="small nowrap">%${v.utilization}</span></div></td>
            <td class="num">${money(v.revenue)}</td><td class="num">${money(v.cost)}</td><td class="num ${v.profit < 0 ? 'danger-text' : ''}">${money(v.profit)}</td></tr>`,
        ),
      )}
    </div>
    <div class="grid grid-2">
      <div class="card"><div class="card-head"><h2>Kategori bazında</h2></div>
        ${table(['Kategori', ['Araç', 'num'], ['Kiralanan gün', 'num'], ['Gelir', 'num']], r.by_category.map((c) => html`<tr><td>${c.category}</td><td class="num">${c.vehicles}</td><td class="num">${c.rented_days}</td><td class="num">${money(c.revenue)}</td></tr>`))}
      </div>
      <div class="card"><div class="card-head"><h2>En çok kiralayan müşteriler</h2></div>
        ${table(['Müşteri', ['Kiralama', 'num'], ['Toplam', 'num']], r.top_customers.map((c) => html`<tr class="click" onclick="location.hash='#/customers/${c.id}'"><td>${c.name}</td><td class="num">${c.rentals}</td><td class="num">${money(c.total)}</td></tr>`))}
      </div>
    </div>`,
  );
  const go = () => (location.hash = '#/reports?' + qs({ from: el.querySelector('#from').value, to: el.querySelector('#to').value }));
  el.querySelector('#from').onchange = go;
  el.querySelector('#to').onchange = go;
  el.querySelector('#csv').onclick = () => {
    const head = ['Plaka', 'Marka', 'Model', 'Kategori', 'Kiralama', 'Kiralanan gün', 'Doluluk %', 'Gelir', 'Gider', 'Katkı'];
    const lines = r.by_vehicle.map((v) => [v.plate, v.brand, v.model, v.category, v.rentals, v.rented_days, v.utilization, v.revenue, v.cost, v.profit]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `arac-raporu_${r.from}_${r.to}.csv`;
    a.click();
  };
}

function tile(label, value, hint = '') {
  return html`<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
}

function shift(n) {
  const x = new Date();
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString('sv-SE');
}
