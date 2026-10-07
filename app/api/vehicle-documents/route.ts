import { handler, created } from '@/lib/api';
import { saveDocument } from '@/lib/domain/vehicles';

export const POST = handler(async ({ body }) => created(await saveDocument(null, body)), { perm: 'fleet.write' });
