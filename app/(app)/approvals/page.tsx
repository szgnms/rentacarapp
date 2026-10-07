import type { Metadata } from 'next';
import Link from 'next/link';
import { APPROVAL_LABELS, listApprovals } from '@/lib/domain/approvals';
import { can } from '@/lib/permissions';
import { dt, money } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Card, PageHead, Table, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { FormButton } from '@/components/client/FormButton';

export const metadata: Metadata = { title: 'Onaylar' };

const HREF: Record<string, string> = { reservation: '/reservations/', rental: '/rentals/', damage: '/maintenance?tab=damages&id=' };

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const status = q.status ?? 'pending';
  const rows = await listApprovals(status || undefined);
  const approver = can(user, 'approve');
  return (
    <>
      <PageHead title="Onay akışı" sub="Limit üstü indirim, depozito iadesi, hasar ve ücret affı talepleri — onaylandığında işlem otomatik uygulanır" />
      {!approver ? <div className="alert info">Onay yetkiniz yok; yalnızca talepleri görüntüleyebilirsiniz.</div> : null}
      <Filters defaults={{ status: 'pending' }} fields={[{ name: 'status', type: 'select', empty: 'Tümü', options: [['pending', 'Bekleyen'], ['approved', 'Onaylanan'], ['rejected', 'Reddedilen']] }]} />
      <Card>
        <Table cols={['Talep', 'Tip', 'Kayıt', ['Tutar', 'num'], 'Gerekçe', 'Talep eden', 'Karar', '']} count={rows.length} empty="Talep yok">
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="nowrap">{dt(a.created_at.replace(' ', 'T'))}</td>
              <td>{APPROVAL_LABELS[a.type] ?? a.type}</td>
              <td>{HREF[a.entity] ? <Link href={`${HREF[a.entity]}${a.entity_id}`}>{a.ref ?? `#${a.entity_id}`}</Link> : a.ref}</td>
              <td className="num">{money(a.amount)}</td>
              <td className="small">{a.reason}</td>
              <td>{a.requested_by_name || '—'}</td>
              <td>
                {a.status === 'pending' ? <Tag tone="warn">Bekliyor</Tag> : <Tag tone={a.status === 'approved' ? 'ok' : 'danger'}>{a.status === 'approved' ? 'Onaylandı' : 'Reddedildi'}</Tag>}
                {a.decided_by_name ? <div className="muted small">{a.decided_by_name} · {dt(a.decided_at)}{a.decision_note ? ` · ${a.decision_note}` : ''}</div> : null}
              </td>
              <td className="right nowrap">
                {approver && a.status === 'pending' ? (
                  <>
                    <FormButton title="Onayla" url={`/api/approvals/${a.id}`} extra={{ approve: true }} className="sm success" submitLabel="Onayla" success="Talep onaylandı ve uygulandı"
                      fields={[{ name: 'note', label: 'Not', span: 12 }]}>
                      Onayla
                    </FormButton>{' '}
                    <FormButton title="Reddet" url={`/api/approvals/${a.id}`} extra={{ approve: false }} className="sm danger" submitLabel="Reddet" success="Talep reddedildi"
                      fields={[{ name: 'note', label: 'Red gerekçesi', span: 12 }]}>
                      Reddet
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
