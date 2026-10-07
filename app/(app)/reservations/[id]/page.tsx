import type { Metadata } from 'next';
import Link from 'next/link';
import { getReservation } from '@/lib/domain/bookings';
import { getCustomer, getVehicle } from '@/lib/domain/fleet';
import { dt, money, text } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { Badge, Card, PageHead, SumRow, Table } from '@/components/ui';
import { ActionButton } from '@/components/client/ActionButton';
import { CheckoutButton, PaymentButton } from '@/components/dialogs/rental';

export const metadata: Metadata = { title: 'Rezervasyon' };

export default async function ReservationPage({ params }: { params: IdParams }) {
  const { id } = await params;
  const r = orNotFound(() => getReservation(Number(id)));
  const open = r.status === 'pending' || r.status === 'confirmed';
  const customer = open ? getCustomer(r.customer_id) : null;
  return (
    <>
      <PageHead
        title={<>Rezervasyon {r.code} <Badge group="reservationStatus" value={r.status} /></>}
        sub={`Oluşturma: ${dt(r.created_at)} · Kaynak: ${r.source}`}
        actions={
          <>
            {open && customer ? (
              <CheckoutButton
                reservation={{ ...r, paid: r.finance.paid }}
                vehicle={getVehicle(r.vehicle_id)}
                customer={customer}
                issues={customer.issues}
              />
            ) : null}
            {r.status === 'pending' ? (
              <ActionButton url={`/api/reservations/${r.id}/confirm`} className="primary" success="Rezervasyon onaylandı">Onayla</ActionButton>
            ) : null}
            {open ? <Link className="btn" href={`/booking?reservation_id=${r.id}`}>Düzenle</Link> : null}
            {open ? <PaymentButton ctx={{ reservation_id: r.id, balance: r.total_amount - r.finance.paid }}>Ön ödeme al</PaymentButton> : null}
            {open ? (
              <ActionButton url={`/api/reservations/${r.id}/no-show`} confirm="Müşteri gelmedi olarak işaretlensin mi?" success="Gelmedi olarak işaretlendi">Gelmedi</ActionButton>
            ) : null}
            {open ? (
              <ActionButton url={`/api/reservations/${r.id}/cancel`} className="danger" confirm="Rezervasyon iptal edilsin mi?" reasonLabel="İptal nedeni" okLabel="İptal et" success="Rezervasyon iptal edildi">
                İptal et
              </ActionButton>
            ) : null}
            {r.rental_id ? <Link className="btn primary" href={`/rentals/${r.rental_id}`}>Sözleşmeye git →</Link> : null}
          </>
        }
      />
      {r.cancel_reason ? <div className="alert warn">Neden: {r.cancel_reason}</div> : null}
      <div className="grid grid-2 mb">
        <Card title="Detaylar">
          <div className="card-body">
            <dl className="kv">
              <dt>Müşteri</dt><dd><Link href={`/customers/${r.customer_id}`}>{r.customer_name}</Link> · {r.customer_phone}</dd>
              <dt>Araç</dt><dd><Link href={`/vehicles/${r.vehicle_id}`}>{r.plate}</Link> · {r.brand} {r.model} ({r.category})</dd>
              <dt>Alış</dt><dd>{dt(r.pickup_at)} · {r.pickup_branch_name || '—'}</dd>
              <dt>Dönüş</dt><dd>{dt(r.return_at)} · {r.return_branch_name || '—'}</dd>
              <dt>Süre</dt><dd>{r.days} gün</dd>
              <dt>Depozito</dt><dd>{money(r.deposit_amount)}</dd>
              {r.notes ? <><dt>Notlar</dt><dd>{r.notes}</dd></> : null}
            </dl>
          </div>
        </Card>
        <Card title="Fiyat">
          <div className="card-body">
            <SumRow label={`${r.days} gün × ${money(r.daily_rate)}`} value={money(r.base_amount)} />
            {r.long_term_discount ? <SumRow label="Uzun dönem indirimi" value={`-${money(r.long_term_discount)}`} /> : null}
            {r.extras.map((x) => <SumRow key={x.extra_id} label={`${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}`} value={money(x.amount)} />)}
            {r.one_way_fee ? <SumRow label="Tek yön ücreti" value={money(r.one_way_fee)} /> : null}
            {r.discount ? <SumRow label="İndirim" value={`-${money(r.discount)}`} /> : null}
            <SumRow total label="Toplam" value={money(r.total_amount)} />
            <SumRow label="Ön ödeme" value={money(r.finance.paid)} />
          </div>
        </Card>
      </div>
      {r.payments.length ? (
        <Card title="Ödemeler">
          <Table cols={['Tarih', 'İşlem', 'Yöntem', 'Açıklama', ['Tutar', 'num']]} count={r.payments.length}>
            {r.payments.map((p) => (
              <tr key={p.id}>
                <td>{dt(p.paid_at)}</td>
                <td><Badge group="paymentType" value={p.type} /></td>
                <td>{text('method', p.method)}</td>
                <td>{p.description}</td>
                <td className="num">{money(p.amount)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </>
  );
}
