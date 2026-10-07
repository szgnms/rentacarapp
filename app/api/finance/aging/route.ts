import { handler } from '@/lib/api';
import { receivablesAging } from '@/lib/domain/finance';

export const GET = handler(() => receivablesAging(), { perm: 'finance.manage' });
