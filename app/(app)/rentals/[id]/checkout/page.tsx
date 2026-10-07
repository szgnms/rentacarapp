import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { all } from '@/lib/db';
import { nowLocal } from '@/lib/core';
import { getRental } from '@/lib/domain/agreements';
import { availableVehicles } from '@/lib/domain/vehicles';
import { equipmentItems } from '@/lib/rules';
import { listFiles } from '@/lib/files';
import { customerName, dt } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { PageHead } from '@/components/ui';
import { CheckoutWizard } from '@/components/CheckoutWizard';
import { ActionButton } from '@/components/client/ActionButton';

export const metadata: Metadata = { title: 'Araç teslimi' };

export default async function CheckoutPage({ params }: { params: IdParams }) {
  const [{ id }, user] = await Promise.all([params, requirePerm('rentals.operate')]);
  const r = await orNotFound(() => getRental(Number(id)));
  if (r.status !== 'draft') redirect(`/rentals/${r.id}`);
  let vehicles: { id: number; label: string; category: string; km: number }[] = [];
  try {
    vehicles = (await availableVehicles({ pickup_at: nowLocal(), return_at: r.planned_return_at, exclude_rental_id: r.id, exclude_reservation_id: r.reservation_id ?? 0 }))
      .filter((v) => v.status === 'available')
      .map((v) => ({ id: v.id, label: `${v.plate} · ${v.brand} ${v.model}`, category: v.category, km: v.current_km }));
  } catch {
    vehicles = [];
  }
  return (
    <>
      <PageHead
        title={<>🔑 Araç teslimi · {r.contract_no}</>}
        sub={`${customerName(r.customer)} · ${r.plate} ${r.brand} ${r.model} · dönüş ${dt(r.planned_return_at)}`}
        actions={
          <>
            <Link className="btn" href={`/rentals/${r.id}`}>Sözleşme</Link>
            <ActionButton url={`/api/rentals/${r.id}/cancel`} className="danger" confirm="Teslim süreci iptal edilsin mi? Rezervasyon onaylı duruma döner." reasonLabel="Neden" okLabel="İptal et" redirectTo="/field">
              Teslimi iptal et
            </ActionButton>
          </>
        }
      />
      <CheckoutWizard
        initial={r}
        equipment={(await equipmentItems()).map((e) => e.name)}
        vehicles={vehicles}
        drivers={await all('SELECT id, first_name, last_name, license_no FROM drivers WHERE customer_id = ? ORDER BY id', r.customer_id)}
        documents={await listFiles('customer', r.customer_id)}
        staffName={user.full_name}
      />
    </>
  );
}
