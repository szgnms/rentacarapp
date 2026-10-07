import { publicHandler } from '@/lib/api';
import { HttpError, toId } from '@/lib/core';
import { readFile } from '@/lib/files';
import { portalFileAllowed } from '@/lib/domain/portal';

export const GET = publicHandler<{ token: string; fileId: string }>(({ params }) => {
  const id = toId(params.fileId);
  if (!portalFileAllowed(params.token, id)) throw new HttpError(404, 'Belge bulunamadı');
  const { file, data } = readFile(id);
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': file.mime, 'Content-Disposition': `inline; filename="${encodeURIComponent(file.original_name || 'belge.pdf')}"`, 'X-Content-SHA256': file.sha256 },
  });
});
