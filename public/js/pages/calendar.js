import { api, html, setView, qs, todayStr, dt, LABELS } from '../core.js';

export async function render(el, { query }) {
  const from = query.from || todayStr();
  const days = Number(query.days) || 14;
  const data = await api('GET', '/api/calendar?' + qs({ from, days }));
  const dayList = Array.from({ length: days }, (_, i) => {
    const x = new Date(from + 'T00:00');
    x.setDate(x.getDate() + i);
    const pad = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  });
  const shift = (n) => {
    const x = new Date(from + 'T00:00');
    x.setDate(x.getDate() + n);
    return x.toLocaleDateString('sv-SE');
  };
  const wd = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const today = todayStr();

  const cellFor = (vehicleId, day) => {
    const s = day + 'T00:00';
    const e = day + 'T23:59';
    const ev = data.events.find((x) => x.vehicle_id === vehicleId && x.start <= e && x.end > s);
    if (!ev) return html`<td></td>`;
    let cls = `ev-${ev.kind}`;
    if (ev.kind === 'rental' && ev.overdue && day >= ev.planned_return_at?.slice(0, 10)) cls = 'ev-overdue';
    if (ev.kind === 'rental' && ev.status === 'completed') cls = 'ev-completed';
    const title =
      ev.kind === 'maintenance'
        ? `Bakım: ${LABELS.maintenanceType[ev.label] || ev.label}`
        : `${ev.label} · ${ev.customer_name}\n${dt(ev.start)} → ${dt(ev.end)}`;
    const href = ev.kind === 'reservation' ? `#/reservations/${ev.id}` : ev.kind === 'rental' ? `#/rentals/${ev.id}` : '#/maintenance';
    return html`<td><a class="cell ${cls}" href="${href}" title="${title}"></a></td>`;
  };

  setView(
    el,
    html`<div class="page-head">
      <div><h1>Filo Takvimi</h1><div class="sub">Araç bazında rezervasyon, kiralama ve bakım doluluğu</div></div>
      <div class="actions">
        <a class="btn" href="#/calendar?${qs({ from: shift(-7), days })}">← 1 hafta</a>
        <a class="btn" href="#/calendar?${qs({ from: todayStr(), days })}">Bugün</a>
        <a class="btn" href="#/calendar?${qs({ from: shift(7), days })}">1 hafta →</a>
        <select id="days" style="width:auto">${[7, 14, 30].map((n) => html`<option value="${n}" ${n === days ? 'selected' : ''}>${n} gün</option>`)}</select>
      </div>
    </div>
    <div class="legend mb">
      <span style="--c:#86efac">Aktif kiralama</span><span style="--c:#93c5fd">Rezervasyon</span>
      <span style="--c:#fca5a5">Gecikmiş iade</span><span style="--c:#fcd34d">Bakım</span><span style="--c:#d1d5db">Tamamlanan</span>
    </div>
    <div class="card table-wrap">
      <table class="cal">
        <thead><tr><th class="veh">Araç</th>${dayList.map((d) => {
          const x = new Date(d + 'T00:00');
          return html`<th class="${d === today ? 'today' : ''}">${wd[x.getDay()]}<br />${d.slice(8)}.${d.slice(5, 7)}</th>`;
        })}</tr></thead>
        <tbody>${data.vehicles.map(
          (v) => html`<tr><td class="veh"><a href="#/vehicles/${v.id}"><strong>${v.plate}</strong></a><div class="muted small">${v.brand} ${v.model} · ${v.category}</div></td>
            ${dayList.map((d) => cellFor(v.id, d))}</tr>`,
        )}</tbody>
      </table>
    </div>`,
  );
  el.querySelector('#days').onchange = (e) => (location.hash = '#/calendar?' + qs({ from, days: e.target.value }));
}
