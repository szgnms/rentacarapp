// Değiştirilemez dosya deposu: her dosya SHA-256 özeti, yükleyen, zaman ve meta veriyle kaydedilir.
// Dosyalar silinmez; yalnızca "geçersiz" işaretlenebilir (WORM yaklaşımı — hukuki delil değeri için).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { all, insertRow, one, run } from './db';
import { HttpError } from './core';
import { audit } from './audit';
import { getContext } from './context';

export interface StoredFile {
  id: number;
  kind: string;
  entity: string;
  entity_id: number;
  original_name: string | null;
  mime: string;
  size: number;
  path: string;
  sha256: string;
  meta: string | null;
  uploaded_by: number | null;
  voided_at: string | null;
  created_at: string;
}

export const FILE_KINDS = ['photo', 'signature', 'document', 'pdf', 'attachment'] as const;
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
};
const MAX_SIZE = 15 * 1024 * 1024;

export function storageRoot(): string {
  if (process.env.UPLOAD_DIR) return process.env.UPLOAD_DIR;
  const dbFile = process.env.DB_FILE;
  if (dbFile === ':memory:') return path.join(os.tmpdir(), 'rentacar-test-uploads');
  return path.join(dbFile ? path.dirname(dbFile) : path.join(process.cwd(), 'data'), 'uploads');
}

export const sha256 = (buf: Buffer | Uint8Array | string) => crypto.createHash('sha256').update(buf).digest('hex');

export interface SaveFileInput {
  kind: (typeof FILE_KINDS)[number];
  entity: string;
  entityId: number;
  name?: string | null;
  mime: string;
  data: Buffer;
  meta?: Record<string, unknown>;
}

export function saveFile(input: SaveFileInput): StoredFile {
  const ext = ALLOWED_MIME[input.mime];
  if (!ext) throw new HttpError(415, `Desteklenmeyen dosya türü: ${input.mime}`);
  if (!input.data.length) throw new HttpError(400, 'Dosya boş');
  if (input.data.length > MAX_SIZE) throw new HttpError(413, 'Dosya en fazla 15 MB olabilir');
  const hash = sha256(input.data);
  const d = new Date();
  const rel = path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), `${hash.slice(0, 16)}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
  const abs = path.join(storageRoot(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, input.data, { flag: 'wx' });
  const ctx = getContext();
  const meta = { ...input.meta, uploaded_at: d.toISOString(), ip: ctx.ip, device: ctx.userAgent };
  const id = insertRow('files', {
    kind: input.kind,
    entity: input.entity,
    entity_id: input.entityId,
    original_name: input.name ?? null,
    mime: input.mime,
    size: input.data.length,
    path: rel,
    sha256: hash,
    meta: JSON.stringify(meta),
    uploaded_by: ctx.user?.id ?? null,
  });
  audit('file.upload', input.entity, input.entityId, { file_id: id, kind: input.kind, sha256: hash, ...input.meta });
  return getFile(id);
}

export function getFile(id: number): StoredFile {
  const f = one<StoredFile>('SELECT * FROM files WHERE id = ?', id);
  if (!f) throw new HttpError(404, 'Dosya bulunamadı');
  return f;
}

/** Dosya içeriğini okur ve bütünlüğünü (hash) doğrular. */
export function readFile(id: number): { file: StoredFile; data: Buffer; intact: boolean } {
  const file = getFile(id);
  const abs = path.join(storageRoot(), file.path);
  if (!fs.existsSync(abs)) throw new HttpError(410, 'Dosya depoda bulunamadı');
  const data = fs.readFileSync(abs);
  return { file, data, intact: sha256(data) === file.sha256 };
}

export function listFiles(entity: string, entityId: number, kind?: string): StoredFile[] {
  return kind
    ? all<StoredFile>('SELECT * FROM files WHERE entity = ? AND entity_id = ? AND kind = ? AND voided_at IS NULL ORDER BY id', entity, entityId, kind)
    : all<StoredFile>('SELECT * FROM files WHERE entity = ? AND entity_id = ? AND voided_at IS NULL ORDER BY id', entity, entityId);
}

export function voidFile(id: number, reason: string) {
  const f = getFile(id);
  if (f.voided_at) return f;
  run("UPDATE files SET voided_at = datetime('now','localtime') WHERE id = ?", id);
  audit('file.void', f.entity, f.entity_id, { file_id: id, reason });
  return getFile(id);
}

/** data:image/png;base64,... → Buffer */
export function decodeDataUrl(dataUrl: string): { mime: string; data: Buffer } {
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new HttpError(400, 'Geçersiz görüntü verisi');
  return { mime: m[1], data: Buffer.from(m[2], 'base64') };
}

export const fileMeta = (f: StoredFile): Record<string, unknown> => {
  try {
    return f.meta ? JSON.parse(f.meta) : {};
  } catch {
    return {};
  }
};
