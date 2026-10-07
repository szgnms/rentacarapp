import { all, one, scalar } from '../db';
import { addDays, fmtDate, normDate, nowLocal, num, parseDate, round2, today } from '../core';
import { totalCosts } from './service';
import type { ReservationStatus, VehicleStatus } from '../types';

function netCollected(from: string, to: string) {
  let x = 0;
  for (const r of all<{ type: string; t: number }>(
    `SELECT type, COALESCE(SUM(amount),0) AS t FROM payments WHERE paid_at >= ? AND paid_at <= ? AND type IN ('payment','refund') GROUP BY type`,
    from, to + 'T23:59',
  )) x += r.type === 'payment' ? r.t : -r.t;
  return round2(x);
}

// ================= GÖSTERGE PANELİ =================

export interface Alert {
  vehicle_id: number;
  plate: string;
  level: 'warning' | 'danger';
  message: string;
}

export function dashboard() {
  const now = nowLocal();
  const t = today();
  const in30 = fmtDate(addDays(new Date(), 30));

  const fleet: Record<VehicleStatus, number> = { available: 0, rented: 0, maintenance: 0, out_of_service: 0 };
  for (const f of all<{ status: VehicleStatus; n: number }>('SELECT status, COUNT(*) AS n FROM vehicles GROUP BY status')) fleet[f.status] = f.n;
  const total = Object.values(fleet).reduce((a, b) => a + b, 0);
  const activeFleet = total - fleet.out_of_service;

  const pickupsToday = all<{ id: number; code: string; pickup_at: string; status: ReservationStatus; plate: string; brand: string; model: string; customer_name: string }>(
    `SELECT r.id, r.code, r.pickup_at, r.status, v.plate, v.brand, v.model, c.first_name || ' ' || c.last_name AS customer_name
     FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id JOIN customers c ON c.id = r.customer_id
     WHERE r.status IN ('pending','confirmed') AND substr(r.pickup_at,1,10) <= ? ORDER BY r.pickup_at`, t,
  );
  const returnsToday = all<{ id: number; contract_no: string; planned_return_at: string; plate: string; brand: string; model: string; customer_name: string; phone: string }>(
    `SELECT r.id, r.contract_no, r.planned_return_at, v.plate, v.brand, v.model, c.first_name || ' ' || c.last_name AS customer_name, c.phone
     FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN customers c ON c.id = r.customer_id
     WHERE r.status = 'active' AND substr(r.planned_return_at,1,10) <= ? ORDER BY r.planned_return_at`, t,
  ).map((x) => ({ ...x, overdue: x.planned_return_at < now }));

  const alerts: Alert[] = [];
  const labels = { insurance_expiry: 'Trafik sigortası', kasko_expiry: 'Kasko', inspection_expiry: 'Muayene' } as const;
  for (const v of all<{ id: number; plate: string; insurance_expiry: string | null; kasko_expiry: string | null; inspection_expiry: string | null; current_km: number; next_service_km: number | null }>(
    `SELECT id, plate, insurance_expiry, kasko_expiry, inspection_expiry, current_km, next_service_km FROM vehicles WHERE status <> 'out_of_service'`,
  )) {
    for (const [k, label] of Object.entries(labels) as [keyof typeof labels, string][]) {
      const date = v[k];
      if (date && date <= in30) {
        alerts.push({ vehicle_id: v.id, plate: v.plate, level: date < t ? 'danger' : 'warning', message: `${label} ${date < t ? 'süresi dolmuş' : 'bitiyor'}: ${date}` });
      }
    }
    if (v.next_service_km && v.current_km >= v.next_service_km - 1000) {
      const passed = v.current_km >= v.next_service_km;
      alerts.push({
        vehicle_id: v.id, plate: v.plate, level: passed ? 'danger' : 'warning',
        message: `Periyodik bakım km'si ${passed ? 'geçti' : 'yaklaşıyor'} (${v.current_km} / ${v.next_service_km})`,
      });
    }
  }

  const receivables = scalar<number>(
    `SELECT COALESCE(SUM(r.total_amount - COALESCE((SELECT SUM(CASE WHEN type='payment' THEN amount WHEN type='refund' THEN -amount ELSE 0 END)
      FROM payments WHERE rental_id = r.id),0)),0) FROM rentals r WHERE r.status <> 'cancelled'`,
  );

  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const ms = fmtDate(d).slice(0, 8) + '01';
    const me = fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    monthly.push({ month: ms.slice(0, 7), revenue: netCollected(ms, me), expenses: totalCosts(ms, me) });
  }

  const count = (sql: string, ...p: string[]) => scalar<number>(sql, ...p);
  return {
    fleet: { ...fleet, total, utilization: activeFleet ? Math.round((fleet.rented / activeFleet) * 100) : 0 },
    counts: {
      active_rentals: count("SELECT COUNT(*) FROM rentals WHERE status = 'active'"),
      overdue_rentals: count("SELECT COUNT(*) FROM rentals WHERE status = 'active' AND planned_return_at < ?", now),
      upcoming_reservations: count("SELECT COUNT(*) FROM reservations WHERE status IN ('pending','confirmed')"),
      pending_reservations: count("SELECT COUNT(*) FROM reservations WHERE status = 'pending'"),
      customers: count('SELECT COUNT(*) FROM customers'),
      open_damages: count("SELECT COUNT(*) FROM damages WHERE status = 'open'"),
    },
    revenue: { today: netCollected(t, t), month: netCollected(t.slice(0, 8) + '01', t) },
    receivables: round2(receivables),
    pickups_today: pickupsToday,
    returns_today: returnsToday,
    alerts,
    monthly,
  };
}

export type Dashboard = ReturnType<typeof dashboard>;

// ================= RAPORLAR =================

export function reports(q: { from?: string; to?: string } = {}) {
  const to = normDate(q.to || today(), 'Bitiş');
  const from = normDate(q.from || to.slice(0, 8) + '01', 'Başlangıç');
  const toT = to + 'T23:59';
  const periodDays = Math.max(1, Math.round((parseDate(to)!.getTime() - parseDate(from)!.getTime()) / 86400000) + 1);

  let collected = 0;
  const byMethod: Record<string, number> = {};
  for (const p of all<{ type: string; method: string; t: number }>(
    'SELECT type, method, COALESCE(SUM(amount),0) AS t FROM payments WHERE paid_at BETWEEN ? AND ? GROUP BY type, method', from, toT,
  )) {
    if (p.type !== 'payment' && p.type !== 'refund') continue;
    const signed = p.type === 'payment' ? p.t : -p.t;
    collected += signed;
    byMethod[p.method] = round2((byMethod[p.method] || 0) + signed);
  }

  const rs = one<{ n: number; billed: number; days: number; charges: number; extras: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS billed, COALESCE(SUM(days),0) AS days,
            COALESCE(SUM(charges_amount),0) AS charges, COALESCE(SUM(extras_amount),0) AS extras
     FROM rentals WHERE status <> 'cancelled' AND pickup_at BETWEEN ? AND ?`, from, toT,
  )!;
  const expenses = all<{ category: string; t: number }>(
    'SELECT category, COALESCE(SUM(amount),0) AS t FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY t DESC', from, to,
  );
  const maintCost = scalar<number>(`SELECT COALESCE(SUM(cost),0) FROM maintenance WHERE status <> 'cancelled' AND start_date BETWEEN ? AND ?`, from, to);
  const totalExpenses = round2(expenses.reduce((a, e) => a + e.t, 0) + maintCost);

  // Araç bazında: dönemle kesişen kiralama süresi (doluluk) ve dönemde başlayan kiralamaların geliri
  const periodStart = parseDate(from)!.getTime();
  const periodEnd = parseDate(toT)!.getTime();
  const byVehicle = all<{ id: number; plate: string; brand: string; model: string; category: string }>(
    'SELECT id, plate, brand, model, category FROM vehicles ORDER BY plate',
  ).map((v) => {
    const rentals = all<{ pickup_at: string; end_at: string; total_amount: number }>(
      `SELECT pickup_at, COALESCE(actual_return_at, planned_return_at) AS end_at, total_amount
       FROM rentals WHERE vehicle_id = ? AND status <> 'cancelled' AND pickup_at <= ? AND COALESCE(actual_return_at, planned_return_at) >= ?`,
      v.id, toT, from,
    );
    let ms = 0;
    let revenue = 0;
    for (const r of rentals) {
      const a = Math.max(parseDate(r.pickup_at)!.getTime(), periodStart);
      const b = Math.min(parseDate(r.end_at)!.getTime(), periodEnd);
      if (b > a) ms += b - a;
      if (r.pickup_at >= from && r.pickup_at <= toT) revenue += r.total_amount;
    }
    const cost = totalCosts(from, to, v.id);
    const rentedDays = round2(ms / 86400000);
    return {
      ...v, rentals: rentals.length, rented_days: rentedDays, utilization: Math.min(100, Math.round((rentedDays / periodDays) * 100)),
      revenue: round2(revenue), cost, profit: round2(revenue - cost),
    };
  });

  const byCategory: Record<string, { category: string; vehicles: number; revenue: number; rented_days: number }> = {};
  for (const v of byVehicle) {
    const c = (byCategory[v.category] ||= { category: v.category, vehicles: 0, revenue: 0, rented_days: 0 });
    c.vehicles += 1;
    c.revenue = round2(c.revenue + v.revenue);
    c.rented_days = round2(c.rented_days + v.rented_days);
  }

  return {
    from,
    to,
    period_days: periodDays,
    summary: {
      collected: round2(collected),
      billed: round2(rs.billed),
      rentals: rs.n,
      rented_days: rs.days,
      avg_daily_revenue: rs.days ? round2(rs.billed / rs.days) : 0,
      extras: round2(rs.extras),
      charges: round2(rs.charges),
      expenses: totalExpenses,
      maintenance_cost: round2(maintCost),
      net_profit: round2(collected - totalExpenses),
      fleet_utilization: byVehicle.length ? Math.round(byVehicle.reduce((a, v) => a + v.utilization, 0) / byVehicle.length) : 0,
    },
    by_method: byMethod,
    expenses_by_category: [...expenses.map((e) => ({ category: e.category, total: round2(e.t) })), { category: 'Bakım/Onarım', total: round2(maintCost) }],
    by_vehicle: byVehicle,
    by_category: Object.values(byCategory),
    top_customers: all<{ id: number; name: string; rentals: number; total: number }>(
      `SELECT c.id, c.first_name || ' ' || c.last_name AS name, COUNT(r.id) AS rentals, COALESCE(SUM(r.total_amount),0) AS total
       FROM rentals r JOIN customers c ON c.id = r.customer_id
       WHERE r.status <> 'cancelled' AND r.pickup_at BETWEEN ? AND ?
       GROUP BY c.id ORDER BY total DESC LIMIT 10`, from, toT,
    ),
    reservation_stats: all<{ status: ReservationStatus; n: number }>(
      'SELECT status, COUNT(*) AS n FROM reservations WHERE pickup_at BETWEEN ? AND ? GROUP BY status', from, toT,
    ),
  };
}

export type Reports = ReturnType<typeof reports>;

// ================= TAKVİM =================

export interface CalendarEvent {
  id: number;
  vehicle_id: number;
  kind: 'reservation' | 'rental' | 'maintenance';
  label: string;
  start: string;
  end: string;
  status: string;
  customer_name?: string;
  planned_return_at?: string;
  overdue?: boolean;
}

export function calendar(q: { from?: string; days?: string } = {}) {
  const start = normDate(q.from || today(), 'Başlangıç');
  const days = Math.min(62, Math.max(1, Math.floor(num(q.days, 14))));
  const end = fmtDate(addDays(parseDate(start)!, days));
  const now = nowLocal();
  const vehicles = all<{ id: number; plate: string; brand: string; model: string; category: string; status: VehicleStatus }>(
    'SELECT id, plate, brand, model, category, status FROM vehicles ORDER BY category, plate',
  );
  const events: CalendarEvent[] = [
    ...all<Omit<CalendarEvent, 'kind'>>(
      `SELECT r.id, r.vehicle_id, r.code AS label, r.pickup_at AS start, r.return_at AS end, r.status,
              c.first_name || ' ' || c.last_name AS customer_name
       FROM reservations r JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('pending','confirmed') AND r.pickup_at < ? AND r.return_at > ?`, end, start,
    ).map((e) => ({ ...e, kind: 'reservation' as const })),
    ...all<Omit<CalendarEvent, 'kind'>>(
      `SELECT r.id, r.vehicle_id, r.contract_no AS label, r.pickup_at AS start,
              CASE WHEN r.status = 'active' THEN MAX(r.planned_return_at, ?) ELSE r.actual_return_at END AS end,
              r.status, r.planned_return_at, c.first_name || ' ' || c.last_name AS customer_name
       FROM rentals r JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('active','completed') AND r.pickup_at < ?
         AND (CASE WHEN r.status = 'active' THEN MAX(r.planned_return_at, ?) ELSE r.actual_return_at END) > ?`,
      now, end, now, start,
    ).map((e) => ({ ...e, kind: 'rental' as const, overdue: e.status === 'active' && (e.planned_return_at ?? '') < now })),
    ...all<Omit<CalendarEvent, 'kind'>>(
      `SELECT id, vehicle_id, type AS label, start_date || 'T00:00' AS start,
              COALESCE(NULLIF(end_date,''), CASE WHEN status = 'in_progress' THEN ? ELSE start_date END) || 'T23:59' AS end, status
       FROM maintenance WHERE status IN ('scheduled','in_progress','completed') AND start_date < ?`, end, end,
    )
      .filter((m) => m.end > start)
      .map((e) => ({ ...e, kind: 'maintenance' as const })),
  ];
  return { from: start, days, vehicles, events };
}
