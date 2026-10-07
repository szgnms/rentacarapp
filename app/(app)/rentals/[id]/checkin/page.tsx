import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/db';
import { getRental } from '@/lib/domain/agreements';
import { listBranches } from '@/lib/domain/admin';
import { equipmentItems } from '@/lib/rules';
import { can } from '@/lib/permissions';
import { customerName, dt } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { PageHead } from '@/components/ui';
import { CheckinWizard } from '@/components/CheckinWizard';
import { ActionButton } from '@/components/client/ActionButton';

export const metadata: Metadata = { title: 'Araç iadesi' };

export default async function CheckinPage({ params }: { params: IdParams }) {
  const [{ id }, user] = await Promise.all([params, requirePerm('rentals.operate')]);
  const r = await orNotFound(() => getRental(Number(id)));
  if (r.status !== 'active') redirect(`/rentals/${r.id}`);
  return (
    <>
      <PageHead
        title={<>↩︎ Araç iadesi · {r.contract_no}</>}
        sub={`${customerName(r.customer)} · ${r.plate} · planlanan dönüş ${dt(r.planned_return_at)}${r.overdue ? ' · GECİKMİŞ' : ''}`}
        actions={<Link className="btn" href={`/rentals/${r.id}`}>Sözleşme</Link>}
      />
      {r.checkin ? (
        <CheckinWizard initial={r} equipment={(await equipmentItems()).map((e) => e.name)} branches={await listBranches()} canApprove={can(user, 'approve')} holdDays={(await getSettings()).deposit_hold_days} />
      ) : (
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="card-body">
            <p>İade muayenesi henüz başlatılmadı. Başlatınca çıkış fotoğraflarıyla karşılaştırmalı çekim, hasar tespiti ve hesap özeti adımları açılır.</p>
            <ActionButton url={`/api/rentals/${r.id}/checkin-start`} className="success big-btn">↩︎ İade muayenesini başlat</ActionButton>
          </div>
        </div>
      )}
    </>
  );
}
