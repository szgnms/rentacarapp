// Onay akışı: indirim, depozito iadesi, hasar affı, ücret affı. Onaylanınca işlem otomatik uygulanır.
import { all, one, run, tx } from '../db';
import { HttpError, nowLocal, str } from '../core';
import { audit } from '../audit';
import { applyDiscountDecision } from './reservations';
import { applyChargeWaiver } from './agreements';
import { insertPayment } from './payments';
import type { Approval } from './approval-core';
import type { SessionUser } from '../types';

export type ApprovalRow = Approval & { requested_by_name: string | null; decided_by_name: string | null; ref: string | null };

export const APPROVAL_LABELS: Record<string, string> = {
  discount: 'İndirim (limit üstü)',
  deposit_refund: 'Depozito iadesi',
  damage_waiver: 'Hasar affı',
  charge_waiver: 'Ücret affı',
};

export function listApprovals(status?: string): Promise<ApprovalRow[]> {
  return all<ApprovalRow>(
    `SELECT a.*, u.full_name AS requested_by_name, d.full_name AS decided_by_name,
            CASE a.entity WHEN 'reservation' THEN (SELECT code FROM reservations WHERE id = a.entity_id)
                          WHEN 'rental' THEN (SELECT contract_no FROM rentals WHERE id = a.entity_id)
                          WHEN 'damage' THEN (SELECT 'Hasar #' || id FROM damages WHERE id = a.entity_id) END AS ref
     FROM approvals a LEFT JOIN users u ON u.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by
     ${status ? 'WHERE a.status = ?' : ''} ORDER BY a.status = 'pending' DESC, a.id DESC LIMIT 300`,
    ...(status ? [status] : []),
  );
}

export const pendingApprovalCount = async () => ((await one<{ n: number }>("SELECT COUNT(*) n FROM approvals WHERE status = 'pending'"))?.n ?? 0);

export async function decideApproval(id: number, approve: boolean, note: unknown, user: SessionUser) {
  const a = await one<Approval>('SELECT * FROM approvals WHERE id = ?', id);
  if (!a) throw new HttpError(404, 'Onay talebi bulunamadı');
  if (a.status !== 'pending') throw new HttpError(409, 'Talep zaten sonuçlanmış');
  if (a.requested_by === user.id && user.role !== 'admin') throw new HttpError(403, 'Kendi talebinizi onaylayamazsınız');
  await tx(async () => {
    await run('UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?',
      approve ? 'approved' : 'rejected', user.id, nowLocal(), str(note), id);
    const payload = a.payload ? (JSON.parse(a.payload) as Record<string, string | number | null>) : {};
    switch (a.type) {
      case 'discount':
        await applyDiscountDecision(a.entity_id, approve);
        break;
      case 'deposit_refund':
        if (approve) await insertPayment({ ...payload, created_by: payload.created_by ?? user.id });
        break;
      case 'charge_waiver':
        if (approve) await applyChargeWaiver(Number(payload.charge_id));
        break;
      case 'damage_waiver':
        if (approve) {
          const charge = await one<{ id: number }>('SELECT id FROM rental_charges WHERE damage_id = ?', a.entity_id);
          if (charge) await applyChargeWaiver(charge.id);
          else await run('UPDATE damages SET waived = 1, customer_charge = 0 WHERE id = ?', a.entity_id);
        }
        break;
    }
    await audit(`approval.${approve ? 'approve' : 'reject'}`, a.entity, a.entity_id, { approval_id: id, type: a.type, amount: a.amount, note });
  });
  return one<Approval>('SELECT * FROM approvals WHERE id = ?', id);
}
