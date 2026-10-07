import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { deleteTask, saveTask, setTaskStatus } from '@/lib/domain/tasks';

export const PUT = handler<{ id: string }>(({ params, body, user }) => saveTask(toId(params.id), body, user), { perm: 'tasks.manage' });
export const POST = handler<{ id: string }>(({ params, body, user }) => setTaskStatus(toId(params.id), body.status, body, user), { perm: 'tasks.manage' });
export const DELETE = handler<{ id: string }>(({ params }) => deleteTask(toId(params.id)), { perm: 'tasks.manage' });
