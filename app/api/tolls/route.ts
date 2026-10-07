import { handler } from '@/lib/api';
import { listTolls } from '@/lib/domain/tolls';

export const GET = handler(({ query }) => listTolls(query), { perm: 'tolls.manage' });
