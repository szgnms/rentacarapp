import { handler } from '@/lib/api';
import { rematchTolls } from '@/lib/domain/tolls';

export const POST = handler(({ user }) => rematchTolls(user), { perm: 'tolls.manage' });
