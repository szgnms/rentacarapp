import type { Metadata } from 'next';
import Link from 'next/link';
import { dashboard } from '@/lib/domain/reports';
import { requireUser } from '@/lib/session';
import { can, scopedBranch } from '@/lib/permissions';
import { flat, type SearchParams } from '@/lib/page';
import { dt, money } from '@/lib/format';
import { Badge, Card, PageHead, Stat, Table, Tag } from '@/components/ui';
import { ClickRow } from '@/components/client/Filters';
import { BarChart } from '@/components/client/BarChart';

export const metadata: Metadata = { title: 'Gösterge Paneli' };

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, q] = await Promise.all([requireUser(), flat(searchParams)]);
  const d = dashboard(scopedBranch(user));
  return (
    <>
      <PageHead
        title="Gösterge Paneli"
        sub="Günün özeti ve filo durumu"
        actions={
          <>
            {can(user, 'rentals.operate') ? <Link className="btn" href="/field">📱 Günün işleri</Link> : null}
            {can(user, 'reservations.write') ? <Link className="btn primary" href="/booking">+ Yeni rezervasyon</Link> : null}
          </>
        }
      />
      {q.forbidden ? <div className="alert warn">Bu sayfaya erişim yetkiniz yok.</div> : null}
      <div className="grid grid-4 mb">
        <Stat label="Filo doluluğu" value={`%${d.fleet.utilization}`} hint={`${d.fleet.rented} kirada / ${d.fleet.total} araç`} />
        <Stat
          label="Aktif kiralama"
          value={d.counts.active_rentals}
          hint={d.counts.overdue_rentals ? <span className="danger-text">{d.counts.overdue_rentals} gecikmiş iade</span> : 'Gecikme yok'}
        />
        <Stat label="Bu ay tahsilat" value={money(d.revenue.month)} hint={`Bugün: ${money(d.revenue.today)}`} />
        <Stat label="Açık alacak" value={money(d.receivables)} hint="Tüm kiralamalardan kalan bakiye" />
      </div>
      <div className="grid grid-4 mb">
        <Stat label="Müsait araç" value={d.fleet.available} />
        <Stat label="Serviste / hasarlı" value={`${d.fleet.maintenance} / ${d.fleet.damaged}`} hint={[d.fleet.in_transfer ? `${d.fleet.in_transfer} transferde` : '', d.fleet.out_of_service ? `${d.fleet.out_of_service} hizmet dışı` : ''].filter(Boolean).join(' · ') || undefined} />
        <Stat label="Yaklaşan rezervasyon" value={d.counts.upcoming_reservations} hint={d.counts.pending_reservations ? `${d.counts.pending_reservations} onay bekliyor` : undefined} />
        <Stat label="Açık iş emri / hasar" value={`${d.counts.open_tasks} / ${d.counts.open_damages}`} hint={d.counts.draft_rentals ? `${d.counts.draft_rentals} teslim süreci devam ediyor` : `${d.counts.customers} kayıtlı müşteri`} />
      </div>

      <div className="grid grid-2 mb">
        <Card title="Bugün teslim edilecekler" actions={<Link href="/reservations?status=confirmed">Tümü</Link>}>
          <Table cols={['Rezervasyon', 'Müşteri', 'Araç', 'Saat', '']} count={d.pickups_today.length} empty="Bugün teslim yok">
            {d.pickups_today.map((r) => (
              <ClickRow key={r.id} href={r.rental_id ? `/rentals/${r.rental_id}/checkout` : `/reservations/${r.id}`}>
                <td>{r.code}</td>
                <td>{r.customer_name}</td>
                <td>{r.plate ?? <span className="badge warn">Araç atanmadı</span>}<div className="muted small">{r.category}</div></td>
                <td className="nowrap">{dt(r.pickup_at)}</td>
                <td><Badge group="reservationStatus" value={r.status} /></td>
              </ClickRow>
            ))}
          </Table>
        </Card>
        <Card title="Bugün / gecikmiş iadeler" actions={<Link href="/rentals?status=active">Tümü</Link>}>
          <Table cols={['Sözleşme', 'Müşteri', 'Araç', 'Dönüş', '']} count={d.returns_today.length} empty="Bugün iade yok">
            {d.returns_today.map((r) => (
              <ClickRow key={r.id} href={`/rentals/${r.id}`}>
                <td>{r.contract_no}</td>
                <td>{r.customer_name}<div className="muted small">{r.phone}</div></td>
                <td>{r.plate}</td>
                <td className="nowrap">{dt(r.planned_return_at)}</td>
                <td>{r.overdue ? <Tag tone="danger">Gecikmiş</Tag> : <Tag tone="info">Bugün</Tag>}</td>
              </ClickRow>
            ))}
          </Table>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Son 6 ay: tahsilat ve gider" actions={<Link href="/reports">Raporlar</Link>}>
          <div className="card-body">
            <BarChart
              rows={d.monthly.map((m) => ({ label: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}`, revenue: m.revenue, expenses: m.expenses }))}
              series={[
                { key: 'revenue', label: 'Tahsilat', slot: 1 },
                { key: 'expenses', label: 'Gider (masraf + bakım)', slot: 2 },
              ]}
            />
          </div>
        </Card>
        <Card title="Uyarılar" actions={<Tag tone={d.alerts.length ? 'warn' : 'ok'}>{d.alerts.length}</Tag>}>
          <div className="card-body">
            {d.alerts.length ? (
              d.alerts.map((a, i) => (
                <div key={i} className={`alert ${a.level === 'danger' ? 'danger' : 'warn'}`}>
                  <Link href={a.href}><strong>{a.label}</strong></Link> — {a.level === 'danger' ? '⛔' : '⚠️'} {a.message}
                </div>
              ))
            ) : (
              <div className="muted">Açık uyarı yok.</div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
