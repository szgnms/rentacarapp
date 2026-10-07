// Onay talebi oluşturma (onayı gerektiren modüller bunu kullanır; uygulama mantığı approvals.ts'de).
import { insertRow, one } from '../db';
import { audit } from '../audit';
import type { SessionUser } from '../types';

export type ApprovalType = 'discount' | 'deposit_refund' | 'damage_waiver' | 'charge_waiver';

export interface Approval {
  id: number;
  type: ApprovalType;
  entity: string;
  entity_id: number;
  amount: number;
  reason: string | null;
  payload: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: number | null;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export function requestApproval(
  type: ApprovalType, entity: string, entityId: number, amount: number, reason: string | null, payload: Record<string, unknown>, user: SessionUser,
): Approval {
  const existing = one<Approval>(
    "SELECT * FROM approvals WHERE type = ? AND entity = ? AND entity_id = ? AND status = 'pending' AND payload = ?",
    type, entity, entityId, JSON.stringify(payload),
  );
  if (existing) return existing;
  const id = insertRow('approvals', {
    type, entity, entity_id: entityId, amount, reason, payload: JSON.stringify(payload), requested_by: user.id,
  });
  audit('approval.request', entity, entityId, { approval_id: id, type, amount, reason });
  return one<Approval>('SELECT * FROM approvals WHERE id = ?', id)!;
}

export const pendingApproval = (type: ApprovalType, entity: string, entityId: number) =>
  one<Approval>("SELECT * FROM approvals WHERE type = ? AND entity = ? AND entity_id = ? AND status = 'pending'", type, entity, entityId);
