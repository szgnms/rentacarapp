import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { saveContractTemplate, setContractTemplateActive } from '@/lib/domain/templates';

export const PUT = handler<{ id: string }>(({ params, body, user }) => saveContractTemplate(toId(params.id), body, user), { perm: 'settings.manage' });
export const PATCH = handler<{ id: string }>(({ params, body }) => setContractTemplateActive(toId(params.id), body.active), { perm: 'settings.manage' });
