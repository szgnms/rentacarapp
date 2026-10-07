import { handler, created } from '@/lib/api';
import { listBranches, saveBranch } from '@/lib/domain/admin';

export const GET = handler(() => listBranches());
export const POST = handler(({ body }) => created(saveBranch(null, body)), { admin: true });
