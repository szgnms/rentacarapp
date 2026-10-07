import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { removeCharge } from '@/lib/domain/agreements';

export const DELETE = handler<{ id: string; chargeId: string }>(({ params, query, user }) => removeCharge(toId(params.id), toId(params.chargeId), user, query.reason), {
  perm: 'rentals.operate',
});
