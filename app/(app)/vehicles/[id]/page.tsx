import type { Metadata } from 'next';
import Link from 'next/link';
import { getVehicle } from '@/lib/domain/fleet';
import { listBranches } from '@/lib/domain/admin';
import { addDays, fmtDate, today } from '@/lib/core';
import { d, dt, money, numf, text } from '@/lib/format';
import { flat, orNotFound, vehicleOptions, type IdParams, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, Stat, Table, Tabs } from '@/components/ui';
import { ClickRow } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { DamageButton, ExpenseButton, MaintenanceButton, VehicleButton } from '@/components/dialogs/forms';

export const metadata: Metadata = { title: 'Araç' };

function Expiry({ date }: { date: string | null }) {
  if (!date) return <span className="muted">—</span>;
  if (date < today()) return <span className="danger-text">{d(date)} (süresi doldu)</span>;
  if (date <= fmtDate(addDays(new Date(), 30))) return <span className="badge warn">{d(date)}</span>;
  return <>{d(date)}</>;
}

export default async function VehiclePage({ params, searchParams }: { params: IdParams; searchParams: SearchParams }) {
  const [{ id }, q, user] = await Promise.all([params, flat(searchParams), requireUser()]);
  const v = orNotFound(() => getVehicle(Number(id)));
  const branches = listBranches();
  const vehicles = vehicleOptions();
  const tab = q.tab || 'rentals';
  const tabs: [string, string][] = [
    ['rentals', `Kiralamalar (${v.rentals.length})`],
    ['reservations', `Rezervasyonlar (${v.reservations.length})`],
    ['maintenance', `Bakım (${v.maintenance.length})`],
    ['damages', `Hasar (${v.damages.length})`],
    ['expenses', `Masraflar (${v.expenses.length})`],
  ];

  return (
    <>
      <PageHead
        title={<>{v.plate} <Badge group="vehicleStatus" value={v.status} /></>}
        sub={`${v.brand} ${v.model} · ${v.year ?? ''} · ${v.category}`}
        actions={
          <>
            {v.status === 'available' ? <Link className="btn primary" href={`/booking?vehicle_id=${v.id}`}>Kirala / Rezerve et</Link> : null}
            <VehicleButton vehicle={v} branches={branches}>Düzenle</VehicleButton>
            {v.status === 'available' ? (
              <ActionButton url={`/api/vehicles/${v.id}`} method="PUT" body={{ status: 'out_of_service' }} success="Durum güncellendi">Hizmet dışı yap</ActionButton>
            ) : null}
            {v.status === 'out_of_service' ? (
              <ActionButton url={`/api/vehicles/${v.id}`} method="PUT" body={{ status: 'available' }} success="Durum güncellendi">Hizmete al</ActionButton>
            ) : null}
            {user.role === 'admin' ? (
              <ActionButton url={`/api/vehicles/${v.id}`} method="DELETE" className="danger" confirm={`${v.plate} plakalı araç silinsin mi?`} okLabel="Sil" success="Araç silindi" redirectTo="/vehicles">Sil</ActionButton>
            ) : null}
          </>
        }
      />
      <div className="grid grid-4 mb">
        <Stat label="Toplam ciro" value={money(v.stats.revenue)} />
        <Stat label="Kiralanan gün" value={numf(v.stats.rented_days)} />
        <Stat label="Bakım + masraf" value={money(v.stats.costs)} />
        <Stat label="Net katkı" value={money(v.stats.profit)} />
      </div>
      <div className="grid grid-2 mb">
        <Card title="Araç bilgileri">
          <div className="card-body">
            <dl className="kv">
              <dt>Yakıt / Vites</dt><dd>{v.fuel_type} / {v.transmission}</dd>
              <dt>Koltuk / Renk</dt><dd>{v.seats} / {v.color || '—'}</dd>
              <dt>Şasi no</dt><dd>{v.vin || '—'}</dd>
              <dt>Şube</dt><dd>{v.branch_name || '—'}</dd>
              <dt>Güncel km</dt><dd>{numf(v.current_km)} km</dd>
              <dt>Sonraki bakım</dt><dd>{v.next_service_km ? `${numf(v.next_service_km)} km` : '—'}</dd>
              {v.active_contract ? <><dt>Aktif sözleşme</dt><dd>{v.active_contract} (dönüş {dt(v.active_return_at)})</dd></> : null}
              {v.notes ? <><dt>Notlar</dt><dd>{v.notes}</dd></> : null}
            </dl>
          </div>
        </Card>
        <Card title="Fiyat & belgeler">
          <div className="card-body">
            <dl className="kv">
              <dt>Günlük fiyat</dt><dd>{money(v.daily_rate)}</dd>
              <dt>Depozito</dt><dd>{money(v.deposit_amount)}</dd>
              <dt>Km limiti</dt><dd>{v.km_limit_per_day ? `${v.km_limit_per_day} km/gün, aşım ${money(v.extra_km_fee)}/km` : 'Sınırsız'}</dd>
              <dt>Trafik sigortası</dt><dd><Expiry date={v.insurance_expiry} /></dd>
              <dt>Kasko</dt><dd><Expiry date={v.kasko_expiry} /></dd>
              <dt>Muayene</dt><dd><Expiry date={v.inspection_expiry} /></dd>
            </dl>
          </div>
        </Card>
      </div>
      <Card>
        <div className="card-body">
          <Tabs items={tabs} active={tab} base={`/vehicles/${v.id}`} />
          {tab === 'rentals' ? (
            <Table cols={['Sözleşme', 'Müşteri', 'Teslim', 'Dönüş', ['Km', 'num'], ['Tutar', 'num'], 'Durum']} count={v.rentals.length}>
              {v.rentals.map((r) => (
                <ClickRow key={r.id} href={`/rentals/${r.id}`}>
                  <td>{r.contract_no}</td>
                  <td>{r.customer_name}</td>
                  <td>{dt(r.pickup_at)}</td>
                  <td>{dt(r.actual_return_at || r.planned_return_at)}</td>
                  <td className="num">{r.end_km !== null ? numf(r.end_km - r.start_km) : '—'}</td>
                  <td className="num">{money(r.total_amount)}</td>
                  <td><Badge group="rentalStatus" value={r.status} /></td>
                </ClickRow>
              ))}
            </Table>
          ) : null}
          {tab === 'reservations' ? (
            <Table cols={['Kod', 'Müşteri', 'Alış', 'Dönüş', ['Tutar', 'num'], 'Durum']} count={v.reservations.length}>
              {v.reservations.map((r) => (
                <ClickRow key={r.id} href={`/reservations/${r.id}`}>
                  <td>{r.code}</td>
                  <td>{r.customer_name}</td>
                  <td>{dt(r.pickup_at)}</td>
                  <td>{dt(r.return_at)}</td>
                  <td className="num">{money(r.total_amount)}</td>
                  <td><Badge group="reservationStatus" value={r.status} /></td>
                </ClickRow>
              ))}
            </Table>
          ) : null}
          {tab === 'maintenance' ? (
            <>
              <div className="actions mb">
                <MaintenanceButton vehicles={vehicles} defaults={{ vehicle_id: v.id, km: v.current_km }} className="sm primary">+ Bakım kaydı</MaintenanceButton>
              </div>
              <Table cols={['Tarih', 'Tip', 'Açıklama', 'Servis', ['Km', 'num'], ['Maliyet', 'num'], 'Durum']} count={v.maintenance.length}>
                {v.maintenance.map((m) => (
                  <MaintenanceButton key={m.id} record={m} vehicles={vehicles} asRow>
                    <td className="nowrap">{d(m.start_date)}{m.end_date && m.end_date !== m.start_date ? ` → ${d(m.end_date)}` : ''}</td>
                    <td>{text('maintenanceType', m.type)}</td>
                    <td>{m.description}</td>
                    <td>{m.vendor}</td>
                    <td className="num">{m.km ? numf(m.km) : ''}</td>
                    <td className="num">{money(m.cost)}</td>
                    <td><Badge group="maintenanceStatus" value={m.status} /></td>
                  </MaintenanceButton>
                ))}
              </Table>
            </>
          ) : null}
          {tab === 'damages' ? (
            <>
              <div className="actions mb">
                <DamageButton vehicles={vehicles} defaults={{ vehicle_id: v.id }} className="sm primary">+ Hasar kaydı</DamageButton>
              </div>
              <Table cols={['Tarih', 'Konum', 'Açıklama', 'Önem', ['Onarım', 'num'], ['Müşteriye', 'num'], 'Durum']} count={v.damages.length}>
                {v.damages.map((x) => (
                  <DamageButton key={x.id} record={x} vehicles={vehicles} asRow>
                    <td>{d(x.reported_at)}</td>
                    <td>{x.location}</td>
                    <td>{x.description}</td>
                    <td><Badge group="severity" value={x.severity} /></td>
                    <td className="num">{money(x.repair_cost)}</td>
                    <td className="num">{money(x.customer_charge)}</td>
                    <td><Badge group="damageStatus" value={x.status} /></td>
                  </DamageButton>
                ))}
              </Table>
            </>
          ) : null}
          {tab === 'expenses' ? (
            <>
              <div className="actions mb">
                <ExpenseButton vehicles={vehicles} defaults={{ vehicle_id: v.id }} className="sm primary">+ Masraf</ExpenseButton>
              </div>
              <Table cols={['Tarih', 'Kategori', 'Açıklama', ['Tutar', 'num']]} count={v.expenses.length}>
                {v.expenses.map((x) => (
                  <ExpenseButton key={x.id} record={x} vehicles={vehicles} asRow>
                    <td>{d(x.expense_date)}</td>
                    <td>{x.category}</td>
                    <td>{x.description}</td>
                    <td className="num">{money(x.amount)}</td>
                  </ExpenseButton>
                ))}
              </Table>
            </>
          ) : null}
        </div>
      </Card>
    </>
  );
}
