import type { Metadata } from 'next';
import Link from 'next/link';
import { listDamages, listMaintenance } from '@/lib/domain/service';
import { d, labelOptions, money, numf, text } from '@/lib/format';
import { flat, vehicleOptions, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, Table, Tabs, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { DamageButton, MaintenanceButton } from '@/components/dialogs/forms';

export const metadata: Metadata = { title: 'Bakım & Hasar' };

export default async function MaintenancePage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const isM = (q.tab || 'maintenance') === 'maintenance';
  const vehicles = vehicleOptions();
  const admin = user.role === 'admin';
  return (
    <>
      <PageHead
        title="Bakım & Hasar"
        sub="Servis kayıtları, onarımlar ve hasar takibi"
        actions={
          isM ? (
            <MaintenanceButton vehicles={vehicles} className="primary">+ Bakım kaydı</MaintenanceButton>
          ) : (
            <DamageButton vehicles={vehicles} className="primary">+ Hasar kaydı</DamageButton>
          )
        }
      />
      <Tabs items={[['maintenance', '🔧 Bakım'], ['damages', '💥 Hasar']]} active={isM ? 'maintenance' : 'damages'} base="/maintenance" />
      <Filters
        key={isM ? 'm' : 'd'}
        fields={[{ name: 'status', type: 'select', empty: 'Tüm durumlar', options: labelOptions(isM ? 'maintenanceStatus' : 'damageStatus') }]}
      />
      <Card>
        {isM ? (
          (() => {
            const rows = listMaintenance(q);
            return (
              <Table cols={['Araç', 'Tarih', 'Tip', 'Açıklama', 'Servis', ['Km', 'num'], ['Maliyet', 'num'], 'Durum', '']} count={rows.length}>
                {rows.map((m) => (
                  <MaintenanceButton key={m.id} record={m} vehicles={vehicles} asRow>
                    <td><strong>{m.plate}</strong><div className="muted small">{m.brand} {m.model}</div></td>
                    <td className="nowrap">{d(m.start_date)}{m.end_date && m.end_date !== m.start_date ? <div className="muted small">→ {d(m.end_date)}</div> : null}</td>
                    <td>{text('maintenanceType', m.type)}</td>
                    <td>{m.description}</td>
                    <td>{m.vendor}</td>
                    <td className="num">{m.km ? numf(m.km) : ''}</td>
                    <td className="num">{money(m.cost)}</td>
                    <td><Badge group="maintenanceStatus" value={m.status} /></td>
                    <td className="right nowrap">
                      {m.status === 'scheduled' ? (
                        <ActionButton url={`/api/maintenance/${m.id}`} method="PUT" body={{ status: 'in_progress' }} className="sm" success="Bakım başlatıldı, araç bakımda">Başlat</ActionButton>
                      ) : null}{' '}
                      {m.status === 'scheduled' || m.status === 'in_progress' ? (
                        <ActionButton url={`/api/maintenance/${m.id}`} method="PUT" body={{ status: 'completed' }} className="sm" success="Bakım tamamlandı">Tamamla</ActionButton>
                      ) : null}{' '}
                      {admin ? <ActionButton url={`/api/maintenance/${m.id}`} method="DELETE" className="sm danger" confirm="Kayıt silinsin mi?" okLabel="Sil" success="Silindi">Sil</ActionButton> : null}
                    </td>
                  </MaintenanceButton>
                ))}
              </Table>
            );
          })()
        ) : (
          (() => {
            const rows = listDamages(q);
            return (
              <Table cols={['Araç', 'Tarih', 'Konum', 'Açıklama', 'Önem', 'Sözleşme', ['Onarım', 'num'], ['Müşteriye', 'num'], 'Durum', '']} count={rows.length}>
                {rows.map((x) => (
                  <DamageButton key={x.id} record={x} vehicles={vehicles} asRow>
                    <td><strong>{x.plate}</strong></td>
                    <td>{d(x.reported_at)}</td>
                    <td>{x.location}</td>
                    <td>{x.description} {x.insurance_claim ? <Tag tone="violet">Sigorta</Tag> : null}</td>
                    <td><Badge group="severity" value={x.severity} /></td>
                    <td>{x.contract_no ? <><Link href={`/rentals/${x.rental_id}`}>{x.contract_no}</Link><div className="muted small">{x.customer_name}</div></> : '—'}</td>
                    <td className="num">{money(x.repair_cost)}</td>
                    <td className="num">{money(x.customer_charge)}</td>
                    <td><Badge group="damageStatus" value={x.status} /></td>
                    <td className="right">
                      {admin ? <ActionButton url={`/api/damages/${x.id}`} method="DELETE" className="sm danger" confirm="Kayıt silinsin mi?" okLabel="Sil" success="Silindi">Sil</ActionButton> : null}
                    </td>
                  </DamageButton>
                ))}
              </Table>
            );
          })()
        )}
      </Card>
    </>
  );
}
