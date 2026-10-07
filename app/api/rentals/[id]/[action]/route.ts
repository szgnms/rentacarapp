import { handler } from '@/lib/api';
import { assertAdmin } from '@/lib/auth';
import { HttpError, toId } from '@/lib/core';
import { cancelRental, checkinRental, extendRental, previewCheckin } from '@/lib/domain/bookings';

export const POST = handler<{ id: string; action: string }>(({ params, body, user }) => {
  const id = toId(params.id);
  switch (params.action) {
    case 'extend':
      return extendRental(id, body);
    case 'checkin-preview':
      return previewCheckin(id, body);
    case 'checkin':
      return checkinRental(id, body, user);
    case 'cancel':
      assertAdmin(user);
      return cancelRental(id, body, user);
    default:
      throw new HttpError(404, 'Bilinmeyen işlem');
  }
});
