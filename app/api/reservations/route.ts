import { handler, created } from '@/lib/api';
import { createReservation, listReservations } from '@/lib/domain/bookings';

export const GET = handler(({ query }) => listReservations(query));
export const POST = handler(({ body, user }) => created(createReservation(body, user)));
