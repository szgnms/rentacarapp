import { handler, created } from '@/lib/api';
import { createWalkInRental, listRentals } from '@/lib/domain/bookings';

export const GET = handler(({ query }) => listRentals(query));
export const POST = handler(({ body, user }) => created(createWalkInRental(body, user)));
