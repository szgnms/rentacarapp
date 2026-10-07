import { handler } from '@/lib/api';
import { HttpError, toId } from '@/lib/core';
import { resolveToll } from '@/lib/domain/tolls';

export const POST = handler<{ id: string; action: string }>(({ params, body, user }) => {
  if (!['assign', 'company', 'dispute'].includes(params.action)) throw new HttpError(404, 'Bilinmeyen işlem');
  return resolveToll(toId(params.id), params.action as 'assign' | 'company' | 'dispute', body, user);
}, { perm: 'tolls.manage' });
