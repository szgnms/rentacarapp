import { handler, created } from '@/lib/api';
import { createTransfer, listTransfers } from '@/lib/domain/vehicles';

export const GET = handler(({ query }) => listTransfers(query));
export const POST = handler(async ({ body, user }) => created(await createTransfer(body, user)), { perm: 'fleet.write' });
