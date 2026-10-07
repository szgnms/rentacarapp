import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { retryMessage } from '@/lib/domain/notify';

export const POST = handler<{ id: string }>(({ params }) => retryMessage(toId(params.id)), { perm: 'notifications.manage' });
