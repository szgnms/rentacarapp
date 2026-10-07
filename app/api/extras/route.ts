import { handler, created } from '@/lib/api';
import { listExtras, saveExtra } from '@/lib/domain/admin';

export const GET = handler(() => listExtras());
export const POST = handler(({ body }) => created(saveExtra(null, body)), { admin: true });
