import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { saveBranch, deleteBranch } from '@/lib/domain/admin';

export const PUT = handler<{ id: string }>(({ params, body }) => saveBranch(toId(params.id), body), { perm: 'settings.manage' });
export const DELETE = handler<{ id: string }>(({ params }) => deleteBranch(toId(params.id)), { perm: 'settings.manage' });
