import { handler, created } from '@/lib/api';
import { toId } from '@/lib/core';
import { saveDriver } from '@/lib/domain/customers';

export const POST = handler<{ id: string }>(async ({ params, body }) => created(await saveDriver(toId(params.id), null, body)), { perm: 'customers.write' });
