import type { Metadata } from 'next';
import Link from 'next/link';
import { getRental, type SessionDetail } from '@/lib/domain/agreements';
import { portalUrl } from '@/lib/domain/notify';
import { CLEANLINESS_LABELS, angleLabel } from '@/lib/inspection';
import { can } from '@/lib/permissions';
import { FUEL, customerName, d, dt, money, numf, text } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, Stat, SumRow, Table, Tag } from '@/components/ui';
import { ActionButton } from '@/components/client/ActionButton';
import { ChargeButton, ExtendButton, PaymentButton, RemoveChargeButton, SwapButton } from '@/components/dialogs/rental';

export const metadata: Metadata = { title: 'Sözleşme' };

const KABIS_TONE: Record<string, 'ok' | 'warn' | 'danger' | ''> = { sent: 'ok', pending: 'warn', error: 'danger' };

function Photos({ s, title }: { s: SessionDetail; title: string }) {
  return (
    <Card title={`${title} · ${s.photos.length} fotoğraf${s.completed_at ? ` · ${dt(s.completed_at)}` : ' · devam ediyor'}`} className="mb">
      <div className="card-body">
        <div className="muted small mb">
          Km {numf(s.km)} · Yakıt {FUEL(s.fuel)}{s.cleanliness ? ` · Temizlik: ${CLEANLINESS_LABELS[s.cleanliness as keyof typeof CLEANLINESS_LABELS] ?? s.cleanliness}` : ''}
          {s.marks.filter((m) => !m.voided_at).length ? ` · ${s.marks.filter((m) => !m.voided_at).length} hasar işareti` : ''}
          {s.checklist.filter((c) => !c.present).length ? ` · Eksik ekipman: ${s.checklist.filter((c) => !c.present).map((c) => c.item).join(', ')}` : ''}
        </div>
        {s.photos.length ? (
          <div className="photo-grid small-grid">
            {s.photos.map((p) => (
              <a key={p.id} className="thumb" href={`/api/files/${p.file_id}`} target="_blank" rel="noreferrer" title={`SHA-256 ${p.sha256}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${p.file_id}`} alt={angleLabel(p.angle)} loading="lazy" />
                <span className="thumb-cap">{angleLabel(p.angle)}</span>
              </a>
            ))}
          </div>
        ) : <div className="muted">Fotoğraf yok</div>}
      </div>
    </Card>
  );
}

export default async function RentalPage({ params }: { params: IdParams }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  const r = await orNotFound(() => getRental(Number(id)));
  const f = r.finance;
  const { status } = r;
  const active = status === 'active';
  const operate = can(user, 'rentals.operate');
  const { customer, vehicle, extras, charges, payments, damages, ...rental } = r;
  void vehicle;
  return (
    <>
      <PageHead
        title={<>Sözleşme {r.contract_no} <Badge group="rentalStatus" value={r.overdue ? 'overdue' : status} /></>}
        sub={
          <>
            {r.reservation_code ? <>Rezervasyon: <Link href={`/reservations/${r.reservation_id}`}>{r.reservation_code}</Link> · </> : null}
            Oluşturma: {dt(r.created_at)}{r.source ? ` · Kanal: ${r.source}` : ''} · Dil: {r.language.toUpperCase()}
          </>
        }
        actions={
          <>
            {status === 'draft' && operate ? <Link className="btn success" href={`/rentals/${r.id}/checkout`}>🚗 Teslim sihirbazına devam et</Link> : null}
            {active && operate ? <Link className="btn success" href={`/rentals/${r.id}/checkin`}>↩︎ İade al</Link> : null}
            {status !== 'cancelled' && status !== 'draft' ? (
              <PaymentButton className="primary" ctx={{ rental_id: r.id, balance: f.balance, deposit_held: f.deposit_held, deposit_amount: r.deposit_amount }}>
                Ödeme / depozito
              </PaymentButton>
            ) : null}
            {active && can(user, 'reservations.write') ? <ExtendButton rental={rental} /> : null}
            {active && operate ? <SwapButton rental={rental} /> : null}
            {(active || status === 'returned' || status === 'closed') && operate ? <ChargeButton rentalId={r.id} post={status !== 'active'} /> : null}
            {r.deposit_hold_amount > 0 && can(user, 'payments.refund') ? (
              <ActionButton url={`/api/rentals/${r.id}/release-hold`} confirm={`Tutulan ${money(r.deposit_hold_amount)} depozito serbest bırakılsın mı? Açık bakiye önce mahsup edilir.`} success="Depozito serbest bırakıldı">
                Depozitoyu serbest bırak
              </ActionButton>
            ) : null}
            {(status === 'returned' || status === 'closed') && can(user, 'finance.manage') ? (
              <ActionButton url={`/api/rentals/${r.id}/invoice`} success="Fatura işlemi tamamlandı">🧾 Fatura kes</ActionButton>
            ) : null}
            <Link className="btn" href={`/rentals/${r.id}/contract`}>🖨️ Yazdır</Link>
            {(active || status === 'draft') && can(user, 'rentals.cancel') ? (
              <ActionButton
                url={`/api/rentals/${r.id}/cancel`}
                className="danger"
                confirm={status === 'draft' ? 'Taslak sözleşme iptal edilsin mi? (Rezervasyon onaylı duruma döner)' : 'Sözleşme iptal edilsin ve araç müsait duruma alınsın mı? (Tahsilatlar ayrıca iade edilmelidir)'}
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
      {status === 'draft' ? <div className="alert warn">Teslim süreci tamamlanmadı: fotoğraflar, ekipman kontrolü, imzalar ve depozito alındıktan sonra sözleşme aktifleşir.</div> : null}
      {r.customer_issues.length && (status === 'draft' || active) ? <div className="alert danger">{r.customer_issues.join(' · ')}</div> : null}
      {r.customer_warnings.length ? <div className="alert warn">{r.customer_warnings.join(' · ')}</div> : null}
      <div className="grid grid-4 mb">
        <Stat label="Toplam" value={money(f.total)} />
        <Stat label="Ödenen" value={money(f.paid)} />
        <Stat
          label="Kalan bakiye"
          value={money(f.balance)}
          valueClass={f.balance > 0.009 ? 'danger-text' : f.balance < -0.009 ? 'ok-text' : ''}
          hint={f.balance < -0.009 ? 'Müşteriye iade edilecek' : undefined}
        />
        <Stat
          label="Tutulan depozito"
          value={money(f.deposit_held)}
          hint={r.deposit_hold_amount > 0 ? `HGS/ceza için tutuluyor · ${d(r.deposit_hold_until)} tarihine kadar` : `Belirlenen: ${money(r.deposit_amount)}`}
        />
      </div>
      <div className="grid grid-2 mb">
        <Card title="Sözleşme bilgileri">
          <div className="card-body">
            <dl className="kv">
              <dt>Müşteri</dt><dd><Link href={`/customers/${r.customer_id}`}>{customerName(customer)}</Link> · {r.customer_phone}</dd>
              <dt>Ehliyet</dt><dd>{customer.license_no || '—'} ({d(customer.license_date)})</dd>
              {r.drivers.length ? <><dt>Ek sürücüler</dt><dd>{r.drivers.map((x) => `${x.first_name} ${x.last_name}`).join(', ')}</dd></> : null}
              {r.additional_driver ? <><dt>Ek sürücü</dt><dd>{r.additional_driver}</dd></> : null}
              <dt>Araç</dt><dd><Link href={`/vehicles/${r.vehicle_id}`}>{r.plate}</Link> · {r.brand} {r.model} ({r.category})</dd>
              {r.vehicle_changes.length ? <><dt>İkame geçmişi</dt><dd>{r.vehicle_changes.map((c) => `${c.old_plate} → ${c.new_plate} (${dt(c.changed_at)}${c.reason ? ` · ${c.reason}` : ''})`).join('; ')}</dd></> : null}
              <dt>Teslim</dt><dd>{dt(r.pickup_at)} · {r.pickup_branch_name || '—'}</dd>
              <dt>Planlanan dönüş</dt><dd>{dt(r.planned_return_at)} · {r.return_branch_name || '—'}</dd>
              {r.actual_return_at ? <><dt>Gerçek dönüş</dt><dd>{dt(r.actual_return_at)}</dd></> : null}
              <dt>Km</dt>
              <dd>{numf(r.start_km)}{r.end_km !== null ? <> → {numf(r.end_km)} <span className="muted">({numf(r.end_km - r.start_km)} km)</span></> : null}</dd>
              <dt>Yakıt</dt><dd>{FUEL(r.start_fuel)}{r.end_fuel !== null ? ` → ${FUEL(r.end_fuel)}` : ''}</dd>
              {r.checkout_notes ? <><dt>Teslim notu</dt><dd>{r.checkout_notes}</dd></> : null}
              {r.checkin_notes ? <><dt>İade notu</dt><dd>{r.checkin_notes}</dd></> : null}
              {r.portal_token ? <><dt>Müşteri portalı</dt><dd><a href={`/portal/${r.portal_token}`} target="_blank" rel="noreferrer">{await portalUrl(r.portal_token)}</a></dd></> : null}
              {r.closed_at ? <><dt>Kapanış</dt><dd>{dt(r.closed_at)}</dd></> : null}
            </dl>
          </div>
        </Card>
        <Card title="Ücret dökümü">
          <div className="card-body">
            <SumRow label={`${r.days} gün × ${money(r.daily_rate)}`} value={money(r.base_amount)} />
            {r.long_term_discount ? <SumRow label="Uzun dönem indirimi" value={`-${money(r.long_term_discount)}`} /> : null}
            {extras.map((x) => <SumRow key={x.extra_id} label={`${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}`} value={money(x.amount)} />)}
            {r.one_way_fee ? <SumRow label="Tek yön ücreti" value={money(r.one_way_fee)} /> : null}
            {r.young_driver_fee ? <SumRow label="Genç sürücü" value={money(r.young_driver_fee)} /> : null}
            {r.channel_markup ? <SumRow label="Kanal farkı" value={money(r.channel_markup)} /> : null}
            {r.coupon_discount ? <SumRow label="Kupon indirimi" value={`-${money(r.coupon_discount)}`} /> : null}
            {r.discount ? <SumRow label="İndirim" value={`-${money(r.discount)}`} /> : null}
            {charges.map((c) => (
              <SumRow
                key={c.id}
                label={
                  <>
                    {text('chargeType', c.type)} {c.post_charge ? <Tag tone="violet">kapanış sonrası</Tag> : null}{' '}
                    {c.description ? <span className="muted small">{c.description}</span> : null}{' '}
                    {operate ? <RemoveChargeButton rentalId={r.id} chargeId={c.id} canApprove={can(user, 'approve')} /> : null}
                  </>
                }
                value={money(c.amount)}
              />
            ))}
            <SumRow total label="Toplam (KDV dahil)" value={money(r.total_amount)} />
          </div>
        </Card>
      </div>
      <div className="grid grid-3 mb">
        <Card title="Belgeler (WORM, SHA-256)">
          <div className="card-body">
            {r.documents.length ? (
              <ul className="plain-list">
                {r.documents.map((x) => (
                  <li key={x.id}>
                    <a href={`/api/files/${x.id}`} target="_blank" rel="noreferrer">📄 {x.original_name || `belge-${x.id}.pdf`}</a>
                    <div className="muted small mono" title={x.sha256}>{dt(x.created_at)} · {x.sha256.slice(0, 16)}…</div>
                  </li>
                ))}
              </ul>
            ) : <div className="muted">Sözleşme PDF'i aktivasyonda üretilir.</div>}
          </div>
        </Card>
        <Card title="İmzalar">
          <div className="card-body">
            {r.signatures.length ? (
              <ul className="plain-list">
                {r.signatures.map((s) => {
                  const ok = r.sig_valid[s.purpose][s.signer_type];
                  return (
                    <li key={s.id}>
                      {s.purpose === 'checkout' ? 'Teslim' : 'İade'} · {s.signer_type === 'customer' ? 'Müşteri' : 'Personel'}: <strong>{s.signer_name}</strong>{' '}
                      <Tag tone={ok ? 'ok' : 'danger'}>{ok ? 'geçerli' : 'veri değişti'}</Tag>
                      <div className="muted small">{dt(s.signed_at)} · IP {s.ip || '—'}</div>
                    </li>
                  );
                })}
              </ul>
            ) : <div className="muted">Henüz imza yok</div>}
          </div>
        </Card>
        <Card title="KABİS & Fatura">
          <div className="card-body">
            {r.kabis.length ? r.kabis.map((k, i) => (
              <div key={i}>KABİS {k.kind === 'open' ? 'açılış' : 'kapanış'}: <Tag tone={KABIS_TONE[k.status] ?? ''}>{({ sent: 'Gönderildi', pending: 'Bekliyor', error: 'Hata' } as Record<string, string>)[k.status] ?? k.status}</Tag> {k.reference_no || ''}</div>
            )) : <div className="muted">KABİS bildirimi yok</div>}
            <div style={{ marginTop: 8 }}>
              {r.invoices.length ? r.invoices.map((inv) => (
                <div key={inv.id}>
                  🧾 {inv.pdf_file_id ? <a href={`/api/files/${inv.pdf_file_id}`} target="_blank" rel="noreferrer">{inv.invoice_no}</a> : inv.invoice_no}{' '}
                  · {inv.type === 'credit' ? 'İade faturası' : 'e-Arşiv'} · {money(inv.total)} <Tag tone={inv.status === 'cancelled' ? 'danger' : inv.status === 'sent' ? 'ok' : 'info'}>{({ issued: 'Düzenlendi', sent: 'Gönderildi', cancelled: 'İptal' } as Record<string, string>)[inv.status] ?? inv.status}</Tag>
                </div>
              )) : <div className="muted">Fatura kesilmedi</div>}
            </div>
            <div style={{ marginTop: 8 }}><Link href="/kabis">KABİS kuyruğu →</Link></div>
          </div>
        </Card>
      </div>
      {r.checkout ? <Photos s={r.checkout} title="Teslim muayenesi" /> : null}
      {r.checkin ? <Photos s={r.checkin} title="İade muayenesi" /> : null}
      <Card title="Ödeme hareketleri" className="mb">
        <Table cols={['Tarih', 'İşlem', 'Yöntem', 'Referans', 'Açıklama', ['Tutar', 'num'], '']} count={payments.length} empty="Henüz ödeme yok">
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{dt(p.paid_at)}</td>
              <td><Badge group="paymentType" value={p.type} /></td>
              <td>{text('method', p.method)}</td>
              <td className="mono small">{p.reference || ''}</td>
              <td>{p.description}</td>
              <td className="num">{money(p.amount)}</td>
              <td className="right">
                {can(user, 'payments.delete') ? <ActionButton url={`/api/payments/${p.id}`} method="DELETE" className="sm" confirm="Ödeme kaydı silinsin mi?" okLabel="Sil" success="Ödeme silindi">Sil</ActionButton> : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {damages.length || r.previous_damages.length ? (
        <Card title="Hasarlar">
          <Table cols={['Tarih', 'Konum', 'Açıklama', 'Önem', ['Müşteriye yansıyan', 'num'], 'Durum']} count={damages.length + r.previous_damages.length}>
            {[...damages, ...r.previous_damages].map((x) => (
              <tr key={x.id}>
                <td>{d(x.reported_at)}</td>
                <td>{x.location}</td>
                <td>{x.description} {x.rental_id !== r.id ? <Tag>önceden mevcut</Tag> : null} {x.waived ? <Tag tone="ok">affedildi</Tag> : null}</td>
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
