import { handler } from '@/lib/api';
import { HttpError, toId } from '@/lib/core';
import { cancelInvoice, creditNote, sendInvoice } from '@/lib/domain/finance';

export const POST = handler<{ id: string; action: string }>(({ params, body, user }) => {
  const id = toId(params.id);
  if (params.action === 'send') return sendInvoice(id);
  if (params.action === 'cancel') return cancelInvoice(id, body.reason);
  if (params.action === 'credit') return creditNote(id, body.amount, body.reason, user);
  throw new HttpError(404, 'Bilinmeyen işlem');
}, { perm: 'finance.manage' });
