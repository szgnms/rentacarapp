import { handler } from '@/lib/api';
import { HttpError, mustGet, toId } from '@/lib/core';
import { can } from '@/lib/permissions';
import { one, run } from '@/lib/db';
import { requestApproval } from '@/lib/domain/approval-core';
import { applyChargeWaiver } from '@/lib/domain/agreements';
import type { Damage } from '@/lib/types';

/** Hasar affı: onay yetkisi varsa doğrudan, yoksa onay talebi. */
export const POST = handler<{ id: string }>(({ params, body, user }) => {
  const d = mustGet<Damage>('damages', toId(params.id), 'Hasar');
  if (!d.customer_charge) throw new HttpError(409, 'Müşteriye yansıtılmış tutar yok');
  if (!can(user, 'approve')) return { approval: requestApproval('damage_waiver', 'damage', d.id, d.customer_charge, String(body.reason ?? 'Hasar affı'), {}, user) };
  const charge = one<{ id: number }>('SELECT id FROM rental_charges WHERE damage_id = ?', d.id);
  if (charge) applyChargeWaiver(charge.id);
  else run('UPDATE damages SET waived = 1, customer_charge = 0 WHERE id = ?', d.id);
  return { ok: true };
}, { perm: 'maintenance.write' });
