import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { getReservation, updateReservation } from '@/lib/domain/reservations';

export const GET = handler<{ id: string }>(({ params }) => getReservation(toId(params.id)));
export const PUT = handler<{ id: string }>(({ params, body, user }) => updateReservation(toId(params.id), body, user), { perm: 'reservations.write' });
