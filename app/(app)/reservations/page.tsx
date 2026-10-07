import type { Metadata } from 'next';
import Link from 'next/link';
import { listReservations } from '@/lib/domain/reservations';
import { dt, labelOptions, money } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { listChannels } from '@/lib/domain/pricing';
import { CATEGORIES } from '@/lib/rules';
import { Badge, Card, PageHead, Table } from '@/components/ui';
import { ClickRow, Filters } from '@/components/client/Filters';

export const metadata: Metadata = { title: 'Rezervasyonlar' };

export default async function ReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const rows = listReservations(q, user);
  const channels = listChannels();
  return (
    <>
      <PageHead title="Rezervasyonlar" sub="İleri tarihli araç rezervasyonları" actions={<Link className="btn primary" href="/booking">+ Yeni rezervasyon</Link>} />
      <Filters
        fields={[
          { name: 'q', type: 'search', placeholder: 'Kod, müşteri, plaka ara…' },
          { name: 'status', type: 'select', empty: 'Tüm durumlar', options: labelOptions('reservationStatus') },
          { name: 'source', type: 'select', empty: 'Tüm kanallar', options: channels.map((c) => [c.code, c.name] as [string, string]) },
          { name: 'category', type: 'select', empty: 'Tüm gruplar', options: CATEGORIES.map((c) => [c, c] as [string, string]) },
          { name: 'unassigned', type: 'select', empty: 'Atama: tümü', options: [['1', 'Araç atanmamış']] },
          { name: 'from', type: 'date', title: 'Alış tarihi (başlangıç)' },
          { name: 'to', type: 'date', title: 'Alış tarihi (bitiş)' },
        ]}
      />
      <Card>
        <Table cols={['Kod', 'Müşteri', 'Araç', 'Alış', 'Dönüş', ['Gün', 'num'], ['Tutar', 'num'], 'Kaynak', 'Durum']} count={rows.length}>
          {rows.map((r) => (
            <ClickRow key={r.id} href={`/reservations/${r.id}`}>
              <td><strong>{r.code}</strong></td>
              <td>{r.customer_name}<div className="muted small">{r.customer_phone}</div></td>
              <td>{r.plate ?? <span className="badge warn">Atanmadı</span>}<div className="muted small">{r.category}{r.brand ? ` · ${r.brand} ${r.model}` : ''}</div></td>
              <td className="nowrap">{dt(r.pickup_at)}<div className="muted small">{r.pickup_branch_name}</div></td>
              <td className="nowrap">{dt(r.return_at)}<div className="muted small">{r.return_branch_name}</div></td>
              <td className="num">{r.days}</td>
              <td className="num">{money(r.total_amount)}</td>
              <td>{r.source}{r.agency_name ? <div className="muted small">{r.agency_name}</div> : null}</td>
              <td><Badge group="reservationStatus" value={r.status} /></td>
            </ClickRow>
          ))}
        </Table>
      </Card>
    </>
  );
}
