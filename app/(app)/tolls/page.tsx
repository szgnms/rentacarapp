import type { Metadata } from 'next';
import Link from 'next/link';
import { listTolls, tollFineSummary } from '@/lib/domain/tolls';
import { dt, money } from '@/lib/format';
import { flat, rentalOptions, type SearchParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { Card, PageHead, Stat, Table, Tag, type Col } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton } from '@/components/client/FormButton';
import { ImportButton } from '@/components/client/ImportButton';

export const metadata: Metadata = { title: 'HGS / OGS geçişleri' };

const STATUS: Record<string, [string, '' | 'ok' | 'warn' | 'danger' | 'info' | 'violet']> = {
  unmatched: ['Eşleşmedi', 'danger'], matched: ['Eşleşti', 'info'], charged: ['Müşteriye yansıtıldı', 'ok'], company: ['Şirket kullanımı', ''], disputed: ['İtirazlı', 'warn'],
};

export default async function TollsPage({ searchParams }: { searchParams: SearchParams }) {
  const [q] = await Promise.all([flat(searchParams), requirePerm('tolls.manage')]);
  const rows = await listTolls(q);
  const sum = await tollFineSummary();
  const unmatched = rows.filter((r) => r.status === 'unmatched');
  const rentals = unmatched.length ? await rentalOptions() : [];
  const cols: Col[] = ['Geçiş', 'Plaka / etiket', 'Gişe / yer', ['Tutar', 'num'], 'Sözleşme', 'Durum', ''];
  return (
    <>
      <PageHead
        title="HGS / OGS geçişleri"
        sub="Ekstre içe aktarma → plaka + tarih ile sözleşme eşleştirme → müşteriye hizmet bedeliyle yansıtma (kapanmış sözleşmeye kapanış sonrası borç)"
        actions={
          <>
            <ImportButton
              url="/api/tolls/import"
              title="HGS/OGS ekstresi içe aktar"
              className="primary"
              sample={'plaka;tarih;gise;tutar\n34 ABC 123;12.03.2026 14:22;Çamlıca Gişeleri;48,50'}
            >
              ⬆ Ekstre içe aktar
            </ImportButton>
            <ActionButton url="/api/tolls/rematch" success="Eşleşmeyen geçişler yeniden denendi">↻ Yeniden eşleştir</ActionButton>
          </>
        }
      />
      <div className="grid grid-4 mb">
        <Stat label="İstisna kuyruğu" value={sum.unmatched_tolls} valueClass={sum.unmatched_tolls ? 'danger-text' : ''} hint="Sözleşme bulunamayan geçiş" />
        <Stat label="Listelenen geçiş" value={rows.length} />
        <Stat label="Toplam tutar" value={money(rows.reduce((a, r) => a + r.amount, 0))} />
        <Stat
          label="Düşük HGS bakiyesi"
          value={sum.low_hgs.length}
          valueClass={sum.low_hgs.length ? 'danger-text' : ''}
          hint={sum.low_hgs.slice(0, 3).map((v) => `${v.plate} ${money(v.hgs_balance)}`).join(' · ') || undefined}
        />
      </div>
      <Filters
        defaults={{}}
        fields={[
          { name: 'q', type: 'search', placeholder: 'Plaka, gişe, sözleşme ara…' },
          { name: 'status', type: 'select', empty: 'Tüm durumlar', options: Object.entries(STATUS).map(([k, v]) => [k, v[0]] as [string, string]) },
          { name: 'from', type: 'date', title: 'Başlangıç' },
          { name: 'to', type: 'date', title: 'Bitiş' },
        ]}
      />
      <Card>
        <Table cols={cols} count={rows.length} empty="Geçiş kaydı yok — ekstre içe aktarın">
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="nowrap">{dt(t.passed_at)}</td>
              <td>{t.vehicle_id ? <Link href={`/vehicles/${t.vehicle_id}`}>{t.plate}</Link> : t.plate || '—'}<div className="muted small">{t.tag_no}</div></td>
              <td>{t.location}{t.note ? <div className="muted small">{t.note}</div> : null}</td>
              <td className="num">{money(t.amount)}{t.service_fee ? <div className="muted small">+{money(t.service_fee)} hizmet</div> : null}</td>
              <td>{t.rental_id ? <Link href={`/rentals/${t.rental_id}`}>{t.contract_no}</Link> : '—'}<div className="muted small">{t.customer_name}</div></td>
              <td><Tag tone={STATUS[t.status]?.[1] ?? ''}>{STATUS[t.status]?.[0] ?? t.status}</Tag></td>
              <td className="right nowrap">
                {t.status === 'unmatched' || t.status === 'disputed' ? (
                  <>
                    <FormButton
                      title="Geçişi sözleşmeye ata"
                      url={`/api/tolls/${t.id}/assign`}
                      className="sm primary"
                      success="Geçiş müşteriye yansıtıldı"
                      fields={[{ name: 'rental_id', label: 'Sözleşme', type: 'select', options: rentals, empty: 'Seçin', required: true, span: 12 }]}
                    >
                      Ata
                    </FormButton>{' '}
                    <FormButton title="Şirket kullanımı" url={`/api/tolls/${t.id}/company`} className="sm" success="Şirket masrafı olarak kaydedildi" fields={[{ name: 'note', label: 'Not', span: 12 }]}>
                      Şirket
                    </FormButton>{' '}
                  </>
                ) : null}
                {t.status !== 'disputed' && t.status !== 'company' ? (
                  <FormButton title="İtiraz / inceleme" url={`/api/tolls/${t.id}/dispute`} className="sm" success="İtirazlı olarak işaretlendi" fields={[{ name: 'note', label: 'Not', span: 12 }]}>
                    İtiraz
                  </FormButton>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
