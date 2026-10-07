import type { Metadata } from 'next';
import Link from 'next/link';
import { listReservations } from '@/lib/domain/reservations';
import { listRentals } from '@/lib/domain/agreements';
import { TASK_TYPES, listTasks } from '@/lib/domain/tasks';
import { can } from '@/lib/permissions';
import { dt, money, qs, shiftDate, todayStr } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { PageHead, Tag } from '@/components/ui';
import { ActionButton } from '@/components/client/ActionButton';

export const metadata: Metadata = { title: 'Günün işleri' };

const time = (s: string) => s.slice(11, 16);

export default async function FieldPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const day = q.date || todayStr();
  const operate = can(user, 'rentals.operate');
  const pickups = (await listReservations({ from: day, to: day }, user))
    .filter((r) => ['pending', 'confirmed'].includes(r.status))
    .sort((a, b) => a.pickup_at.localeCompare(b.pickup_at));
  const drafts = await listRentals({ status: 'draft' }, user);
  const active = await listRentals({ status: 'active' }, user);
  const returns = active.filter((r) => r.planned_return_at.slice(0, 10) <= day).sort((a, b) => a.planned_return_at.localeCompare(b.planned_return_at));
  const tasks = await listTasks({ status: 'open_all', date: day }, user);
  return (
    <>
      <PageHead
        title="Günün işleri"
        sub={`${dt(day).slice(0, 10)} · ${pickups.length} teslim · ${returns.length} iade · ${tasks.length} iş emri`}
        actions={
          <>
            <Link className="btn" href={`/field?${qs({ date: shiftDate(day, -1) })}`}>← Önceki gün</Link>
            <Link className="btn" href="/field">Bugün</Link>
            <Link className="btn" href={`/field?${qs({ date: shiftDate(day, 1) })}`}>Sonraki gün →</Link>
            {operate ? <Link className="btn primary" href="/booking?mode=rental">+ Kapıdan kiralama</Link> : null}
          </>
        }
      />
      {drafts.length ? (
        <section className="mb">
          <h2 className="section-title">Devam eden teslimler</h2>
          <div className="field-cards">
            {drafts.map((r) => (
              <div key={r.id} className="field-card">
                <div className="time">{r.plate} <Tag tone="warn">Taslak</Tag></div>
                <div><strong>{r.customer_name}</strong> · {r.customer_phone}</div>
                <div className="muted small">{r.contract_no} · {r.brand} {r.model}</div>
                <Link className="btn success big-btn" href={`/rentals/${r.id}/checkout`}>Teslime devam et →</Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="mb">
        <h2 className="section-title">🚗 Teslimler ({pickups.length})</h2>
        {pickups.length ? (
          <div className="field-cards">
            {pickups.map((r) => (
              <div key={r.id} className="field-card">
                <div className="time">{time(r.pickup_at)} <span className="muted small">{r.pickup_branch_name}</span></div>
                <div><strong>{r.customer_name}</strong> · <a href={`tel:${r.customer_phone}`}>{r.customer_phone}</a></div>
                <div>{r.plate ? <>{r.plate} · {r.brand} {r.model}</> : <Tag tone="warn">{r.category} — araç atanmadı</Tag>}</div>
                <div className="muted small">{r.code} · {r.days} gün · {money(r.total_amount)}{r.status === 'pending' ? ' · opsiyonlu' : ''}</div>
                {r.rental_id ? (
                  <Link className="btn big-btn" href={`/rentals/${r.rental_id}/checkout`}>Teslime devam et →</Link>
                ) : operate && r.vehicle_id ? (
                  <ActionButton url={`/api/reservations/${r.id}/checkout`} className="success big-btn" redirectTo="/rentals/{id}/checkout">
                    Teslimi başlat
                  </ActionButton>
                ) : (
                  <Link className="btn big-btn" href={`/reservations/${r.id}`}>{r.vehicle_id ? 'Rezervasyon' : 'Araç ata →'}</Link>
                )}
              </div>
            ))}
          </div>
        ) : <div className="muted">Bu gün için teslim yok.</div>}
      </section>
      <section className="mb">
        <h2 className="section-title">↩︎ İadeler ({returns.length})</h2>
        {returns.length ? (
          <div className="field-cards">
            {returns.map((r) => (
              <div key={r.id} className="field-card">
                <div className="time">{r.planned_return_at.slice(0, 10) < day ? <Tag tone="danger">Gecikmiş · {dt(r.planned_return_at)}</Tag> : time(r.planned_return_at)} <span className="muted small">{r.return_branch_name}</span></div>
                <div><strong>{r.customer_name}</strong> · <a href={`tel:${r.customer_phone}`}>{r.customer_phone}</a></div>
                <div>{r.plate} · {r.brand} {r.model}</div>
                <div className="muted small">{r.contract_no}{r.balance > 0.009 ? ` · bakiye ${money(r.balance)}` : ''}</div>
                {operate ? <Link className="btn primary big-btn" href={`/rentals/${r.id}/checkin`}>İade al →</Link> : null}
              </div>
            ))}
          </div>
        ) : <div className="muted">Bu gün için iade yok.</div>}
      </section>
      <section>
        <h2 className="section-title">🧰 İş emirleri ({tasks.length})</h2>
        {tasks.length ? (
          <div className="field-cards">
            {tasks.map((t) => (
              <div key={t.id} className="field-card">
                <div className="time">{t.due_at ? time(t.due_at) : '—'} <Tag tone={t.priority === 'urgent' ? 'danger' : t.priority === 'high' ? 'warn' : ''}>{TASK_TYPES[t.type] ?? t.type}</Tag></div>
                <div><strong>{t.title}</strong></div>
                <div className="muted small">{[t.plate, t.contract_no, t.address].filter(Boolean).join(' · ')}</div>
                <Link className="btn big-btn" href="/tasks">İş emirleri →</Link>
              </div>
            ))}
          </div>
        ) : <div className="muted">Açık iş emri yok.</div>}
      </section>
    </>
  );
}
