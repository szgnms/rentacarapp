import { Shell } from '@/components/client/Nav';
import { getSettings } from '@/lib/db';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <Shell user={user} company={getSettings().company_name || 'Rent A Car'}>
      {children}
    </Shell>
  );
}
