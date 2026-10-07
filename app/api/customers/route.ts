import { handler, created } from '@/lib/api';
import { createCustomer, listCustomers } from '@/lib/domain/fleet';

export const GET = handler(({ query }) => listCustomers(query));
export const POST = handler(({ body }) => created(createCustomer(body)));
