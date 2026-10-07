import { handler, created } from '@/lib/api';
import { createUser, listUsers } from '@/lib/domain/admin';

export const GET = handler(() => listUsers(), { perm: 'users.manage' });
export const POST = handler(({ body }) => created(createUser(body)), { perm: 'users.manage' });
