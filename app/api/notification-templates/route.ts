import { handler, created } from '@/lib/api';
import { listNotificationTemplates, saveNotificationTemplate } from '@/lib/domain/templates';

export const GET = handler(() => listNotificationTemplates(), { perm: 'notifications.manage' });
export const POST = handler(async ({ body }) => created(await saveNotificationTemplate(null, body)), { perm: 'notifications.manage' });
