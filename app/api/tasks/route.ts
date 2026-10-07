import { handler, created } from '@/lib/api';
import { listTasks, saveTask } from '@/lib/domain/tasks';

export const GET = handler(({ query, user }) => listTasks(query, user));
export const POST = handler(async ({ body, user }) => created(await saveTask(null, body, user)), { perm: 'tasks.manage' });
