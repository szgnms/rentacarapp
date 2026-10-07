import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteExpense, updateExpense } from '@/lib/domain/service';

export const PUT = handler<{ id: string }>(({ params, body }) => updateExpense(toId(params.id), body));
export const DELETE = handler<{ id: string }>(({ params }) => deleteExpense(toId(params.id)), { admin: true });
