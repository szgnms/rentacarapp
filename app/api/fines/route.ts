import { handler, created } from '@/lib/api';
import { createFine, listFines } from '@/lib/domain/tolls';

export const GET = handler(({ query }) => listFines(query), { perm: 'fines.manage' });
export const POST = handler(async ({ body, user }) => created(await createFine(body, user)), { perm: 'fines.manage' });
