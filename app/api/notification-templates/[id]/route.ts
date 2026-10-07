import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { saveNotificationTemplate } from '@/lib/domain/templates';

export const PUT = handler<{ id: string }>(({ params, body }) => saveNotificationTemplate(toId(params.id), body), { perm: 'notifications.manage' });
