import { handler } from '@/lib/api';
import { listAudit } from '@/lib/audit';

export const GET = handler(({ query }) => listAudit(query), { perm: 'audit.view' });
