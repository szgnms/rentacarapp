import { handler, created } from '@/lib/api';
import { createCustomer, listCustomers } from '@/lib/domain/customers';

export const GET = handler(({ query }) => listCustomers(query));
export const POST = handler(async ({ body, user }) => created(await createCustomer(body, user)), { perm: 'customers.write' });
