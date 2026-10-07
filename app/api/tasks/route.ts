import { handler, created } from '@/lib/api';
import { listTasks, saveTask } from '@/lib/domain/tasks';

export const GET = handler(({ query, user }) => listTasks(query, user));
export const POST = handler(({ body, user }) => created(saveTask(null, body, user)), { perm: 'tasks.manage' });
