import { handler } from '@/lib/api';
import { toId } from '@/lib/core';
import { sendKabis } from '@/lib/domain/kabis';
import { kabisPdf } from '@/lib/documents';

export const POST = handler<{ id: string }>(async ({ params, body }) => {
  const id = toId(params.id);
  if (body.pdf) return kabisPdf(id);
  return sendKabis(id, body);
}, { perm: 'kabis.manage' });
