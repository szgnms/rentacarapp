import type { Metadata } from 'next';
import Link from 'next/link';
import { listRentals } from '@/lib/domain/bookings';
import { dt, money } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { Badge, Card, PageHead, Table } from '@/components/ui';
import { ClickRow, Filters } from '@/components/client/Filters';

export const metadata: Metadata = { title: 'Kiralamalar' };

export default async function RentalsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await flat(searchParams);
  const rows = listRentals({ ...q, status: q.status ?? 'active' });
  return (
    <>
      <PageHead title="Kiralamalar" sub="Kira sözleşmeleri, teslim ve iade işlemleri" actions={<Link className="btn primary" href="/booking?mode=rental">+ Kapıdan kiralama</Link>} />
      <Filters
        defaults={{ status: 'active' }}
        fields={[
          { name: 'q', type: 'search', placeholder: 'Sözleşme no, müşteri, plaka ara…' },
          { name: 'status', type: 'select', empty: 'Tümü', options: [['active', 'Aktif'], ['overdue', 'Gecikmiş'], ['completed', 'Tamamlandı'], ['cancelled', 'İptal']] },
          { name: 'from', type: 'date', title: 'Teslim tarihi (başlangıç)' },
          { name: 'to', type: 'date', title: 'Teslim tarihi (bitiş)' },
        ]}
      />
      <Card>
        <Table cols={['Sözleşme', 'Müşteri', 'Araç', 'Teslim', 'Dönüş', ['Tutar', 'num'], ['Bakiye', 'num'], 'Durum']} count={rows.length}>
          {rows.map((r) => (
            <ClickRow key={r.id} href={`/rentals/${r.id}`}>
              <td><strong>{r.contract_no}</strong></td>
              <td>{r.customer_name}<div className="muted small">{r.customer_phone}</div></td>
              <td>{r.plate}<div className="muted small">{r.brand} {r.model}</div></td>
              <td className="nowrap">{dt(r.pickup_at)}</td>
              <td className="nowrap">{dt(r.actual_return_at || r.planned_return_at)}</td>
              <td className="num">{money(r.total_amount)}</td>
              <td className={`num ${r.balance > 0.009 ? 'danger-text' : ''}`}>{money(r.balance)}</td>
              <td><Badge group="rentalStatus" value={r.overdue ? 'overdue' : r.status} /></td>
            </ClickRow>
          ))}
        </Table>
      </Card>
    </>
  );
}
