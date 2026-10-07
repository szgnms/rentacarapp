import { handler, created } from '@/lib/api';
import { saveDocument } from '@/lib/domain/vehicles';

export const POST = handler(({ body }) => created(saveDocument(null, body)), { perm: 'fleet.write' });
