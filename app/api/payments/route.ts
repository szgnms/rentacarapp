import { handler, created } from '@/lib/api';
import { createPayment, listPayments } from '@/lib/domain/bookings';

export const GET = handler(({ query }) => listPayments(query));
export const POST = handler(({ body, user }) => created(createPayment(body, user)));
