import { handler, created } from '@/lib/api';
import { createFine, listFines } from '@/lib/domain/tolls';

export const GET = handler(({ query }) => listFines(query), { perm: 'fines.manage' });
export const POST = handler(({ body, user }) => created(createFine(body, user)), { perm: 'fines.manage' });
