import { handler } from '@/lib/api';
import { importFines } from '@/lib/domain/tolls';

export const POST = handler(({ body, user }) => importFines(String(body.csv ?? ''), user), { perm: 'fines.manage' });
