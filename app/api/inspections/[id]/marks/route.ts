import { handler, created } from '@/lib/api';
import { toId } from '@/lib/core';
import { addDamageMark } from '@/lib/domain/agreements';

export const POST = handler<{ id: string }>(({ params, body }) => created(addDamageMark(toId(params.id), body)), { perm: 'rentals.operate' });
