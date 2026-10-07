import type { Metadata } from 'next';
import Link from 'next/link';
import { calendar, type CalendarEvent } from '@/lib/domain/reports';
import { dt, qs, shiftDate, text, todayStr } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { PageHead } from '@/components/ui';
import { NavSelect } from '@/components/client/NavSelect';

export const metadata: Metadata = { title: 'Filo Takvimi' };

const WD = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

function cellClass(ev: CalendarEvent, day: string) {
  if (ev.kind === 'rental' && (ev.status === 'closed' || ev.status === 'returned')) return 'ev-completed';
  if (ev.kind === 'rental' && ev.overdue && day >= (ev.planned_return_at ?? '').slice(0, 10)) return 'ev-overdue';
  return `ev-${ev.kind}`;
}

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await flat(searchParams);
  const data = await calendar(q);
  const today = todayStr();
  const days = Array.from({ length: data.days }, (_, i) => shiftDate(data.from, i));
  const byVehicle = new Map<number, CalendarEvent[]>();
  for (const e of data.events) byVehicle.set(e.vehicle_id, [...(byVehicle.get(e.vehicle_id) ?? []), e]);

  return (
    <>
      <PageHead
        title="Filo Takvimi"
        sub="Araç bazında rezervasyon, kiralama ve bakım doluluğu"
        actions={
          <>
            <Link className="btn" href={`/calendar?${qs({ from: shiftDate(data.from, -7), days: data.days })}`}>← 1 hafta</Link>
            <Link className="btn" href={`/calendar?${qs({ days: data.days })}`}>Bugün</Link>
            <Link className="btn" href={`/calendar?${qs({ from: shiftDate(data.from, 7), days: data.days })}`}>1 hafta →</Link>
            <NavSelect
              value={String(data.days)}
              options={[7, 14, 30].map((n) => [`/calendar?${qs({ from: data.from, days: n })}`, `${n} gün`, String(n)] as const)}
            />
          </>
        }
      />
      <div className="legend mb">
        <span style={{ '--c': '#86efac' } as React.CSSProperties}>Aktif kiralama</span>
        <span style={{ '--c': '#93c5fd' } as React.CSSProperties}>Rezervasyon</span>
        <span style={{ '--c': '#fca5a5' } as React.CSSProperties}>Gecikmiş iade</span>
        <span style={{ '--c': '#fcd34d' } as React.CSSProperties}>Bakım</span>
        <span style={{ '--c': '#d1d5db' } as React.CSSProperties}>Tamamlanan</span>
        <span style={{ '--c': '#c4b5fd' } as React.CSSProperties}>Araç atanmamış grup rezervasyonu</span>
      </div>
      <div className="card table-wrap">
        <table className="cal">
          <thead>
            <tr>
              <th className="veh">Araç</th>
              {days.map((d) => (
                <th key={d} className={d === today ? 'today' : ''}>
                  {WD[new Date(d + 'T00:00').getDay()]}<br />{d.slice(8)}.{d.slice(5, 7)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.unassigned.length ? (
              <tr className="cal-group">
                <td className="veh">
                  <strong>Atanmamış</strong>
                  <div className="muted small">{data.unassigned.length} grup rezervasyonu</div>
                </td>
                {days.map((day) => {
                  const list = data.unassigned.filter((x) => x.pickup_at <= `${day}T23:59` && x.return_at > `${day}T00:00`);
                  if (!list.length) return <td key={day} />;
                  const title = list.map((x) => `${x.code} · ${x.category} · ${x.customer_name}`).join('\n');
                  return (
                    <td key={day}>
                      <Link className="cell ev-unassigned" href={`/reservations/${list[0].id}`} title={title} aria-label={title}>{list.length > 1 ? list.length : ''}</Link>
                    </td>
                  );
                })}
              </tr>
            ) : null}
            {data.vehicles.map((v) => (
              <tr key={v.id}>
                <td className="veh">
                  <Link href={`/vehicles/${v.id}`}><strong>{v.plate}</strong></Link>
                  <div className="muted small">{v.brand} {v.model} · {v.category}</div>
                </td>
                {days.map((day) => {
                  const ev = byVehicle.get(v.id)?.find((x) => x.start <= `${day}T23:59` && x.end > `${day}T00:00`);
                  if (!ev) return <td key={day} />;
                  const title = ev.kind === 'maintenance'
                    ? `Bakım: ${text('maintenanceType', ev.label)}`
                    : `${ev.label} · ${ev.customer_name}\n${dt(ev.start)} → ${dt(ev.end)}`;
                  const href = ev.kind === 'reservation' ? `/reservations/${ev.id}` : ev.kind === 'rental' ? `/rentals/${ev.id}` : '/maintenance';
                  return (
                    <td key={day}>
                      <Link className={`cell ${cellClass(ev, day)}`} href={href} title={title} aria-label={title} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
