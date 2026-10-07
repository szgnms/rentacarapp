import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { saveExtra, deleteExtra } from '@/lib/domain/admin';

export const PUT = handler<{ id: string }>(({ params, body }) => saveExtra(toId(params.id), body), { perm: 'settings.manage' });
export const DELETE = handler<{ id: string }>(({ params }) => deleteExtra(toId(params.id)), { perm: 'settings.manage' });
