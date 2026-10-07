import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deletePayment } from '@/lib/domain/bookings';

export const DELETE = handler<{ id: string }>(({ params }) => deletePayment(toId(params.id)), { admin: true });
