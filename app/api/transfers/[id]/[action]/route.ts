import { handler } from '@/lib/api';
import { HttpError, toId } from '@/lib/core';
import { advanceTransfer } from '@/lib/domain/vehicles';

export const POST = handler<{ id: string; action: string }>(({ params, body }) => {
  if (!['depart', 'arrive', 'cancel'].includes(params.action)) throw new HttpError(404, 'Bilinmeyen işlem');
  return advanceTransfer(toId(params.id), params.action as 'depart' | 'arrive' | 'cancel', body);
}, { perm: 'fleet.write' });
