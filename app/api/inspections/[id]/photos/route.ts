import { handler, created } from '@/lib/api';
import { HttpError, toId } from '@/lib/core';
import { saveFile } from '@/lib/files';
import { PHOTO_ANGLES } from '@/lib/inspection';
import { addInspectionPhoto, getSession } from '@/lib/domain/agreements';

/** Rehberli fotoğraf: açı + EXIF/GPS/cihaz meta verisi ile değiştirilemez arşive yazılır. */
export const POST = handler<{ id: string }>(async ({ params, req }) => {
  const session = getSession(toId(params.id));
  const form = await req.formData();
  const angle = String(form.get('angle') ?? '');
  if (!PHOTO_ANGLES.some((a) => a.key === angle) && !angle.startsWith('damage')) throw new HttpError(400, 'Geçersiz fotoğraf açısı');
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Fotoğraf gönderilmedi');
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(form.get('meta') ?? '{}'));
  } catch {
    meta = {};
  }
  const stored = saveFile({
    kind: 'photo', entity: 'rental', entityId: session.rental_id, name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()),
    meta: { ...meta, angle, session_id: session.id, inspection: session.kind },
  });
  if (angle.startsWith('damage')) return created({ file: stored });
  return created(addInspectionPhoto(session.id, angle, stored));
}, { perm: 'rentals.operate', raw: true });
