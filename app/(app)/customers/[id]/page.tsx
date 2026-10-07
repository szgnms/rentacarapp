import type { Metadata } from 'next';
import Link from 'next/link';
import { getCustomer } from '@/lib/domain/fleet';
import { customerName, d, dt, money, text } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, Stat, Table, Tag } from '@/components/ui';
import { ClickRow } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { CustomerButton } from '@/components/dialogs/forms';

export const metadata: Metadata = { title: 'Müşteri' };

export default async function CustomerPage({ params }: { params: IdParams }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  const c = orNotFound(() => getCustomer(Number(id)));
  const live = c.rentals.filter((r) => r.status !== 'cancelled');
  return (
    <>
      <PageHead
        title={<>{customerName(c)} {c.blacklisted ? <Tag tone="danger">Kara liste</Tag> : null}</>}
        sub={`${c.phone}${c.email ? ' · ' + c.email : ''}`}
        actions={
          <>
            {!c.blacklisted ? <Link className="btn primary" href={`/booking?customer_id=${c.id}`}>Yeni kiralama / rezervasyon</Link> : null}
            <CustomerButton customer={c}>Düzenle</CustomerButton>
            {user.role === 'admin' ? (
              <ActionButton url={`/api/customers/${c.id}`} method="DELETE" className="danger" confirm="Müşteri kaydı silinsin mi?" okLabel="Sil" success="Müşteri silindi" redirectTo="/customers">Sil</ActionButton>
            ) : null}
          </>
        }
      />
      {c.blacklisted ? <div className="alert danger">Kara liste nedeni: {c.blacklist_reason || 'belirtilmemiş'}</div> : null}
      {!c.blacklisted && c.issues.length ? (
        <div className="alert warn">
          Teslim öncesi tamamlanması gerekenler:
          <ul>{c.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      ) : null}
      <div className="grid grid-3 mb">
        <Stat label="Kiralama sayısı" value={live.length} />
        <Stat label="Toplam harcama" value={money(live.reduce((a, r) => a + r.total_amount, 0))} />
        <Stat label="Açık bakiye" value={money(c.balance)} valueClass={c.balance > 0 ? 'danger-text' : ''} />
      </div>
      <div className="grid grid-2 mb">
        <Card title="Kimlik & iletişim">
          <div className="card-body">
            <dl className="kv">
              <dt>Tip</dt><dd>{c.type === 'corporate' ? 'Kurumsal' : 'Bireysel'}</dd>
              {c.type === 'corporate' ? <><dt>Firma</dt><dd>{c.company_name}</dd><dt>Vergi</dt><dd>{c.tax_office} / {c.tax_no}</dd></> : null}
              <dt>T.C. / Pasaport</dt><dd>{c.national_id || '—'} / {c.passport_no || '—'}</dd>
              <dt>Doğum tarihi</dt><dd>{d(c.birth_date)}</dd>
              <dt>Adres</dt><dd>{c.address || '—'}</dd>
              {c.notes ? <><dt>Notlar</dt><dd>{c.notes}</dd></> : null}
            </dl>
          </div>
        </Card>
        <Card title="Ehliyet">
          <div className="card-body">
            <dl className="kv">
              <dt>Ehliyet no</dt><dd>{c.license_no || '—'}</dd>
              <dt>Sınıf</dt><dd>{c.license_class || '—'}</dd>
              <dt>Veriliş tarihi</dt><dd>{d(c.license_date)}</dd>
              <dt>Kayıt tarihi</dt><dd>{dt(c.created_at)}</dd>
            </dl>
          </div>
        </Card>
      </div>
      <Card title="Kiralamalar" className="mb">
        <Table cols={['Sözleşme', 'Araç', 'Teslim', 'Dönüş', ['Tutar', 'num'], ['Bakiye', 'num'], 'Durum']} count={c.rentals.length}>
          {c.rentals.map((r) => (
            <ClickRow key={r.id} href={`/rentals/${r.id}`}>
              <td>{r.contract_no}</td>
              <td>{r.plate} <span className="muted small">{r.brand} {r.model}</span></td>
              <td>{dt(r.pickup_at)}</td>
              <td>{dt(r.actual_return_at || r.planned_return_at)}</td>
              <td className="num">{money(r.total_amount)}</td>
              <td className={`num ${r.balance > 0 ? 'danger-text' : ''}`}>{money(r.balance)}</td>
              <td><Badge group="rentalStatus" value={r.status} /></td>
            </ClickRow>
          ))}
        </Table>
      </Card>
      <Card title="Rezervasyonlar" className="mb">
        <Table cols={['Kod', 'Araç', 'Alış', 'Dönüş', ['Tutar', 'num'], 'Durum']} count={c.reservations.length}>
          {c.reservations.map((r) => (
            <ClickRow key={r.id} href={`/reservations/${r.id}`}>
              <td>{r.code}</td>
              <td>{r.plate}</td>
              <td>{dt(r.pickup_at)}</td>
              <td>{dt(r.return_at)}</td>
              <td className="num">{money(r.total_amount)}</td>
              <td><Badge group="reservationStatus" value={r.status} /></td>
            </ClickRow>
          ))}
        </Table>
      </Card>
      <Card title="Ödeme hareketleri">
        <Table cols={['Tarih', 'İşlem', 'Yöntem', 'Açıklama', ['Tutar', 'num']]} count={c.payments.length}>
          {c.payments.map((p) => (
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
    </>
  );
}
