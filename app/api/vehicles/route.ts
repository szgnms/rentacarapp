import { handler, created } from '@/lib/api';
import { createVehicle, listVehicles } from '@/lib/domain/fleet';

export const GET = handler(({ query }) => listVehicles(query));
export const POST = handler(({ body }) => created(createVehicle(body)));
