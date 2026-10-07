import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteDamage, updateDamage } from '@/lib/domain/service';

export const PUT = handler<{ id: string }>(({ params, body }) => updateDamage(toId(params.id), body));
export const DELETE = handler<{ id: string }>(({ params }) => deleteDamage(toId(params.id)), { admin: true });
