import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { saveExtra, deleteExtra } from '@/lib/domain/admin';

export const PUT = handler<{ id: string }>(({ params, body }) => saveExtra(toId(params.id), body), { admin: true });
export const DELETE = handler<{ id: string }>(({ params }) => deleteExtra(toId(params.id)), { admin: true });
