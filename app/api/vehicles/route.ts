import { handler, created } from '@/lib/api';
import { createVehicle, listVehicles } from '@/lib/domain/vehicles';

export const GET = handler(({ query, user }) => listVehicles(query, user));
export const POST = handler(async ({ body }) => created(await createVehicle(body)), { perm: 'fleet.write' });
