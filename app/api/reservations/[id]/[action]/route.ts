import { handler, created } from '@/lib/api';
import { HttpError, toId } from '@/lib/core';
import { checkoutReservation, transitionReservation } from '@/lib/domain/bookings';

export const POST = handler<{ id: string; action: string }>(({ params, body, user }) => {
  const id = toId(params.id);
  switch (params.action) {
    case 'confirm':
    case 'cancel':
    case 'no-show':
      return transitionReservation(id, params.action, body.reason);
    case 'checkout':
      return created(checkoutReservation(id, body, user));
    default:
      throw new HttpError(404, 'Bilinmeyen işlem');
  }
});
