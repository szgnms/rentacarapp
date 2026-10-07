import type { Metadata } from 'next';
import Link from 'next/link';
import { CONSENT_TYPES, consentState, getCustomer } from '@/lib/domain/customers';
import { fileMeta } from '@/lib/files';
import { DOC_TYPES } from '@/lib/inspection';
import { can } from '@/lib/permissions';
import { customerName, d, dt, money, text } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, Stat, Table, Tag } from '@/components/ui';
import { ClickRow } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton, type FieldSpec } from '@/components/client/FormButton';
import { CustomerButton } from '@/components/dialogs/forms';
import { ConsentButton, UploadButton } from '@/components/dialogs/customer';

export const metadata: Metadata = { title: 'Müşteri' };

const DRIVER_FIELDS: FieldSpec[] = [
  { name: 'first_name', label: 'Ad', required: true, span: 4 },
  { name: 'last_name', label: 'Soyad', required: true, span: 4 },
  { name: 'phone', label: 'Telefon', type: 'tel', span: 4 },
  { name: 'national_id', label: 'T.C. kimlik no', span: 4 },
  { name: 'birth_date', label: 'Doğum tarihi', type: 'date', span: 4 },
  { name: 'license_no', label: 'Ehliyet no', required: true, span: 4 },
  { name: 'license_class', label: 'Sınıf', span: 4 },
  { name: 'license_date', label: 'Ehliyet veriliş', type: 'date', span: 4 },
  { name: 'license_expiry', label: 'Ehliyet geçerlilik', type: 'date', span: 4 },
];

export default async function CustomerPage({ params }: { params: IdParams }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  // Kişisel veri görüntüleme KVKK erişim loguna yazılır.
  const c = await orNotFound(() => getCustomer(Number(id), { log: true }));
  const live = c.rentals.filter((r) => !['cancelled', 'draft'].includes(r.status));
  const write = can(user, 'customers.write') && !c.anonymized_at;
  const pii = can(user, 'customers.pii');
  const consents = await consentState(c.id);
  return (
    <>
      <PageHead
        title={
          <>
            {customerName(c)} {c.blacklisted ? <Tag tone="danger">Kara liste</Tag> : null} {c.anonymized_at ? <Tag>Anonimleştirildi</Tag> : null}
            {c.risk_score >= 50 ? <Tag tone="warn">Risk {c.risk_score}</Tag> : null}
          </>
        }
        sub={`${c.phone}${c.email ? ' · ' + c.email : ''}${c.agency_name ? ' · Acente: ' + c.agency_name : ''}`}
        actions={
          <>
            {!c.blacklisted && !c.anonymized_at ? <Link className="btn primary" href={`/booking?customer_id=${c.id}`}>Yeni kiralama / rezervasyon</Link> : null}
            <Link className="btn" href={`/customers/${c.id}/statement`}>Cari ekstre</Link>
            {write ? <CustomerButton customer={c}>Düzenle</CustomerButton> : null}
            {pii ? <a className="btn" href={`/api/customers/${c.id}/export`}>KVKK veri ihracı</a> : null}
            {pii && !c.anonymized_at ? (
              <ActionButton
                url={`/api/customers/${c.id}/anonymize`}
                className="danger"
                confirm="KVKK silme talebi: kimlik, iletişim ve belge verileri geri dönülemez şekilde maskelenecek. Yasal saklama gerektiren sözleşme/ödeme kayıtları korunur. Devam edilsin mi?"
                reasonLabel="Talep / gerekçe"
                okLabel="Anonimleştir"
                success="Müşteri anonimleştirildi"
              >
                Anonimleştir
              </ActionButton>
            ) : null}
            {can(user, 'records.delete') ? (
              <ActionButton url={`/api/customers/${c.id}`} method="DELETE" className="danger" confirm="Müşteri kaydı silinsin mi? (İşlem geçmişi olan kayıt silinemez)" okLabel="Sil" success="Müşteri silindi" redirectTo="/customers">Sil</ActionButton>
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
      {c.warnings.length ? <div className="alert warn">{c.warnings.join(' · ')}</div> : null}
      <div className="grid grid-4 mb">
        <Stat label="Kiralama sayısı" value={live.length} />
        <Stat label="Toplam harcama" value={money(live.reduce((a, r) => a + r.total_amount, 0))} />
        <Stat label="Açık bakiye" value={money(c.balance)} valueClass={c.balance > 0 ? 'danger-text' : ''} />
        <Stat label="Kredi limiti" value={c.credit_limit ? money(c.credit_limit) : '—'} hint={c.credit_limit ? `Kullanılabilir: ${money(c.credit_limit - c.balance)}` : 'Kurumsal cari için tanımlanır'} />
      </div>
      <div className="grid grid-3 mb">
        <Card title="Kimlik & iletişim">
          <div className="card-body">
            <dl className="kv">
              <dt>Tip</dt><dd>{c.type === 'corporate' ? 'Kurumsal' : 'Bireysel'}</dd>
              {c.type === 'corporate' ? <><dt>Firma</dt><dd>{c.company_name}</dd><dt>Vergi</dt><dd>{c.tax_office} / {c.tax_no}</dd></> : null}
              {c.invoice_title ? <><dt>Fatura unvanı</dt><dd>{c.invoice_title}</dd></> : null}
              <dt>T.C. / Pasaport</dt><dd>{c.national_id || '—'} / {c.passport_no || '—'}</dd>
              <dt>Uyruk / dil</dt><dd>{c.nationality || '—'} / {c.preferred_language.toUpperCase()}</dd>
              <dt>Doğum tarihi</dt><dd>{d(c.birth_date)}</dd>
              <dt>Adres</dt><dd>{c.address || '—'}</dd>
              {c.risk_note ? <><dt>Risk notu</dt><dd>{c.risk_note}</dd></> : null}
              {c.notes ? <><dt>Notlar</dt><dd>{c.notes}</dd></> : null}
            </dl>
          </div>
        </Card>
        <Card title="Ehliyet">
          <div className="card-body">
            <dl className="kv">
              <dt>Ehliyet no</dt><dd>{c.license_no || '—'}</dd>
              <dt>Sınıf</dt><dd>{c.license_class || '—'}</dd>
              <dt>Veriliş</dt><dd>{d(c.license_date)}</dd>
              <dt>Geçerlilik</dt><dd>{d(c.license_expiry)}</dd>
              <dt>Kayıt tarihi</dt><dd>{dt(c.created_at)}</dd>
            </dl>
          </div>
        </Card>
        <Card title="KVKK & İYS rızaları" actions={write ? <ConsentButton customerId={c.id} types={CONSENT_TYPES} state={consents} /> : null}>
          <div className="card-body">
            <ul className="plain-list">
              {Object.entries(CONSENT_TYPES).map(([k, label]) => (
                <li key={k}>{consents[k] ? '✅' : '⬜'} {label}</li>
              ))}
            </ul>
            {c.consents.length ? (
              <details style={{ marginTop: 8 }}>
                <summary className="muted small">Rıza geçmişi ({c.consents.length})</summary>
                <ul className="plain-list small" style={{ marginTop: 6 }}>
                  {c.consents.map((x) => (
                    <li key={x.id}>{dt(x.created_at)} · {CONSENT_TYPES[x.type] ?? x.type}: <strong>{x.granted ? 'verildi' : 'geri alındı'}</strong> · {x.channel || '—'} · {x.recorded_by_name || 'müşteri'}{x.ip ? ` · ${x.ip}` : ''}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </Card>
      </div>
      <div className="grid grid-2 mb">
        <Card title={`Ek sürücüler (${c.drivers.length})`} actions={write ? <FormButton title="Ek sürücü" url={`/api/customers/${c.id}/drivers`} fields={DRIVER_FIELDS} className="sm" success="Sürücü eklendi" wide>+ Sürücü</FormButton> : null}>
          <Table cols={['Ad soyad', 'Ehliyet', 'Geçerlilik', '']} count={c.drivers.length} empty="Ek sürücü yok">
            {c.drivers.map((x) => (
              <tr key={x.id}>
                <td>{x.first_name} {x.last_name}<div className="muted small">{x.phone}</div></td>
                <td>{x.license_no} {x.license_class ? `(${x.license_class})` : ''}<div className="muted small">{d(x.license_date)}</div></td>
                <td>{d(x.license_expiry)}</td>
                <td className="right nowrap">
                  {write ? (
                    <>
                      <FormButton title="Sürücü düzenle" url={`/api/customers/${c.id}/drivers/${x.id}`} method="PUT" fields={DRIVER_FIELDS} defaults={{ ...x }} className="sm" wide>Düzenle</FormButton>{' '}
                      <ActionButton url={`/api/customers/${c.id}/drivers/${x.id}`} method="DELETE" className="sm danger" confirm="Sürücü silinsin mi?" okLabel="Sil">Sil</ActionButton>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={`Kimlik / ehliyet belgeleri (${c.documents.length})`} actions={write ? <UploadButton entity="customer" entityId={c.id} kinds={DOC_TYPES} className="sm">+ Belge yükle</UploadButton> : null}>
          <Table cols={['Belge', 'Yüklenme', 'Bitiş', '']} count={c.documents.length} empty="Belge yok — kimlik ve ehliyet görselleri teslimde de çekilebilir">
            {c.documents.map((f) => {
              const m = fileMeta(f);
              return (
                <tr key={f.id}>
                  <td>
                    <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">📎 {DOC_TYPES[m.doc_type as keyof typeof DOC_TYPES] ?? f.original_name ?? 'Belge'}</a>
                    {m.note ? <div className="muted small">{String(m.note)}</div> : null}
                  </td>
                  <td>{dt(f.created_at)}</td>
                  <td>{m.expires_at ? d(String(m.expires_at)) : '—'}</td>
                  <td className="right">
                    {can(user, 'records.delete') ? <ActionButton url={`/api/files/${f.id}`} method="DELETE" className="sm" confirm="Belge geçersiz kılınsın mı? (Dosya silinmez, arşivde işaretlenir)" okLabel="Geçersiz kıl">Kaldır</ActionButton> : null}
                  </td>
                </tr>
              );
            })}
          </Table>
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
        <Table cols={['Kod', 'Araç / grup', 'Alış', 'Dönüş', ['Tutar', 'num'], 'Durum']} count={c.reservations.length}>
          {c.reservations.map((r) => (
            <ClickRow key={r.id} href={`/reservations/${r.id}`}>
              <td>{r.code}</td>
              <td>{r.plate ?? <span className="muted">{r.category} (atanmadı)</span>}</td>
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
