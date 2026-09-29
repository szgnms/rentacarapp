import { api, html, setView, money, dt, table, badge } from '../core.js';
import { barChart } from './chart.js';

export async function render(el) {
  const d = await api('GET', '/api/dashboard');
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  setView(
    el,
    html`<div class="page-head">
      <div><h1>Gösterge Paneli</h1><div class="sub">Günün özeti ve filo durumu</div></div>
      <div class="actions"><a class="btn primary" href="#/booking">+ Yeni kiralama / rezervasyon</a></div>
    </div>

    <div class="grid grid-4 mb">
      ${stat('Filo doluluğu', `%${d.fleet.utilization}`, `${d.fleet.rented} kirada / ${d.fleet.total} araç`)}
      ${stat('Aktif kiralama', d.counts.active_rentals, d.counts.overdue_rentals ? html`<span class="danger-text">${d.counts.overdue_rentals} gecikmiş iade</span>` : 'Gecikme yok')}
      ${stat('Bu ay tahsilat', money(d.revenue.month), `Bugün: ${money(d.revenue.today)}`)}
      ${stat('Açık alacak', money(d.receivables), 'Tüm kiralamalardan kalan bakiye')}
    </div>

    <div class="grid grid-4 mb">
      ${stat('Müsait araç', d.fleet.available, '')}
      ${stat('Bakımda', d.fleet.maintenance, d.fleet.out_of_service ? `${d.fleet.out_of_service} hizmet dışı` : '')}
      ${stat('Yaklaşan rezervasyon', d.counts.upcoming_reservations, d.counts.pending_reservations ? `${d.counts.pending_reservations} onay bekliyor` : '')}
      ${stat('Açık hasar kaydı', d.counts.open_damages, `${d.counts.customers} kayıtlı müşteri`)}
    </div>

    <div class="grid grid-2 mb">
      <div class="card">
        <div class="card-head"><h2>Bugün teslim edilecekler</h2><a href="#/reservations?status=confirmed">Tümü</a></div>
        ${table(
          ['Rezervasyon', 'Müşteri', 'Araç', 'Saat', ''],
          d.pickups_today.map(
            (r) => html`<tr class="click" onclick="location.hash='#/reservations/${r.id}'">
              <td>${r.code}</td><td>${r.customer_name}</td><td>${r.plate}<div class="muted small">${r.brand} ${r.model}</div></td>
              <td class="nowrap">${dt(r.pickup_at)}</td><td>${badge('reservationStatus', r.status)}</td></tr>`,
          ),
          { empty: 'Bugün teslim yok' },
        )}
      </div>
      <div class="card">
        <div class="card-head"><h2>Bugün / gecikmiş iadeler</h2><a href="#/rentals?status=active">Tümü</a></div>
        ${table(
          ['Sözleşme', 'Müşteri', 'Araç', 'Dönüş', ''],
          d.returns_today.map(
            (r) => html`<tr class="click" onclick="location.hash='#/rentals/${r.id}'">
              <td>${r.contract_no}</td><td>${r.customer_name}<div class="muted small">${r.phone}</div></td><td>${r.plate}</td>
              <td class="nowrap">${dt(r.planned_return_at)}</td><td>${r.overdue ? html`<span class="badge danger">Gecikmiş</span>` : html`<span class="badge info">Bugün</span>`}</td></tr>`,
          ),
          { empty: 'Bugün iade yok' },
        )}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>Son 6 ay: tahsilat ve gider</h2><a href="#/reports">Raporlar</a></div>
        <div class="card-body" id="dash-chart"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Uyarılar</h2><span class="badge ${d.alerts.length ? 'warn' : 'ok'}">${d.alerts.length}</span></div>
        <div class="card-body">
          ${d.alerts.length
            ? d.alerts.map(
                (a) => html`<div class="alert ${a.level}"><a href="#/vehicles/${a.vehicle_id}"><strong>${a.plate}</strong></a> — ${a.level === 'danger' ? '⛔' : '⚠️'} ${a.message}</div>`,
              )
            : html`<div class="muted">Sigorta, muayene ve bakım uyarısı yok.</div>`}
        </div>
      </div>
    </div>`,
  );
  barChart(el.querySelector('#dash-chart'), {
    rows: d.monthly.map((m) => ({ label: `${months[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}`, revenue: m.revenue, expenses: m.expenses })),
    series: [
      { key: 'revenue', label: 'Tahsilat', cls: 'bar-1' },
      { key: 'expenses', label: 'Gider (masraf + bakım)', cls: 'bar-2' },
    ],
    format: money,
  });
}

function stat(label, value, hint) {
  return html`<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
}
