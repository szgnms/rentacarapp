import { handler } from '@/lib/api';
import { listKabis } from '@/lib/domain/kabis';

export const GET = handler(({ query }) => listKabis(query), { perm: 'kabis.manage' });
