import { handler, created } from '@/lib/api';
import { assertCan } from '@/lib/auth';
import { HttpError, toId } from '@/lib/core';
import { FILE_KINDS, saveFile } from '@/lib/files';
import type { Permission } from '@/lib/permissions';

/** Yüklenebilecek varlıklar ve gereken yetki. */
const ENTITY_PERMS: Record<string, Permission> = {
  customer: 'customers.write',
  driver: 'customers.write',
  rental: 'rentals.operate',
  vehicle: 'fleet.write',
  vehicle_document: 'fleet.write',
  damage: 'maintenance.write',
  fine: 'fines.manage',
};

export const POST = handler(
  async ({ req, user }) => {
    const form = await req.formData();
    const entity = String(form.get('entity') ?? '');
    const perm = ENTITY_PERMS[entity];
    if (!perm) throw new HttpError(400, 'Geçersiz varlık');
    assertCan(user, perm);
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Dosya gönderilmedi');
    const kind = String(form.get('kind') ?? 'attachment') as (typeof FILE_KINDS)[number];
    if (!FILE_KINDS.includes(kind)) throw new HttpError(400, 'Geçersiz dosya türü');
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(String(form.get('meta') ?? '{}'));
    } catch {
      throw new HttpError(400, 'Geçersiz meta');
    }
    return created(
      saveFile({ kind, entity, entityId: toId(form.get('entity_id')), name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()), meta }),
    );
  },
  { raw: true },
);
