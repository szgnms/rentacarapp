import { handler, created } from '@/lib/api';
import { toId } from '@/lib/core';
import { addCharge } from '@/lib/domain/bookings';

export const POST = handler<{ id: string }>(({ params, body }) => created(addCharge(toId(params.id), body)));
