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
    approvals: pendingApprovalCount(),
    kabis: kabisAlarms(),
    tasks: openTaskCount(),
    tolls: tollFineSummary().unmatched_tolls,
  };
  return (
    <Shell user={user} company={getSettings().company_name || 'Rent A Car'} permissions={permissionsOf(user.role)} badges={badges}>
      {children}
    </Shell>
  );
}
