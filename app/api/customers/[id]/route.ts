import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteCustomer, getCustomer, updateCustomer } from '@/lib/domain/customers';

export const GET = handler<{ id: string }>(({ params }) => getCustomer(toId(params.id), { log: true }));
export const PUT = handler<{ id: string }>(({ params, body }) => updateCustomer(toId(params.id), body), { perm: 'customers.write' });
export const DELETE = handler<{ id: string }>(({ params }) => deleteCustomer(toId(params.id)), { perm: 'records.delete' });
