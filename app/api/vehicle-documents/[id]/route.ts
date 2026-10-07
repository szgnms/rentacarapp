import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteDocument, saveDocument } from '@/lib/domain/vehicles';

export const PUT = handler<{ id: string }>(({ params, body }) => saveDocument(toId(params.id), body), { perm: 'fleet.write' });
export const DELETE = handler<{ id: string }>(({ params }) => deleteDocument(toId(params.id)), { perm: 'fleet.write' });
