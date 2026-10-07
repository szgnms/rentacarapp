import { handler } from '@/lib/api';
import { audit } from '@/lib/audit';
import { toId } from '@/lib/core';
import { readFile, voidFile } from '@/lib/files';

export const GET = handler<{ id: string }>(async ({ params, query }) => {
  const { file, data, intact } = await readFile(toId(params.id));
  // Kişisel veri içeren belgelere erişim loglanır (KVKK).
  if (file.entity === 'customer' || file.entity === 'driver') await audit('pii.file_view', file.entity, file.entity_id, { file_id: file.id });
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `${query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(file.original_name || `dosya-${file.id}`)}"`,
      'X-Content-SHA256': file.sha256,
      'X-Integrity': intact ? 'ok' : 'MISMATCH',
    },
  });
});

export const DELETE = handler<{ id: string }>(({ params, body }) => voidFile(toId(params.id), String(body.reason ?? 'Geçersiz kılındı')), {
  perm: 'records.delete',
});
