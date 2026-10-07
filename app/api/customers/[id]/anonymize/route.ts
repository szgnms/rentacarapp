import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { anonymizeCustomer } from '@/lib/domain/customers';

export const POST = handler<{ id: string }>(({ params, body }) => anonymizeCustomer(toId(params.id), body.reason), { perm: 'customers.pii' });
