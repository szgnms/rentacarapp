import type { Metadata } from 'next';
import Link from 'next/link';
import { listTransfers } from '@/lib/domain/vehicles';
import { listBranches } from '@/lib/domain/admin';
import { can } from '@/lib/permissions';
import { dt, money } from '@/lib/format';
import { flat, vehicleOptions, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Card, PageHead, Table, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton } from '@/components/client/FormButton';

export const metadata: Metadata = { title: 'Şube transferleri' };

const STATUS: Record<string, [string, '' | 'ok' | 'violet' | 'warn']> = { requested: ['Talep', 'warn'], in_transit: ['Yolda', 'violet'], completed: ['Tamamlandı', 'ok'], cancelled: ['İptal', ''] };

export default async function TransfersPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const rows = await listTransfers(q);
  const fleet = can(user, 'fleet.write');
  const branches = (await listBranches()).filter((b) => b.active).map((b) => [b.id, b.name] as [number, string]);
  return (
    <>
      <PageHead
        title="Şube transferleri"
        sub="Tek yön iadeler ve filo dengeleme için araçların şubeler arası taşınması"
        actions={fleet ? (
          <FormButton
            title="Transfer emri"
            url="/api/transfers"
            className="primary"
            success="Transfer emri oluşturuldu"
            fields={[
              { name: 'vehicle_id', label: 'Araç', type: 'select', options: (await vehicleOptions()).map((v) => [v.id, v.label] as [number, string]), required: true, span: 12 },
              { name: 'to_branch_id', label: 'Hedef şube', type: 'select', options: branches, required: true },
              { name: 'planned_at', label: 'Planlanan çıkış', type: 'datetime-local' },
              { name: 'driver', label: 'Şoför' },
              { name: 'cost', label: 'Maliyet (₺)', type: 'number' },
              { name: 'notes', label: 'Not', type: 'textarea', span: 12 },
            ]}
          >
            + Transfer
          </FormButton>
        ) : null}
      />
      <Filters fields={[{ name: 'status', type: 'select', empty: 'Tüm durumlar', options: Object.entries(STATUS).map(([k, v]) => [k, v[0]] as [string, string]) }]} />
      <Card>
        <Table cols={['Plan', 'Araç', 'Nereden → nereye', 'Şoför', 'Çıkış', 'Varış', ['Km', 'num'], ['Maliyet', 'num'], 'Durum', '']} count={rows.length} empty="Transfer yok">
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="nowrap">{dt(t.planned_at)}</td>
              <td><Link href={`/vehicles/${t.vehicle_id}`}>{t.plate}</Link></td>
              <td>{t.from_branch || '—'} → <strong>{t.to_branch}</strong>{t.notes ? <div className="muted small">{t.notes}</div> : null}</td>
              <td>{t.driver}</td>
              <td>{dt(t.departed_at)}</td>
              <td>{dt(t.arrived_at)}</td>
              <td className="num">{t.km ?? ''}</td>
              <td className="num">{money(t.cost)}</td>
              <td><Tag tone={STATUS[t.status]?.[1] ?? ''}>{STATUS[t.status]?.[0]}</Tag></td>
              <td className="right nowrap">
                {fleet && t.status === 'requested' ? <ActionButton url={`/api/transfers/${t.id}/depart`} className="sm primary" success="Araç yola çıktı">Yola çıkar</ActionButton> : null}{' '}
                {fleet && t.status === 'in_transit' ? (
                  <FormButton title="Varış" url={`/api/transfers/${t.id}/arrive`} className="sm success" submitLabel="Teslim alındı" success="Araç hedef şubeye ulaştı"
                    fields={[{ name: 'km', label: 'Varış km', type: 'number' }, { name: 'cost', label: 'Maliyet (₺)', type: 'number' }]} defaults={{ cost: t.cost }}>
                    Varış
                  </FormButton>
                ) : null}{' '}
                {fleet && (t.status === 'requested' || t.status === 'in_transit') ? (
                  <ActionButton url={`/api/transfers/${t.id}/cancel`} className="sm danger" confirm="Transfer iptal edilsin mi?" okLabel="İptal et">İptal</ActionButton>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
