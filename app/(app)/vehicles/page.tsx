import type { Metadata } from 'next';
import { listVehicles, CATEGORIES } from '@/lib/domain/fleet';
import { listBranches } from '@/lib/domain/admin';
import { dt, labelOptions, money, numf } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { Badge, Card, PageHead, Table } from '@/components/ui';
import { ClickRow, Filters } from '@/components/client/Filters';
import { VehicleButton } from '@/components/dialogs/forms';

export const metadata: Metadata = { title: 'Araçlar' };

export default async function VehiclesPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await flat(searchParams);
  const rows = listVehicles(q);
  const branches = listBranches();
  return (
    <>
      <PageHead title="Araçlar" sub="Filo envanteri" actions={<VehicleButton branches={branches} className="primary">+ Araç ekle</VehicleButton>} />
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
              <td><strong>{v.plate}</strong></td>
              <td>{v.brand} {v.model}<div className="muted small">{v.year} {v.color}</div></td>
              <td>{v.category}</td>
              <td>{v.fuel_type} / {v.transmission}</td>
              <td className="num">{numf(v.current_km)}</td>
              <td className="num">{money(v.daily_rate)}</td>
              <td>{v.branch_name || '—'}</td>
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
