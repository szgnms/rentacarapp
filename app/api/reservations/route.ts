import { handler, created } from '@/lib/api';
import { createReservation, listReservations } from '@/lib/domain/reservations';

export const GET = handler(({ query, user }) => listReservations(query, user));
export const POST = handler(({ body, user }) => created(createReservation(body, user)), { perm: 'reservations.write' });
