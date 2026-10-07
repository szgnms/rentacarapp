import { handler } from '@/lib/api';
import { agencyStatement } from '@/lib/domain/finance';

export const GET = handler(({ query }) => agencyStatement(query), { perm: 'finance.manage' });
