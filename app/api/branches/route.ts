import { handler, created } from '@/lib/api';
import { listBranches, saveBranch } from '@/lib/domain/admin';

export const GET = handler(() => listBranches());
export const POST = handler(async ({ body }) => created(await saveBranch(null, body)), { perm: 'settings.manage' });
