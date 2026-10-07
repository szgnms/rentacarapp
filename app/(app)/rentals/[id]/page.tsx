import type { Metadata } from 'next';
import Link from 'next/link';
import { getRental } from '@/lib/domain/bookings';
import { listBranches } from '@/lib/domain/admin';
import { FUEL, customerName, d, dt, money, numf, text } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, Stat, SumRow, Table } from '@/components/ui';
import { ActionButton } from '@/components/client/ActionButton';
import { ChargeButton, CheckinButton, ExtendButton, PaymentButton } from '@/components/dialogs/rental';

export const metadata: Metadata = { title: 'Sözleşme' };

export default async function RentalPage({ params }: { params: IdParams }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  const r = orNotFound(() => getRental(Number(id)));
  const f = r.finance;
  const active = r.status === 'active';
  const admin = user.role === 'admin';
  const { customer, vehicle, extras, charges, payments, damages, ...rental } = r;
  return (
    <>
      <PageHead
        title={<>Sözleşme {r.contract_no} <Badge group="rentalStatus" value={r.overdue ? 'overdue' : r.status} /></>}
        sub={
          <>
            {r.reservation_code ? <>Rezervasyon: <Link href={`/reservations/${r.reservation_id}`}>{r.reservation_code}</Link> · </> : null}
            Oluşturma: {dt(r.created_at)}
          </>
        }
        actions={
          <>
            {active ? <CheckinButton rental={rental} vehicle={vehicle} branches={listBranches()} /> : null}
            {r.status !== 'cancelled' ? (
              <PaymentButton className="primary" ctx={{ rental_id: r.id, balance: f.balance, deposit_held: f.deposit_held, deposit_amount: r.deposit_amount }}>
                Ödeme / depozito
              </PaymentButton>
            ) : null}
            {active ? <ExtendButton rental={rental} /> : null}
            {r.status !== 'cancelled' ? <ChargeButton rentalId={r.id} /> : null}
            <Link className="btn" href={`/rentals/${r.id}/contract`}>🖨️ Sözleşme</Link>
            {active && admin ? (
              <ActionButton
                url={`/api/rentals/${r.id}/cancel`}
                className="danger"
                confirm="Sözleşme iptal edilsin ve araç müsait duruma alınsın mı? (Tahsilatlar ayrıca iade edilmelidir)"
                reasonLabel="İptal nedeni"
                okLabel="İptal et"
                success="Sözleşme iptal edildi"
              >
                İptal
              </ActionButton>
            ) : null}
          </>
        }
      />
      {r.overdue ? <div className="alert danger">Planlanan dönüş ({dt(r.planned_return_at)}) geçti. Müşteriyle iletişime geçin: {r.customer_phone}</div> : null}
      <div className="grid grid-4 mb">
        <Stat label="Toplam" value={money(f.total)} />
        <Stat label="Ödenen" value={money(f.paid)} />
        <Stat
          label="Kalan bakiye"
          value={money(f.balance)}
          valueClass={f.balance > 0.009 ? 'danger-text' : f.balance < -0.009 ? 'ok-text' : ''}
          hint={f.balance < -0.009 ? 'Müşteriye iade edilecek' : undefined}
        />
        <Stat label="Tutulan depozito" value={money(f.deposit_held)} hint={`Belirlenen: ${money(r.deposit_amount)}`} />
      </div>
      <div className="grid grid-2 mb">
        <Card title="Sözleşme bilgileri">
          <div className="card-body">
            <dl className="kv">
              <dt>Müşteri</dt><dd><Link href={`/customers/${r.customer_id}`}>{customerName(customer)}</Link> · {r.customer_phone}</dd>
              <dt>Ehliyet</dt><dd>{customer.license_no || '—'} ({d(customer.license_date)})</dd>
              {r.additional_driver ? <><dt>Ek sürücü</dt><dd>{r.additional_driver}</dd></> : null}
              <dt>Araç</dt><dd><Link href={`/vehicles/${r.vehicle_id}`}>{r.plate}</Link> · {r.brand} {r.model}</dd>
              <dt>Teslim</dt><dd>{dt(r.pickup_at)} · {r.pickup_branch_name || '—'}</dd>
              <dt>Planlanan dönüş</dt><dd>{dt(r.planned_return_at)} · {r.return_branch_name || '—'}</dd>
              {r.actual_return_at ? <><dt>Gerçek dönüş</dt><dd>{dt(r.actual_return_at)}</dd></> : null}
              <dt>Km</dt>
              <dd>{numf(r.start_km)}{r.end_km !== null ? <> → {numf(r.end_km)} <span className="muted">({numf(r.end_km - r.start_km)} km)</span></> : null}</dd>
              <dt>Yakıt</dt><dd>{FUEL(r.start_fuel)}{r.end_fuel !== null ? ` → ${FUEL(r.end_fuel)}` : ''}</dd>
              {r.checkout_notes ? <><dt>Teslim notu</dt><dd>{r.checkout_notes}</dd></> : null}
              {r.checkin_notes ? <><dt>İade notu</dt><dd>{r.checkin_notes}</dd></> : null}
            </dl>
          </div>
        </Card>
        <Card title="Ücret dökümü">
          <div className="card-body">
            <SumRow label={`${r.days} gün × ${money(r.daily_rate)}`} value={money(r.base_amount)} />
            {r.long_term_discount ? <SumRow label="Uzun dönem indirimi" value={`-${money(r.long_term_discount)}`} /> : null}
            {extras.map((x) => <SumRow key={x.extra_id} label={`${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}`} value={money(x.amount)} />)}
            {r.one_way_fee ? <SumRow label="Tek yön ücreti" value={money(r.one_way_fee)} /> : null}
            {r.discount ? <SumRow label="İndirim" value={`-${money(r.discount)}`} /> : null}
            {charges.map((c) => (
              <SumRow
                key={c.id}
                label={
                  <>
                    {text('chargeType', c.type)} {c.description ? <span className="muted small">{c.description}</span> : null}{' '}
                    {admin ? (
                      <ActionButton url={`/api/rentals/${r.id}/charges/${c.id}`} method="DELETE" className="sm x" confirm="Ek ücret silinsin mi?" okLabel="Sil">×</ActionButton>
                    ) : null}
                  </>
                }
                value={money(c.amount)}
              />
            ))}
            <SumRow total label="Toplam" value={money(r.total_amount)} />
          </div>
        </Card>
      </div>
      <Card title="Ödeme hareketleri" className="mb">
        <Table cols={['Tarih', 'İşlem', 'Yöntem', 'Açıklama', ['Tutar', 'num'], '']} count={payments.length} empty="Henüz ödeme yok">
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{dt(p.paid_at)}</td>
              <td><Badge group="paymentType" value={p.type} /></td>
              <td>{text('method', p.method)}</td>
              <td>{p.description}</td>
              <td className="num">{money(p.amount)}</td>
              <td className="right">
                {admin ? <ActionButton url={`/api/payments/${p.id}`} method="DELETE" className="sm" confirm="Ödeme kaydı silinsin mi?" okLabel="Sil" success="Ödeme silindi">Sil</ActionButton> : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {damages.length ? (
        <Card title="Hasarlar">
          <Table cols={['Tarih', 'Konum', 'Açıklama', 'Önem', ['Müşteriye yansıyan', 'num'], 'Durum']} count={damages.length}>
            {damages.map((x) => (
              <tr key={x.id}>
                <td>{d(x.reported_at)}</td>
                <td>{x.location}</td>
                <td>{x.description}</td>
                <td><Badge group="severity" value={x.severity} /></td>
                <td className="num">{money(x.customer_charge)}</td>
                <td><Badge group="damageStatus" value={x.status} /></td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </>
  );
}
