import { handler, created } from '@/lib/api';
import { assertCan } from '@/lib/auth';
import { HttpError, toId } from '@/lib/core';
import { transitionReservation } from '@/lib/domain/reservations';
import { startCheckoutFromReservation } from '@/lib/domain/agreements';

export const POST = handler<{ id: string; action: string }>(({ params, body, user }) => {
  const id = toId(params.id);
  switch (params.action) {
    case 'confirm':
      assertCan(user, 'reservations.write');
      return transitionReservation(id, 'confirm', body, user);
    case 'cancel':
    case 'no-show':
      assertCan(user, 'reservations.cancel');
      return transitionReservation(id, params.action, body, user);
    case 'checkout':
      assertCan(user, 'rentals.operate');
      return created(startCheckoutFromReservation(id, body, user));
    default:
      throw new HttpError(404, 'Bilinmeyen işlem');
  }
});
