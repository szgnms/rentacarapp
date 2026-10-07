import { handler } from '@/lib/api';
import { assertCan } from '@/lib/auth';
import { HttpError, toId } from '@/lib/core';
import {
  activateRental, cancelRental, completeCheckin, extendRental, previewCheckin, releaseDepositHold, signRental, startCheckin, swapVehicle,
} from '@/lib/domain/agreements';
import { issueInvoiceForRental } from '@/lib/domain/finance';

export const POST = handler<{ id: string; action: string }>(async ({ params, body, user }) => {
  const id = toId(params.id);
  switch (params.action) {
    case 'sign':
      assertCan(user, 'rentals.operate');
      return signRental(id, body, user);
    case 'activate':
      assertCan(user, 'rentals.operate');
      return activateRental(id, body, user);
    case 'extend':
      assertCan(user, 'reservations.write');
      return extendRental(id, body);
    case 'swap':
      assertCan(user, 'rentals.operate');
      return swapVehicle(id, body, user);
    case 'checkin-start':
      assertCan(user, 'rentals.operate');
      return startCheckin(id, user);
    case 'checkin-preview':
      return previewCheckin(id, body);
    case 'checkin':
      assertCan(user, 'rentals.operate');
      return completeCheckin(id, body, user);
    case 'release-hold':
      assertCan(user, 'payments.refund');
      return releaseDepositHold(id, user);
    case 'invoice':
      assertCan(user, 'finance.manage');
      return (await issueInvoiceForRental(id, user)) ?? { ok: true, message: 'Faturalanacak fark yok' };
    case 'cancel':
      assertCan(user, 'rentals.cancel');
      return cancelRental(id, body, user);
    default:
      throw new HttpError(404, 'Bilinmeyen işlem');
  }
});
