import { handler, created } from '@/lib/api';
import { toId } from '@/lib/core';
import { addCharge } from '@/lib/domain/agreements';

export const POST = handler<{ id: string }>(({ params, body, user }) => created(addCharge(toId(params.id), body, user)), { perm: 'rentals.operate' });
