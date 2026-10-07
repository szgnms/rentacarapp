import { handler, created } from '@/lib/api';
import { listRentals, startWalkIn } from '@/lib/domain/agreements';

export const GET = handler(({ query, user }) => listRentals(query, user));
export const POST = handler(async ({ body, user }) => created(await startWalkIn(body, user)), { perm: 'rentals.operate' });
