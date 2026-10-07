import { handler, created } from '@/lib/api';
import { listNotificationTemplates, saveNotificationTemplate } from '@/lib/domain/templates';

export const GET = handler(() => listNotificationTemplates(), { perm: 'notifications.manage' });
export const POST = handler(({ body }) => created(saveNotificationTemplate(null, body)), { perm: 'notifications.manage' });
