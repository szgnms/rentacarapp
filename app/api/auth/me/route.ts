import { handler } from '@/lib/api';
import { permissionsOf } from '@/lib/permissions';

export const GET = handler(({ user }) => ({ ...user, permissions: permissionsOf(user.role) }));
