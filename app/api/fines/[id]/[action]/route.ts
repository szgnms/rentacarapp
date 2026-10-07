import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { fineAction } from '@/lib/domain/tolls';

export const POST = handler<{ id: string; action: string }>(({ params, body, user }) => fineAction(toId(params.id), params.action, body, user), { perm: 'fines.manage' });
