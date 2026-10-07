import { handler, created } from '@/lib/api';
import { createPayment, listPayments } from '@/lib/domain/payments';

export const GET = handler(({ query, user }) => listPayments(query, user));
export const POST = handler(({ body, user }) => created(createPayment(body, user)), { perm: 'payments.collect' });
