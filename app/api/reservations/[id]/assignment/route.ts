import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { assignVehicle, assignmentOptions } from '@/lib/domain/reservations';

export const GET = handler<{ id: string }>(({ params }) => assignmentOptions(toId(params.id)));
export const POST = handler<{ id: string }>(({ params, body }) => assignVehicle(toId(params.id), body.vehicle_id ? Number(body.vehicle_id) : null), { perm: 'reservations.write' });
