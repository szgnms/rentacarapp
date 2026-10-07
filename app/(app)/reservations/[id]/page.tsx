import type { Metadata } from 'next';
import Link from 'next/link';
import { getReservation, policyFee } from '@/lib/domain/reservations';
import { getCustomer } from '@/lib/domain/customers';
import { portalUrl } from '@/lib/domain/notify';
import { can } from '@/lib/permissions';
import { dt, money, text } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, SumRow, Table, Tag } from '@/components/ui';
import { ActionButton } from '@/components/client/ActionButton';
import { AssignButton, PaymentButton } from '@/components/dialogs/rental';

export const metadata: Metadata = { title: 'Rezervasyon' };

export default async function ReservationPage({ params }: { params: IdParams }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  const r = await orNotFound(() => getReservation(Number(id)));
  const open = r.status === 'pending' || r.status === 'confirmed';
  const customer = open ? await getCustomer(r.customer_id) : null;
  const cancelFee = open || r.status === 'waitlist' ? await policyFee(r, 'cancel') : 0;
  const canOperate = can(user, 'rentals.operate');
  return (
    <>
      <PageHead
        title={<>Rezervasyon {r.code} <Badge group="reservationStatus" value={r.status} /></>}
        sub={`Oluşturma: ${dt(r.created_at)} · Kanal: ${r.source || '—'}${r.agency_name ? ` · Acente: ${r.agency_name}` : ''}`}
        actions={
          <>
            {open && canOperate && r.vehicle_id && !r.pending_approval ? (
              <ActionButton
                url={`/api/reservations/${r.id}/checkout`}
                className="success"
                success="Teslim süreci başladı"
                redirectTo="/rentals/{id}/checkout"
              >
                🚗 Teslim sürecini başlat
              </ActionButton>
            ) : null}
            {r.rental_id ? <Link className="btn primary" href={`/rentals/${r.rental_id}`}>Sözleşmeye git →</Link> : null}
            {(open || r.status === 'waitlist') && can(user, 'reservations.write') ? <AssignButton reservationId={r.id} current={r.vehicle_id} /> : null}
            {(r.status === 'pending' || r.status === 'waitlist') && can(user, 'reservations.write') ? (
              <ActionButton url={`/api/reservations/${r.id}/confirm`} className="primary" success="Rezervasyon onaylandı">Onayla</ActionButton>
            ) : null}
            {open ? <Link className="btn" href={`/booking?reservation_id=${r.id}`}>Düzenle</Link> : null}
            {open ? <PaymentButton ctx={{ reservation_id: r.id, balance: r.total_amount - r.finance.paid }}>Ön ödeme al</PaymentButton> : null}
            {open && can(user, 'reservations.cancel') ? (
              <ActionButton url={`/api/reservations/${r.id}/no-show`} confirm={`Müşteri gelmedi olarak işaretlensin mi? No-show ücreti: ${money(await policyFee(r, 'no-show'))}`} success="Gelmedi olarak işaretlendi">Gelmedi</ActionButton>
            ) : null}
            {(open || r.status === 'waitlist') && can(user, 'reservations.cancel') ? (
              <ActionButton
                url={`/api/reservations/${r.id}/cancel`}
                className="danger"
                confirm={`Rezervasyon iptal edilsin mi? İptal politikası ücreti: ${money(cancelFee)}`}
                reasonLabel="İptal nedeni"
                okLabel="İptal et"
                success="Rezervasyon iptal edildi"
              >
                İptal et
              </ActionButton>
            ) : null}
          </>
        }
      />
      {r.pending_approval ? <div className="alert warn">Bu rezervasyondaki {money(r.pending_approval.amount)} indirim yönetici onayı bekliyor. <Link href="/approvals">Onaylar →</Link></div> : null}
      {open && !r.vehicle_id ? <div className="alert info">Grup rezervasyonu ({r.category}). Teslimden önce araç atayın — grupta boş araç yoksa upgrade önerilir.</div> : null}
      {r.status === 'pending' && r.option_expires_at ? <div className="alert warn">Opsiyon süresi: {dt(r.option_expires_at)} — ön ödeme/onay alınmazsa otomatik iptal edilir.</div> : null}
      {customer?.issues.length ? <div className="alert danger">Müşteri uyarıları: {customer.issues.join(' · ')}</div> : null}
      {r.cancel_reason ? <div className="alert warn">Neden: {r.cancel_reason}{r.cancellation_fee ? ` · Politika ücreti: ${money(r.cancellation_fee)}` : ''}</div> : null}
      <div className="grid grid-2 mb">
        <Card title="Detaylar">
          <div className="card-body">
            <dl className="kv">
              <dt>Müşteri</dt><dd><Link href={`/customers/${r.customer_id}`}>{r.customer_name}</Link> · {r.customer_phone}</dd>
              <dt>Araç grubu</dt><dd>{r.category || '—'}</dd>
              <dt>Araç</dt>
              <dd>{r.vehicle_id ? <><Link href={`/vehicles/${r.vehicle_id}`}>{r.plate}</Link> · {r.brand} {r.model}</> : <Tag tone="warn">Atanmadı</Tag>}</dd>
              <dt>Alış</dt><dd>{dt(r.pickup_at)} · {r.pickup_branch_name || '—'}</dd>
              <dt>Dönüş</dt><dd>{dt(r.return_at)} · {r.return_branch_name || '—'}</dd>
              <dt>Süre</dt><dd>{r.days} gün</dd>
              <dt>Depozito</dt><dd>{money(r.deposit_amount)}</dd>
              {r.portal_token ? <><dt>Müşteri portalı</dt><dd><a href={`/portal/${r.portal_token}`} target="_blank" rel="noreferrer">{await portalUrl(r.portal_token)}</a></dd></> : null}
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
            {r.young_driver_fee ? <SumRow label="Genç sürücü" value={money(r.young_driver_fee)} /> : null}
            {r.channel_markup ? <SumRow label="Kanal farkı" value={money(r.channel_markup)} /> : null}
            {r.coupon_discount ? <SumRow label="Kupon indirimi" value={`-${money(r.coupon_discount)}`} /> : null}
            {r.discount ? <SumRow label="İndirim" value={`-${money(r.discount)}`} /> : null}
            <SumRow total label="Toplam (KDV dahil)" value={money(r.total_amount)} />
            <SumRow label="Ön ödeme" value={money(r.finance.paid)} />
            {r.agency_commission ? <SumRow label="Acente komisyonu" value={money(r.agency_commission)} className="muted" /> : null}
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
