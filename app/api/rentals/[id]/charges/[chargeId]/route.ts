import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteCharge } from '@/lib/domain/bookings';

export const DELETE = handler<{ id: string; chargeId: string }>(({ params }) => deleteCharge(toId(params.id), toId(params.chargeId)), { admin: true });
