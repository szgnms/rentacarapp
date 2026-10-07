import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { getReservation, updateReservation } from '@/lib/domain/bookings';

export const GET = handler<{ id: string }>(({ params }) => getReservation(toId(params.id)));
export const PUT = handler<{ id: string }>(({ params, body }) => updateReservation(toId(params.id), body));
