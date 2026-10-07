import { handler, created } from '@/lib/api';
import { createUser, listUsers } from '@/lib/domain/admin';

export const GET = handler(() => listUsers(), { admin: true });
export const POST = handler(({ body }) => created(createUser(body)), { admin: true });
