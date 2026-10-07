import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteVehicle, getVehicle, updateVehicle } from '@/lib/domain/vehicles';

export const GET = handler<{ id: string }>(({ params }) => getVehicle(toId(params.id)));
export const PUT = handler<{ id: string }>(({ params, body }) => updateVehicle(toId(params.id), body), { perm: 'fleet.write' });
export const DELETE = handler<{ id: string }>(({ params }) => deleteVehicle(toId(params.id)), { perm: 'records.delete' });
