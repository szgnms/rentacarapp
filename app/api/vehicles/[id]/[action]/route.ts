import { handler } from '@/lib/api';
import { HttpError, toId } from '@/lib/core';
import { sellVehicle, topUpHgs } from '@/lib/domain/vehicles';

export const POST = handler<{ id: string; action: string }>(({ params, body, user }) => {
  const id = toId(params.id);
  if (params.action === 'sell') return sellVehicle(id, body);
  if (params.action === 'hgs-topup') return topUpHgs(id, body.amount, user);
  throw new HttpError(404, 'Bilinmeyen işlem');
}, { perm: 'fleet.write' });
