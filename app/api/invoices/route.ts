import { handler } from '@/lib/api';
import { listInvoices } from '@/lib/domain/finance';

export const GET = handler(({ query }) => listInvoices(query), { perm: 'finance.manage' });
