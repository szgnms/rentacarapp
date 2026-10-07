import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { voidDamageMark } from '@/lib/domain/agreements';

export const DELETE = handler<{ id: string }>(({ params }) => voidDamageMark(toId(params.id)), { perm: 'rentals.operate' });
