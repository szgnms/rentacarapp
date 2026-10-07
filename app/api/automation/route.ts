import { handler } from '@/lib/api';
import { runAutomation } from '@/lib/jobs';

export const POST = handler(() => runAutomation(), { perm: 'notifications.manage' });
