import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { updateSession } from '@/lib/domain/agreements';

export const PATCH = handler<{ id: string }>(({ params, body }) => updateSession(toId(params.id), body), { perm: 'rentals.operate' });
