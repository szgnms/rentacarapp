import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { updateUser } from '@/lib/domain/admin';

export const PUT = handler<{ id: string }>(({ params, body, user, token }) => updateUser(toId(params.id), body, user, token), { perm: 'users.manage' });
