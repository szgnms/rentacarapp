import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { decideApproval } from '@/lib/domain/approvals';

export const POST = handler<{ id: string }>(({ params, body, user }) => decideApproval(toId(params.id), body.approve === true, body.note, user), { perm: 'approve' });
