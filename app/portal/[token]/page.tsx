import type { Metadata } from 'next';
import { getPortal } from '@/lib/domain/portal';
import { orNotFound } from '@/lib/page';
import { PortalView } from '@/components/PortalView';

export const metadata: Metadata = { title: 'Rezervasyonum', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = orNotFound(() => getPortal(token));
  return <PortalView token={token} initial={view} />;
}
