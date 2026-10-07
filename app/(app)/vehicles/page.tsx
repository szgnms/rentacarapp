import type { Metadata } from 'next';
import { DOCUMENT_TYPES, expiringDocuments, listVehicles } from '@/lib/domain/vehicles';
import { requireUser } from '@/lib/session';
import { can } from '@/lib/permissions';
import { CATEGORIES } from '@/lib/rules';
import { listBranches } from '@/lib/domain/admin';
import { dt, labelOptions, labelText, money, numf } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { Badge, Card, PageHead, Table } from '@/components/ui';
import { ClickRow, Filters } from '@/components/client/Filters';
import { VehicleButton } from '@/components/dialogs/forms';

export const metadata: Metadata = { title: 'Araçlar' };

export default async function VehiclesPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const rows = await listVehicles(q, user);
  const expiring = new Map<number, string[]>();
  for (const x of await expiringDocuments(30)) expiring.set(x.vehicle_id, [...(expiring.get(x.vehicle_id) ?? []), DOCUMENT_TYPES[x.type] ?? x.type]);
  const counts = rows.reduce<Record<string, number>>((a, v) => ((a[v.status] = (a[v.status] ?? 0) + 1), a), {});
  const branches = await listBranches();
  return (
    <>
      <PageHead
        title="Araçlar"
        sub={`Filo envanteri · ${rows.length} araç${Object.keys(counts).length ? ' · ' + Object.entries(counts).map(([k, n]) => `${labelText('vehicleStatus', k)} ${n}`).join(' · ') : ''}`}
        actions={can(user, 'fleet.write') ? <VehicleButton branches={branches} className="primary">+ Araç ekle</VehicleButton> : null}
      />
      <Filters
        fields={[
          { name: 'q', type: 'search', placeholder: 'Plaka, marka, model ara…' },
          { name: 'status', type: 'select', empty: 'Tüm durumlar', options: labelOptions('vehicleStatus') },
          { name: 'category', type: 'select', empty: 'Tüm kategoriler', options: CATEGORIES },
          { name: 'branch_id', type: 'select', empty: 'Tüm şubeler', options: branches.map((b) => [b.id, b.name] as const) },
        ]}
      />
      <Card>
        <Table cols={['Plaka', 'Araç', 'Kategori', 'Yakıt / Vites', ['Km', 'num'], ['Günlük', 'num'], 'Şube', 'Durum']} count={rows.length}>
          {rows.map((v) => (
            <ClickRow key={v.id} href={`/vehicles/${v.id}`}>
              <td>
                <strong>{v.plate}</strong>
                {expiring.has(v.id) ? <div className="small danger-text" title="30 gün içinde biten / süresi dolmuş belgeler">⚠ {expiring.get(v.id)!.join(', ')}</div> : null}
              </td>
              <td>{v.brand} {v.model}<div className="muted small">{v.year} {v.color}</div></td>
              <td>{v.category}</td>
              <td>{v.fuel_type} / {v.transmission}</td>
              <td className="num">{numf(v.current_km)}</td>
              <td className="num">{money(v.daily_rate)}</td>
              <td>{v.branch_name || '—'}{v.parking_spot ? <div className="muted small">{v.parking_spot}</div> : null}</td>
              <td>
                <Badge group="vehicleStatus" value={v.status} />
                {v.active_contract ? <div className="muted small">{v.active_contract} · {dt(v.active_return_at)}</div> : null}
              </td>
            </ClickRow>
          ))}
        </Table>
      </Card>
    </>
  );
}
