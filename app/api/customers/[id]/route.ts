import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteCustomer, getCustomer, updateCustomer } from '@/lib/domain/fleet';

export const GET = handler<{ id: string }>(({ params }) => getCustomer(toId(params.id)));
export const PUT = handler<{ id: string }>(({ params, body }) => updateCustomer(toId(params.id), body));
export const DELETE = handler<{ id: string }>(({ params }) => deleteCustomer(toId(params.id)), { admin: true });
