import type { Metadata } from 'next';
import Link from 'next/link';
import { listPayments } from '@/lib/domain/bookings';
import { dt, labelOptions, money, text, textOptions, todayStr } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, Stat, Table } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';

export const metadata: Metadata = { title: 'Ödemeler' };

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const defaults = { from: todayStr().slice(0, 8) + '01', to: todayStr() };
  const rows = listPayments({ ...defaults, ...q });
  const sum = (t: string) => rows.filter((p) => p.type === t).reduce((a, p) => a + p.amount, 0);
  return (
    <>
      <PageHead title="Ödemeler" sub="Tahsilat, iade ve depozito hareketleri" />
      <Filters
        defaults={defaults}
        fields={[
          { name: 'from', type: 'date', title: 'Başlangıç' },
          { name: 'to', type: 'date', title: 'Bitiş' },
          { name: 'type', type: 'select', empty: 'Tüm işlemler', options: labelOptions('paymentType') },
          { name: 'method', type: 'select', empty: 'Tüm yöntemler', options: textOptions('method') },
        ]}
      />
      <div className="grid grid-4 mb">
        <Stat label="Tahsilat" value={money(sum('payment'))} />
        <Stat label="İade" value={money(sum('refund'))} />
        <Stat label="Net" value={money(sum('payment') - sum('refund'))} />
        <Stat label="Depozito (alınan − iade)" value={money(sum('deposit_in') - sum('deposit_out'))} />
      </div>
      <Card>
        <Table cols={['Tarih', 'Müşteri', 'Bağlı kayıt', 'İşlem', 'Yöntem', 'Açıklama', 'Kaydeden', ['Tutar', 'num'], '']} count={rows.length}>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="nowrap">{dt(p.paid_at)}</td>
              <td><Link href={`/customers/${p.customer_id}`}>{p.customer_name}</Link></td>
              <td>
                {p.contract_no ? <Link href={`/rentals/${p.rental_id}`}>{p.contract_no}</Link>
                  : p.reservation_code ? <Link href={`/reservations/${p.reservation_id}`}>{p.reservation_code}</Link> : '—'}
              </td>
              <td><Badge group="paymentType" value={p.type} /></td>
              <td>{text('method', p.method)}</td>
              <td>{p.description}</td>
              <td className="small">{p.created_by_name}</td>
              <td className="num">{money(p.amount)}</td>
              <td>{user.role === 'admin' ? <ActionButton url={`/api/payments/${p.id}`} method="DELETE" className="sm" confirm="Ödeme kaydı silinsin mi?" okLabel="Sil" success="Silindi">Sil</ActionButton> : null}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
