import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { getRental, updateDraft } from '@/lib/domain/agreements';

export const GET = handler<{ id: string }>(({ params }) => getRental(toId(params.id)));
export const PATCH = handler<{ id: string }>(({ params, body }) => updateDraft(toId(params.id), body), { perm: 'rentals.operate' });
