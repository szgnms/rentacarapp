import { handler, created } from '@/lib/api';
import { toId } from '@/lib/core';
import { addCharge } from '@/lib/domain/agreements';

export const POST = handler<{ id: string }>(async ({ params, body, user }) => created(await addCharge(toId(params.id), body, user)), { perm: 'rentals.operate' });
