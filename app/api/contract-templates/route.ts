import { handler, created } from '@/lib/api';
import { listContractTemplates, saveContractTemplate } from '@/lib/domain/templates';

export const GET = handler(() => listContractTemplates());
export const POST = handler(async ({ body, user }) => created(await saveContractTemplate(null, body, user)), { perm: 'settings.manage' });
