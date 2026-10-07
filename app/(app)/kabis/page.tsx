import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/db';
import { listKabis } from '@/lib/domain/kabis';
import { dt } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { Card, PageHead, Stat, Table, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { FormButton } from '@/components/client/FormButton';
import { PdfButton } from '@/components/client/PdfButton';

export const metadata: Metadata = { title: 'KABİS bildirimleri' };

export default async function KabisPage({ searchParams }: { searchParams: SearchParams }) {
  const [q] = await Promise.all([flat(searchParams), requirePerm('kabis.manage')]);
  const rows = listKabis(q);
  const mode = getSettings().kabis_mode;
  return (
    <>
      <PageHead
        title="KABİS bildirim kuyruğu"
        sub="Emniyet Genel Müdürlüğü Kiralık Araç Bildirim Sistemi — teslimde açılış, iadede kapanış bildirimi"
      />
      <div className={`alert ${mode === 'simulate' ? 'info' : 'warn'}`}>
        Mod: <strong>{mode === 'simulate' ? 'Simülasyon' : 'Manuel'}</strong> —{' '}
        {mode === 'simulate'
          ? 'bildirimler otomatik "gönderildi" sayılır ve SIM- referansı alır (resmi entegrasyon kurulduğunda değiştirin).'
          : 'bildirimi KABİS ekranından yapıp EGM referans numarasını buraya girin. Gün içinde gönderilmeyenler alarm üretir.'}{' '}
        <Link href="/settings">Ayarlar →</Link>
      </div>
      <div className="grid grid-3 mb">
        <Stat label="Bekleyen" value={rows.filter((r) => r.status === 'pending').length} />
        <Stat label="Hatalı" value={rows.filter((r) => r.status === 'error').length} valueClass="danger-text" />
        <Stat label="Alarm" value={rows.filter((r) => r.alarm).length} valueClass={rows.some((r) => r.alarm) ? 'danger-text' : ''} hint="Hata / süresinde gönderilmedi" />
      </div>
      <Filters fields={[{ name: 'status', type: 'select', empty: 'Tüm durumlar', options: [['pending', 'Bekliyor'], ['sent', 'Gönderildi'], ['error', 'Hata']] }]} />
      <Card>
        <Table cols={['Oluşturma', 'Tip', 'Sözleşme', 'Plaka', 'Kiracı', 'Deneme', 'Referans / hata', 'Durum', '']} count={rows.length} empty="Bildirim yok">
          {rows.map((k) => (
            <tr key={k.id} className={k.alarm ? 'row-alarm' : ''}>
              <td>{dt(k.created_at.replace(' ', 'T'))}</td>
              <td>{k.kind === 'open' ? 'Açılış (teslim)' : 'Kapanış (iade)'}</td>
              <td><Link href={`/rentals/${k.rental_id}`}>{k.contract_no}</Link></td>
              <td>{k.plate}</td>
              <td>{k.customer_name}</td>
              <td>{k.attempts}</td>
              <td className="small">{k.reference_no ? <span className="mono">{k.reference_no}</span> : null}{k.last_error ? <div className="danger-text">{k.last_error}</div> : null}</td>
              <td>
                <Tag tone={k.status === 'sent' ? 'ok' : k.status === 'error' ? 'danger' : 'warn'}>{k.status === 'sent' ? 'Gönderildi' : k.status === 'error' ? 'Hata' : 'Bekliyor'}</Tag>
                {k.alarm ? <> <Tag tone="danger">ALARM</Tag></> : null}
              </td>
              <td className="right nowrap">
                <PdfButton url={`/api/kabis/${k.id}`} body={{ pdf: true }} className="sm">Form</PdfButton>{' '}
                {k.status !== 'sent' ? (
                  <>
                    <FormButton title="Gönderildi olarak işaretle" url={`/api/kabis/${k.id}`} className="sm primary" success="Bildirim gönderildi"
                      fields={[{ name: 'reference_no', label: mode === 'simulate' ? 'EGM referans no (boş = simülasyon)' : 'EGM referans no', required: mode !== 'simulate', span: 12 }]}>
                      Gönder
                    </FormButton>{' '}
                    <FormButton title="Hata kaydı" url={`/api/kabis/${k.id}`} className="sm" success="Hata kaydedildi" fields={[{ name: 'error', label: 'Hata mesajı', required: true, span: 12 }]}>
                      Hata
                    </FormButton>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
