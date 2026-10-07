import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { getInvoice } from '@/lib/domain/finance';

export const GET = handler<{ id: string }>(({ params }) => getInvoice(toId(params.id)), { perm: 'finance.manage' });
