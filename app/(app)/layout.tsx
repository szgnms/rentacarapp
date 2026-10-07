import { Shell } from '@/components/client/Nav';
import { getSettings } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { permissionsOf } from '@/lib/permissions';
import { pendingApprovalCount } from '@/lib/domain/approvals';
import { kabisAlarms } from '@/lib/domain/kabis';
import { openTaskCount } from '@/lib/domain/tasks';
import { tollFineSummary } from '@/lib/domain/tolls';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const badges = {
    approvals: await pendingApprovalCount(),
    kabis: await kabisAlarms(),
    tasks: await openTaskCount(),
    tolls: (await tollFineSummary()).unmatched_tolls,
  };
  return (
    <Shell user={user} company={(await getSettings()).company_name || 'Rent A Car'} permissions={permissionsOf(user.role)} badges={badges}>
      {children}
    </Shell>
  );
}
