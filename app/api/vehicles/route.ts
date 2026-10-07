import { handler, created } from '@/lib/api';
import { createVehicle, listVehicles } from '@/lib/domain/vehicles';

export const GET = handler(({ query, user }) => listVehicles(query, user));
export const POST = handler(({ body }) => created(createVehicle(body)), { perm: 'fleet.write' });
