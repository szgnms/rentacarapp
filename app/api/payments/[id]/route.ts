import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deletePayment } from '@/lib/domain/payments';

export const DELETE = handler<{ id: string }>(({ params }) => deletePayment(toId(params.id)), { perm: 'payments.delete' });
