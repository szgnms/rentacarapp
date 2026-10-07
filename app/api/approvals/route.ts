import { handler } from '@/lib/api';
import { listApprovals } from '@/lib/domain/approvals';

export const GET = handler(({ query }) => listApprovals(query.status));
