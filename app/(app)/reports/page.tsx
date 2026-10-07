import type { Metadata } from 'next';
import Link from 'next/link';
import { reports } from '@/lib/domain/reports';
import { labelText, money, numf, qs, shiftDate, text, todayStr } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { Card, PageHead, Stat, SumRow, Table } from '@/components/ui';
import { ClickRow } from '@/components/client/Filters';
import { ReportControls } from '@/components/client/ReportControls';

export const metadata: Metadata = { title: 'Raporlar' };

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePerm('reports.view');
  const r = await reports(await flat(searchParams));
  const k = r.kpis;
  const s = r.summary;
  const t = todayStr();
  const presets: [string, string, string][] = [
    ['Bu ay', t.slice(0, 8) + '01', t],
    ['Son 30 gün', shiftDate(t, -30), t],
    ['Son 90 gün', shiftDate(t, -90), t],
    ['Bu yıl', t.slice(0, 4) + '-01-01', t],
  ];
  return (
    <>
      <PageHead
        title="Raporlar"
        sub="Gelir, gider, doluluk ve araç karlılığı"
        actions={
          <>
            {presets.map(([l, f, to]) => <Link key={l} className="btn" href={`/reports?${qs({ from: f, to })}`}>{l}</Link>)}
            <ReportControls key={`${r.from}_${r.to}`} from={r.from} to={r.to} rows={r.by_vehicle} />
          </>
        }
      />
      <div className="grid grid-4 mb">
        <Stat label="Net tahsilat" value={money(s.collected)} hint={`${r.period_days} günlük dönem`} />
        <Stat label="Faturalanan (kiralama toplamı)" value={money(s.billed)} hint={`${s.rentals} kiralama · ${numf(s.rented_days)} gün`} />
        <Stat label="Toplam gider" value={money(s.expenses)} hint={`Bakım: ${money(s.maintenance_cost)}`} />
        <Stat label="Net kâr (tahsilat − gider)" value={money(s.net_profit)} valueClass={s.net_profit < 0 ? 'danger-text' : 'ok-text'} />
        <Stat label="Ortalama günlük gelir" value={money(s.avg_daily_revenue)} />
        <Stat label="Filo doluluğu (ort.)" value={`%${s.fleet_utilization}`} />
        <Stat label="Ek hizmet geliri" value={money(s.extras)} />
        <Stat label="Ek ücretler (gecikme, km, hasar…)" value={money(s.charges)} />
      </div>
      <Card title="Sektör KPI'ları" className="mb">
        <div className="card-body grid grid-4">
          <Stat label="Doluluk (utilization)" value={`%${k.utilization}`} hint="Kiralanan gün / (filo × dönem)" />
          <Stat label="ADR (ort. günlük fiyat)" value={money(k.adr)} />
          <Stat label="RevPAU (araç başı günlük gelir)" value={money(k.revpau)} />
          <Stat label="NPS" value={k.nps.nps === null ? '—' : k.nps.nps} hint={`${k.nps.responses} yanıt`} />
          <Stat label="İptal oranı" value={`%${k.cancel_rate}`} />
          <Stat label="No-show oranı" value={`%${k.no_show_rate}`} />
          <Stat label="Hasar / 100 kiralama" value={k.damage_per_100_rentals} hint={`${k.damage_count} hasar · ${k.damage_per_10k_km} / 10.000 km`} />
          <Stat label="Hasar maliyeti / tahsil" value={money(k.damage_cost)} hint={`Müşteriye yansıyan: ${money(k.damage_recovered)}`} />
          <Stat label="HGS tahsil oranı" value={`%${k.toll_collection_rate}`} hint={`Toplam geçiş ${money(k.toll_total)}`} />
          <Stat label="Ceza tahsil oranı" value={`%${k.fine_collection_rate}`} hint={`Toplam ceza ${money(k.fine_total)}`} />
          <Stat label="Yakıt farkı geliri" value={money(k.fuel_charges)} />
        </div>
      </Card>
      <div className="grid grid-3 mb">
        <Card title="Şube performansı">
          <Table cols={['Şube', ['Kiralama', 'num'], ['Gün', 'num'], ['Ciro', 'num']]} count={r.by_branch.length}>
            {r.by_branch.map((b) => <tr key={b.branch}><td>{b.branch}</td><td className="num">{b.rentals}</td><td className="num">{numf(b.days)}</td><td className="num">{money(b.revenue)}</td></tr>)}
          </Table>
        </Card>
        <Card title="Kanal performansı">
          <Table cols={['Kanal', ['Kiralama', 'num'], ['Ciro', 'num'], ['Komisyon', 'num']]} count={r.by_channel.length}>
            {r.by_channel.map((c) => <tr key={c.channel}><td>{c.channel}</td><td className="num">{c.rentals}</td><td className="num">{money(c.revenue)}</td><td className="num">{money(c.commission)}</td></tr>)}
          </Table>
        </Card>
        <Card title="Personel (teslim / iade)">
          <Table cols={['Personel', ['Teslim', 'num'], ['İade', 'num']]} count={r.by_staff.length}>
            {r.by_staff.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{x.checkouts}</td><td className="num">{x.checkins}</td></tr>)}
          </Table>
        </Card>
      </div>
      <div className="grid grid-3 mb">
        <Card title="Ödeme yöntemleri">
          <div className="card-body">
            {Object.keys(r.by_method).length
              ? Object.entries(r.by_method).map(([k, v]) => <SumRow key={k} label={text('method', k)} value={money(v)} />)
              : <div className="muted">Veri yok</div>}
          </div>
        </Card>
        <Card title="Gider dağılımı">
          <div className="card-body">
            {r.expenses_by_category.filter((e) => e.total).map((e) => <SumRow key={e.category} label={e.category} value={money(e.total)} />)}
            {!r.expenses_by_category.some((e) => e.total) ? <div className="muted">Veri yok</div> : null}
          </div>
        </Card>
        <Card title="Rezervasyonlar">
          <div className="card-body">
            {r.reservation_stats.length
              ? r.reservation_stats.map((x) => <SumRow key={x.status} label={labelText('reservationStatus', x.status)} value={x.n} />)
              : <div className="muted">Veri yok</div>}
          </div>
        </Card>
      </div>
      <Card title="Araç bazında performans" className="mb">
        <Table cols={['Araç', 'Kategori', ['Kiralama', 'num'], ['Kiralanan gün', 'num'], 'Doluluk', ['Gelir', 'num'], ['Gider', 'num'], ['Katkı', 'num']]} count={r.by_vehicle.length}>
          {([...r.by_vehicle].sort((a, b) => b.revenue - a.revenue)).map((v) => (
            <ClickRow key={v.id} href={`/vehicles/${v.id}`}>
              <td><strong>{v.plate}</strong> <span className="muted small">{v.brand} {v.model}</span></td>
              <td>{v.category}</td>
              <td className="num">{v.rentals}</td>
              <td className="num">{v.rented_days}</td>
              <td>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="hbar" style={{ flex: 1 }}><i style={{ width: `${v.utilization}%` }} /></div>
                  <span className="small nowrap">%{v.utilization}</span>
                </div>
              </td>
              <td className="num">{money(v.revenue)}</td>
              <td className="num">{money(v.cost)}</td>
              <td className={`num ${v.profit < 0 ? 'danger-text' : ''}`}>{money(v.profit)}</td>
            </ClickRow>
          ))}
        </Table>
      </Card>
      <div className="grid grid-2">
        <Card title="Kategori bazında">
          <Table cols={['Kategori', ['Araç', 'num'], ['Kiralanan gün', 'num'], ['Gelir', 'num']]} count={r.by_category.length}>
            {r.by_category.map((c) => (
              <tr key={c.category}><td>{c.category}</td><td className="num">{c.vehicles}</td><td className="num">{c.rented_days}</td><td className="num">{money(c.revenue)}</td></tr>
            ))}
          </Table>
        </Card>
        <Card title="En çok kiralayan müşteriler">
          <Table cols={['Müşteri', ['Kiralama', 'num'], ['Toplam', 'num']]} count={r.top_customers.length}>
            {r.top_customers.map((c) => (
              <ClickRow key={c.id} href={`/customers/${c.id}`}><td>{c.name}</td><td className="num">{c.rentals}</td><td className="num">{money(c.total)}</td></ClickRow>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
