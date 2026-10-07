import type { Metadata } from 'next';
import Link from 'next/link';
import { FINE_TYPES, listFines } from '@/lib/domain/tolls';
import { d, dt, money } from '@/lib/format';
import { flat, rentalOptions, type SearchParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { Card, PageHead, Stat, Table, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton } from '@/components/client/FormButton';
import { ImportButton } from '@/components/client/ImportButton';

export const metadata: Metadata = { title: 'Trafik cezaları' };

const STATUS: Record<string, [string, '' | 'ok' | 'warn' | 'danger' | 'info' | 'violet']> = {
  new: ['Yeni (eşleşmedi)', 'danger'], matched: ['Sözleşmeyle eşleşti', 'info'], transferred: ['Sürücüye devredildi', 'violet'],
  charged: ['Müşteriye yansıtıldı', 'ok'], paid: ['Şirket ödedi', ''], objected: ['İtiraz edildi', 'warn'], closed: ['Kapandı', ''], cancelled: ['İptal', ''],
};

export default async function FinesPage({ searchParams }: { searchParams: SearchParams }) {
  const [q] = await Promise.all([flat(searchParams), requirePerm('fines.manage')]);
  const rows = await listFines(q);
  const rentals = await rentalOptions();
  const open = rows.filter((f) => ['new', 'matched', 'transferred', 'objected'].includes(f.status));
  return (
    <>
      <PageHead
        title="Trafik cezaları"
        sub="Tebliğ → plaka + ihlal zamanı ile sözleşme/sürücü eşleştirme → sürücüye devir yazısı veya müşteriye yansıtma; indirimli ödeme ve zamanaşımı takibi"
        actions={
          <>
            <FormButton
              title="Ceza kaydı"
              url="/api/fines"
              className="primary"
              success="Ceza kaydedildi ve eşleştirildi"
              wide
              fields={[
                { name: 'plate', label: 'Plaka', required: true, span: 4 },
                { name: 'violation_at', label: 'İhlal zamanı', type: 'datetime-local', required: true, span: 4 },
                { name: 'type', label: 'Tip', type: 'select', options: Object.entries(FINE_TYPES), span: 4 },
                { name: 'fine_no', label: 'Tutanak / ceza no', span: 4 },
                { name: 'amount', label: 'Tutar (₺)', type: 'number', required: true, span: 4 },
                { name: 'notified_at', label: 'Tebliğ tarihi', type: 'date', span: 4 },
                { name: 'location', label: 'Yer', span: 12 },
                { name: 'notes', label: 'Not', type: 'textarea', span: 12 },
              ]}
            >
              + Ceza
            </FormButton>
            <ImportButton url="/api/fines/import" title="Ceza listesi içe aktar" sample={'plaka;tarih;tutar;cezano;yer;teblig;tip\n34 ABC 123;12.03.2026 14:22;1.054,00;TK123456;D100 Kadıköy;20.03.2026;speed'}>
              ⬆ İçe aktar
            </ImportButton>
          </>
        }
      />
      <div className="grid grid-4 mb">
        <Stat label="Açık ceza" value={open.length} />
        <Stat label="Eşleşmeyen" value={rows.filter((f) => f.status === 'new').length} valueClass="danger-text" />
        <Stat label="Süre uyarısı" value={rows.filter((f) => f.warning).length} valueClass={rows.some((f) => f.warning) ? 'danger-text' : ''} hint="İndirimli ödeme son günleri" />
        <Stat label="Açık tutar" value={money(open.reduce((a, f) => a + f.amount, 0))} />
      </div>
      <Filters
        fields={[
          { name: 'q', type: 'search', placeholder: 'Plaka, ceza no, sözleşme ara…' },
          { name: 'status', type: 'select', empty: 'Tüm durumlar', options: Object.entries(STATUS).map(([k, v]) => [k, v[0]] as [string, string]) },
        ]}
      />
      <Card>
        <Table cols={['İhlal', 'Plaka', 'Tip / no', ['Tutar', 'num'], 'Tebliğ / indirim', 'Zamanaşımı', 'Sözleşme / sürücü', 'Durum', '']} count={rows.length}>
          {rows.map((f) => (
            <tr key={f.id}>
              <td className="nowrap">{dt(f.violation_at)}<div className="muted small">{f.location}</div></td>
              <td>{f.vehicle_id ? <Link href={`/vehicles/${f.vehicle_id}`}>{f.plate}</Link> : f.plate}</td>
              <td>{FINE_TYPES[f.type] ?? f.type}<div className="muted small">{f.fine_no}</div></td>
              <td className="num">{money(f.amount)}{f.service_fee ? <div className="muted small">+{money(f.service_fee)}</div> : null}</td>
              <td>
                {d(f.notified_at)}
                {f.discount_deadline ? <div className="small">İndirim son: {d(f.discount_deadline)}</div> : null}
                {f.warning ? <div className="small danger-text">⚠ {f.warning}</div> : null}
              </td>
              <td className="small">{d(f.limitation_date)}</td>
              <td>{f.rental_id ? <Link href={`/rentals/${f.rental_id}`}>{f.contract_no}</Link> : '—'}<div className="muted small">{f.customer_name}</div></td>
              <td>
                <Tag tone={STATUS[f.status]?.[1] ?? ''}>{STATUS[f.status]?.[0] ?? f.status}</Tag>
                {f.file_id ? <div><a className="small" href={`/api/files/${f.file_id}`} target="_blank" rel="noreferrer">📄 Belge</a></div> : null}
              </td>
              <td className="right nowrap">
                {f.status === 'new' ? (
                  <FormButton title="Sözleşmeye eşleştir" url={`/api/fines/${f.id}/assign`} className="sm primary" success="Eşleştirildi"
                    fields={[{ name: 'rental_id', label: 'Sözleşme', type: 'select', options: rentals, empty: 'Seçin', required: true, span: 12 }]}>
                    Eşleştir
                  </FormButton>
                ) : null}
                {['matched', 'transferred'].includes(f.status) && !f.charge_id ? (
                  <>
                    {f.status === 'matched' ? (
                      <ActionButton url={`/api/fines/${f.id}/transfer`} className="sm" success="Sürücüye devir yazısı oluşturuldu">Devir yazısı</ActionButton>
                    ) : null}{' '}
                    <FormButton title="Müşteriye yansıt" url={`/api/fines/${f.id}/charge`} className="sm primary" success="Ceza sözleşmeye yansıtıldı, müşteri bilgilendirildi"
                      fields={[{ name: 'service_fee', label: 'Hizmet bedeli (₺, boş = ayar)', type: 'number', span: 12 }]}>
                      Yansıt
                    </FormButton>{' '}
                  </>
                ) : null}
                {['new', 'matched', 'transferred', 'objected'].includes(f.status) ? (
                  <>
                    <FormButton title="Ödeme" url={`/api/fines/${f.id}/pay`} className="sm" success="Ödeme kaydedildi" defaults={{ paid_amount: f.amount }}
                      fields={[{ name: 'paid_amount', label: 'Ödenen (₺)', type: 'number' }, { name: 'paid_at', label: 'Tarih', type: 'date' }]}>
                      Öde
                    </FormButton>{' '}
                    <FormButton title="İtiraz" url={`/api/fines/${f.id}/object`} className="sm" success="İtiraz kaydedildi" fields={[{ name: 'note', label: 'İtiraz notu', type: 'textarea', span: 12 }]}>
                      İtiraz
                    </FormButton>{' '}
                  </>
                ) : null}
                {f.status === 'charged' || f.status === 'objected' ? (
                  <FormButton title="Kapat" url={`/api/fines/${f.id}/close`} className="sm" success="Kapatıldı" fields={[{ name: 'note', label: 'Not', span: 12 }]}>Kapat</FormButton>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
