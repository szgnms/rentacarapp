import { handler, created } from '@/lib/api';
import { createReservation, listReservations } from '@/lib/domain/reservations';

export const GET = handler(({ query, user }) => listReservations(query, user));
export const POST = handler(async ({ body, user }) => created(await createReservation(body, user)), { perm: 'reservations.write' });
