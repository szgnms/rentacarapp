import type { Metadata } from 'next';
import Link from 'next/link';
import { listReservations } from '@/lib/domain/bookings';
import { dt, labelOptions, money } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { Badge, Card, PageHead, Table } from '@/components/ui';
import { ClickRow, Filters } from '@/components/client/Filters';

export const metadata: Metadata = { title: 'Rezervasyonlar' };

export default async function ReservationsPage({ searchParams }: { searchParams: SearchParams }) {
  const rows = listReservations(await flat(searchParams));
  return (
    <>
      <PageHead title="Rezervasyonlar" sub="İleri tarihli araç rezervasyonları" actions={<Link className="btn primary" href="/booking">+ Yeni rezervasyon</Link>} />
      <Filters
        fields={[
          { name: 'q', type: 'search', placeholder: 'Kod, müşteri, plaka ara…' },
          { name: 'status', type: 'select', empty: 'Tüm durumlar', options: labelOptions('reservationStatus') },
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
              <td>{r.plate}<div className="muted small">{r.brand} {r.model}</div></td>
              <td className="nowrap">{dt(r.pickup_at)}<div className="muted small">{r.pickup_branch_name}</div></td>
              <td className="nowrap">{dt(r.return_at)}<div className="muted small">{r.return_branch_name}</div></td>
              <td className="num">{r.days}</td>
              <td className="num">{money(r.total_amount)}</td>
              <td>{r.source}</td>
              <td><Badge group="reservationStatus" value={r.status} /></td>
            </ClickRow>
          ))}
        </Table>
      </Card>
    </>
  );
}
