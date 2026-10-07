import { handler } from '@/lib/api';
import { listMessages } from '@/lib/domain/notify';

export const GET = handler(({ query }) => listMessages(query), { perm: 'notifications.manage' });
