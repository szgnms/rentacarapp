import { handler } from '@/lib/api';
import { importTolls } from '@/lib/domain/tolls';

export const POST = handler(({ body, user }) => importTolls(String(body.csv ?? ''), user), { perm: 'tolls.manage' });
