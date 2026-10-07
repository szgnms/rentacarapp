import type { Metadata } from 'next';
import { listAudit } from '@/lib/audit';
import { listUsers } from '@/lib/domain/admin';
import { dt } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { Card, PageHead, Table } from '@/components/ui';
import { Filters } from '@/components/client/Filters';

export const metadata: Metadata = { title: 'Denetim izi' };

const ENTITIES = ['rental', 'reservation', 'customer', 'vehicle', 'payment', 'invoice', 'fine', 'toll', 'task', 'user', 'settings', 'file'];

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const [q] = await Promise.all([flat(searchParams), requirePerm('audit.view')]);
  const rows = listAudit({ ...q, limit: 1000 });
  return (
    <>
      <PageHead title="Denetim izi (audit log)" sub="Kim, ne zaman, hangi IP/cihazdan, hangi kayıtta ne yaptı — kişisel veri erişimleri (pii.*) dahil. Kayıtlar değiştirilemez." />
      <Filters
        fields={[
          { name: 'action', type: 'search', placeholder: 'İşlem ara (ör. pii, rental.activate, payment)…' },
          { name: 'entity', type: 'select', empty: 'Tüm varlıklar', options: ENTITIES },
          { name: 'entity_id', type: 'search', placeholder: 'Kayıt no' },
          { name: 'user_id', type: 'select', empty: 'Tüm kullanıcılar', options: listUsers().map((u) => [u.id, u.full_name] as [number, string]) },
        ]}
      />
      <Card>
        <Table cols={['Zaman', 'Kullanıcı', 'İşlem', 'Kayıt', 'Ayrıntı', 'IP / cihaz']} count={rows.length}>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="nowrap small">{dt(a.created_at.replace(' ', 'T'))}</td>
              <td>{a.user_name || <span className="muted">sistem</span>}</td>
              <td className="mono small">{a.action}</td>
              <td className="small">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
              <td className="mono small" style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{a.detail}</td>
              <td className="small muted" title={a.user_agent ?? ''}>{a.ip}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
