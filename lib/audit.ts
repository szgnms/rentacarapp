import { all, run } from './db';
import { getContext } from './context';

/** Denetim izi kaydı (kim, ne zaman, hangi IP/cihaz, ne yaptı). */
export function audit(action: string, entity: string | null, entityId: number | null, detail?: unknown) {
  const ctx = getContext();
  run(
    'INSERT INTO audit_log(user_id, action, entity, entity_id, detail, ip, user_agent) VALUES (?,?,?,?,?,?,?)',
    ctx.user?.id ?? null, action, entity, entityId, detail === undefined ? null : JSON.stringify(detail), ctx.ip, ctx.userAgent,
  );
}

export interface AuditRow {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export function listAudit(f: { entity?: string; entity_id?: string; user_id?: string; action?: string; limit?: number } = {}): AuditRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.entity) { where.push('a.entity = ?'); params.push(f.entity); }
  if (f.entity_id) { where.push('a.entity_id = ?'); params.push(Number(f.entity_id)); }
  if (f.user_id) { where.push('a.user_id = ?'); params.push(Number(f.user_id)); }
  if (f.action) { where.push('a.action LIKE ?'); params.push(`%${f.action}%`); }
  return all<AuditRow>(
    `SELECT a.*, u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ${Math.min(2000, f.limit ?? 500)}`,
    ...params,
  );
}
