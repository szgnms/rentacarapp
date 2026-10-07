import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteDriver, saveDriver } from '@/lib/domain/customers';

export const PUT = handler<{ id: string; driverId: string }>(({ params, body }) => saveDriver(toId(params.id), toId(params.driverId), body), { perm: 'customers.write' });
export const DELETE = handler<{ id: string; driverId: string }>(({ params }) => deleteDriver(toId(params.id), toId(params.driverId)), { perm: 'customers.write' });
