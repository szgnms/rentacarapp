import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteMaintenance, updateMaintenance } from '@/lib/domain/service';

export const PUT = handler<{ id: string }>(({ params, body }) => updateMaintenance(toId(params.id), body));
export const DELETE = handler<{ id: string }>(({ params }) => deleteMaintenance(toId(params.id)), { admin: true });
