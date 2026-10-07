import { publicHandler } from '@/lib/api';
import { HttpError } from '@/lib/core';
import { portalUpload } from '@/lib/domain/portal';

export const POST = publicHandler<{ token: string }>(async ({ params, req }) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Dosya gönderilmedi');
  return portalUpload(params.token, String(form.get('doc_type') ?? ''), { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) });
}, { raw: true });
