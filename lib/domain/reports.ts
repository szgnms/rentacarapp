import { all, one, scalar } from '../db';
import { addDays, fmtDate, fmtDateTime, mapSeq, normDate, nowLocal, num, parseDate, round2, today } from '../core';
import { totalCosts } from './service';
import { expiringDocuments } from './vehicles';
import { tollFineSummary } from './tolls';
import { kabisAlarms } from './kabis';
import { dueDepositHolds } from './agreements';
import { pendingApprovalCount } from './approvals';
import { openTaskCount } from './tasks';
import { npsSummary } from './portal';
import type { ReservationStatus, VehicleStatus } from '../types';

async function netCollected(from: string, to: string) {
  let x = 0;
  for (const r of await all<{ type: string; t: number }>(
    `SELECT type, COALESCE(SUM(amount),0) AS t FROM payments WHERE paid_at >= ? AND paid_at <= ? AND type IN ('payment','refund') GROUP BY type`,
    from, to + 'T23:59',
  )) x += r.type === 'payment' ? r.t : -r.t;
  return round2(x);
}

// ================= GÖSTERGE PANELİ =================

export interface Alert {
  level: 'warning' | 'danger';
  message: string;
  href: string;
  label: string;
}

export async function dashboard(branchId: number | null = null) {
  const now = nowLocal();
  const t = today();
  const bf = (col: string) => (branchId ? ` AND ${col} = ${Number(branchId)}` : '');

  const fleet: Record<VehicleStatus, number> = { available: 0, rented: 0, maintenance: 0, out_of_service: 0, damaged: 0, for_sale: 0, in_transfer: 0, sold: 0 };
  for (const f of await all<{ status: VehicleStatus; n: number }>(`SELECT status, COUNT(*) AS n FROM vehicles WHERE 1=1${bf('branch_id')} GROUP BY status`)) fleet[f.status] = f.n;
  const total = Object.values(fleet).reduce((a, b) => a + b, 0) - fleet.sold;
  const activeFleet = total - fleet.out_of_service - fleet.for_sale;

  const pickupsToday = await all<{ id: number; code: string; pickup_at: string; status: ReservationStatus; plate: string | null; category: string | null; customer_name: string; rental_id: number | null }>(
    `SELECT r.id, r.code, r.pickup_at, r.status, v.plate, r.category, c.first_name || ' ' || c.last_name AS customer_name,
            (SELECT id FROM rentals WHERE reservation_id = r.id AND status = 'draft') AS rental_id
     FROM reservations r LEFT JOIN vehicles v ON v.id = r.vehicle_id JOIN customers c ON c.id = r.customer_id
     WHERE r.status IN ('pending','confirmed') AND substr(r.pickup_at,1,10) <= ?${bf('r.pickup_branch_id')} ORDER BY r.pickup_at`, t,
  );
  const returnsToday = (await all<{ id: number; contract_no: string; planned_return_at: string; plate: string; customer_name: string; phone: string }>(
    `SELECT r.id, r.contract_no, r.planned_return_at, v.plate, c.first_name || ' ' || c.last_name AS customer_name, c.phone
     FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN customers c ON c.id = r.customer_id
     WHERE r.status = 'active' AND substr(r.planned_return_at,1,10) <= ?${bf('r.return_branch_id')} ORDER BY r.planned_return_at`, t,
  )).map((x) => ({ ...x, overdue: x.planned_return_at < now }));

  const alerts: Alert[] = [];
  const docLabels: Record<string, string> = {
    inspection: 'Muayene', traffic_insurance: 'Trafik sigortası', kasko: 'Kasko', exhaust: 'Egzoz emisyon', registration: 'Ruhsat',
    hgs: 'HGS etiketi', tire_change: 'Lastik değişimi', mtv: 'MTV', other: 'Belge',
  };
  for (const d of await expiringDocuments(30)) {
    alerts.push({
      level: d.expires_at < t ? 'danger' : 'warning', href: `/vehicles/${d.vehicle_id}?tab=documents`, label: d.plate,
      message: `${docLabels[d.type] ?? d.type} ${d.expires_at < t ? 'süresi dolmuş' : 'bitiyor'}: ${d.expires_at}`,
    });
  }
  for (const v of await all<{ id: number; plate: string; current_km: number; next_service_km: number | null; next_service_date: string | null }>(
    `SELECT id, plate, current_km, next_service_km, next_service_date FROM vehicles WHERE status NOT IN ('sold','out_of_service')${bf('branch_id')}`,
  )) {
    const kmDue = v.next_service_km && v.current_km >= v.next_service_km - 1000;
    const dateDue = v.next_service_date && v.next_service_date <= fmtDate(addDays(new Date(), 14));
    if (kmDue || dateDue) {
      const passed = (v.next_service_km && v.current_km >= v.next_service_km) || (v.next_service_date && v.next_service_date < t);
      alerts.push({
        level: passed ? 'danger' : 'warning', href: `/vehicles/${v.id}?tab=maintenance`, label: v.plate,
        message: `Periyodik bakım ${passed ? 'gecikti' : 'yaklaşıyor'}${v.next_service_km ? ` (${v.current_km} / ${v.next_service_km} km)` : ''}${v.next_service_date ? ` · ${v.next_service_date}` : ''}`,
      });
    }
  }
  const tf = await tollFineSummary();
  for (const v of tf.low_hgs) alerts.push({ level: 'warning', href: `/vehicles/${v.id}`, label: v.plate, message: `HGS bakiyesi düşük: ${round2(v.hgs_balance)} ₺` });
  const kabis = await kabisAlarms();
  if (kabis) alerts.push({ level: 'danger', href: '/kabis', label: 'KABİS', message: `${kabis} bildirim gönderilmedi / hatalı` });
  if (tf.unmatched_tolls) alerts.push({ level: 'warning', href: '/tolls?status=unmatched', label: 'HGS', message: `${tf.unmatched_tolls} geçiş sözleşmeyle eşleşmedi (istisna kuyruğu)` });
  if (tf.fine_deadlines) alerts.push({ level: 'warning', href: '/fines', label: 'Ceza', message: `${tf.fine_deadlines} cezada indirimli ödeme süresi doluyor/doldu` });
  const holds = await dueDepositHolds();
  if (holds.length) alerts.push({ level: 'warning', href: '/rentals?status=returned', label: 'Depozito', message: `${holds.length} sözleşmede depozito tutma süresi doldu` });
  const approvals = await pendingApprovalCount();
  if (approvals) alerts.push({ level: 'warning', href: '/approvals', label: 'Onay', message: `${approvals} onay talebi bekliyor` });
  const waitlist = await scalar<number>("SELECT COUNT(*) FROM reservations WHERE status = 'waitlist'");
  if (waitlist) alerts.push({ level: 'warning', href: '/reservations?status=waitlist', label: 'Bekleme', message: `${waitlist} rezervasyon bekleme listesinde` });
  const unassigned = await scalar<number>(
    "SELECT COUNT(*) FROM reservations WHERE status IN ('pending','confirmed') AND vehicle_id IS NULL AND pickup_at <= ?", fmtDateTime(addDays(new Date(), 2)),
  );
  if (unassigned) alerts.push({ level: 'warning', href: '/reservations?unassigned=1', label: 'Atama', message: `48 saat içinde teslim edilecek ${unassigned} rezervasyona araç atanmadı` });

  const receivables = await scalar<number>(
    `SELECT COALESCE(SUM(r.total_amount - COALESCE((SELECT SUM(CASE WHEN type='payment' THEN amount WHEN type='refund' THEN -amount ELSE 0 END)
      FROM payments WHERE rental_id = r.id),0)),0) FROM rentals r WHERE r.status NOT IN ('cancelled','draft')`,
  );

  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const ms = fmtDate(d).slice(0, 8) + '01';
    const me = fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    monthly.push({ month: ms.slice(0, 7), revenue: await netCollected(ms, me), expenses: await totalCosts(ms, me) });
  }

  const count = (sql: string, ...p: string[]) => scalar<number>(sql, ...p);
  return {
    fleet: { ...fleet, total, utilization: activeFleet ? Math.round((fleet.rented / activeFleet) * 100) : 0 },
    counts: {
      active_rentals: await count(`SELECT COUNT(*) FROM rentals WHERE status = 'active'${bf('pickup_branch_id')}`),
      draft_rentals: await count("SELECT COUNT(*) FROM rentals WHERE status = 'draft'"),
      overdue_rentals: await count(`SELECT COUNT(*) FROM rentals WHERE status = 'active' AND planned_return_at < ?${bf('return_branch_id')}`, now),
      upcoming_reservations: await count("SELECT COUNT(*) FROM reservations WHERE status IN ('pending','confirmed')"),
      pending_reservations: await count("SELECT COUNT(*) FROM reservations WHERE status = 'pending'"),
      customers: await count('SELECT COUNT(*) FROM customers WHERE anonymized_at IS NULL'),
      open_damages: await count("SELECT COUNT(*) FROM damages WHERE status = 'open'"),
      open_tasks: await openTaskCount(),
    },
    revenue: { today: await netCollected(t, t), month: await netCollected(t.slice(0, 8) + '01', t) },
    receivables: round2(receivables),
    pickups_today: pickupsToday,
    returns_today: returnsToday,
    alerts,
    monthly,
  };
}

export type Dashboard = Awaited<ReturnType<typeof dashboard>>;

// ================= RAPORLAR =================

export async function reports(q: { from?: string; to?: string } = {}) {
  const to = normDate(q.to || today(), 'Bitiş');
  const from = normDate(q.from || to.slice(0, 8) + '01', 'Başlangıç');
  const toT = to + 'T23:59';
  const periodDays = Math.max(1, Math.round((parseDate(to)!.getTime() - parseDate(from)!.getTime()) / 86400000) + 1);

  let collected = 0;
  const byMethod: Record<string, number> = {};
  for (const p of await all<{ type: string; method: string; t: number }>(
    'SELECT type, method, COALESCE(SUM(amount),0) AS t FROM payments WHERE paid_at BETWEEN ? AND ? GROUP BY type, method', from, toT,
  )) {
    if (p.type !== 'payment' && p.type !== 'refund') continue;
    const signed = p.type === 'payment' ? p.t : -p.t;
    collected += signed;
    byMethod[p.method] = round2((byMethod[p.method] || 0) + signed);
  }

  const rs = (await one<{ n: number; billed: number; days: number; charges: number; extras: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS billed, COALESCE(SUM(days),0) AS days,
            COALESCE(SUM(charges_amount),0) AS charges, COALESCE(SUM(extras_amount),0) AS extras
     FROM rentals WHERE status NOT IN ('cancelled','draft') AND pickup_at BETWEEN ? AND ?`, from, toT,
  ))!;
  const expenses = await all<{ category: string; t: number }>(
    'SELECT category, COALESCE(SUM(amount),0) AS t FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY t DESC', from, to,
  );
  const maintCost = await scalar<number>(`SELECT COALESCE(SUM(cost),0) FROM maintenance WHERE status <> 'cancelled' AND start_date BETWEEN ? AND ?`, from, to);
  const totalExpenses = round2(expenses.reduce((a, e) => a + e.t, 0) + maintCost);

  // Araç bazında: dönemle kesişen kiralama süresi (doluluk) ve dönemde başlayan kiralamaların geliri
  const periodStart = parseDate(from)!.getTime();
  const periodEnd = parseDate(toT)!.getTime();
  const byVehicle = await mapSeq(await all<{ id: number; plate: string; brand: string; model: string; category: string }>(
    "SELECT id, plate, brand, model, category FROM vehicles WHERE status <> 'sold' OR sold_at >= ? ORDER BY plate", from,
      ), async (v) => {
    const rentals = await all<{ pickup_at: string; end_at: string; total_amount: number }>(
      `SELECT pickup_at, COALESCE(actual_return_at, planned_return_at) AS end_at, total_amount
       FROM rentals WHERE vehicle_id = ? AND status NOT IN ('cancelled','draft') AND pickup_at <= ? AND COALESCE(actual_return_at, planned_return_at) >= ?`,
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
    const cost = await totalCosts(from, to, v.id);
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
    top_customers: await all<{ id: number; name: string; rentals: number; total: number }>(
      `SELECT c.id, c.first_name || ' ' || c.last_name AS name, COUNT(r.id) AS rentals, COALESCE(SUM(r.total_amount),0) AS total
       FROM rentals r JOIN customers c ON c.id = r.customer_id
       WHERE r.status NOT IN ('cancelled','draft') AND r.pickup_at BETWEEN ? AND ?
       GROUP BY c.id ORDER BY total DESC LIMIT 10`, from, toT,
    ),
    reservation_stats: await all<{ status: ReservationStatus; n: number }>(
      'SELECT status, COUNT(*) AS n FROM reservations WHERE pickup_at BETWEEN ? AND ? GROUP BY status', from, toT,
    ),
    kpis: await kpis(from, to, byVehicle.length, periodDays, rs.billed, rs.days),
    by_branch: await all<{ branch: string; rentals: number; revenue: number; days: number }>(
      `SELECT COALESCE(b.name, '—') AS branch, COUNT(r.id) AS rentals, COALESCE(SUM(r.total_amount),0) AS revenue, COALESCE(SUM(r.days),0) AS days
       FROM rentals r LEFT JOIN branches b ON b.id = r.pickup_branch_id
       WHERE r.status NOT IN ('cancelled','draft') AND r.pickup_at BETWEEN ? AND ? GROUP BY r.pickup_branch_id, b.name ORDER BY revenue DESC`, from, toT,
    ),
    by_channel: await all<{ channel: string; rentals: number; revenue: number; commission: number }>(
      `SELECT COALESCE(r.source, 'Ofis') AS channel, COUNT(*) AS rentals, COALESCE(SUM(r.total_amount),0) AS revenue, COALESCE(SUM(r.agency_commission),0) AS commission
       FROM rentals r WHERE r.status NOT IN ('cancelled','draft') AND r.pickup_at BETWEEN ? AND ? GROUP BY COALESCE(r.source, 'Ofis') ORDER BY revenue DESC`, from, toT,
    ),
    by_staff: (await all<{ name: string; checkouts: number; checkins: number }>(
          `SELECT * FROM (SELECT u.full_name AS name,
              (SELECT COUNT(*) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'rental.activate' AND a.created_at BETWEEN ? AND ?) AS checkouts,
              (SELECT COUNT(*) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'rental.checkin' AND a.created_at BETWEEN ? AND ?) AS checkins
       FROM users u WHERE u.active = 1) x ORDER BY checkouts + checkins DESC`, from, toT.replace('T', ' '), from, toT.replace('T', ' '),
    )).filter((x) => x.checkouts + x.checkins > 0),
  };
}

export type Reports = Awaited<ReturnType<typeof reports>>;

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

export async function calendar(q: { from?: string; days?: string; category?: string } = {}) {
  const start = normDate(q.from || today(), 'Başlangıç');
  const days = Math.min(62, Math.max(1, Math.floor(num(q.days, 14))));
  const end = fmtDate(addDays(parseDate(start)!, days));
  const now = nowLocal();
  const vehicles = await all<{ id: number; plate: string; brand: string; model: string; category: string; status: VehicleStatus }>(
    `SELECT id, plate, brand, model, category, status FROM vehicles WHERE status <> 'sold'${q.category ? ' AND category = ?' : ''} ORDER BY category, plate`,
    ...(q.category ? [q.category] : []),
  );
  // Araç atanmamış grup rezervasyonları (gantt'ta grup satırında gösterilir)
  const unassigned = await all<{ id: number; code: string; category: string; pickup_at: string; return_at: string; customer_name: string }>(
    `SELECT r.id, r.code, r.category, r.pickup_at, r.return_at, c.first_name || ' ' || c.last_name AS customer_name FROM reservations r
     JOIN customers c ON c.id = r.customer_id WHERE r.status IN ('pending','confirmed','waitlist') AND r.vehicle_id IS NULL AND r.pickup_at < ? AND r.return_at > ?`,
    end, start,
  );
  const events: CalendarEvent[] = [
    ...(await all<Omit<CalendarEvent, 'kind'>>(
            `SELECT r.id, r.vehicle_id, r.code AS label, r.pickup_at AS start, r.return_at AS "end", r.status,
              c.first_name || ' ' || c.last_name AS customer_name
       FROM reservations r JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('pending','confirmed') AND r.vehicle_id IS NOT NULL AND r.pickup_at < ? AND r.return_at > ?`, end, start,
    )).map((e) => ({ ...e, kind: 'reservation' as const })),
    ...(await all<Omit<CalendarEvent, 'kind'>>(
      `SELECT r.id, r.vehicle_id, r.contract_no AS label, r.pickup_at AS start,
              CASE WHEN r.status IN ('active','draft') THEN GREATEST(r.planned_return_at, ?) ELSE r.actual_return_at END AS "end",
              r.status, r.planned_return_at, c.first_name || ' ' || c.last_name AS customer_name
       FROM rentals r JOIN customers c ON c.id = r.customer_id
       WHERE r.status IN ('draft','active','returned','closed') AND r.pickup_at < ?
         AND (CASE WHEN r.status IN ('active','draft') THEN GREATEST(r.planned_return_at, ?) ELSE r.actual_return_at END) > ?`,
      now, end, now, start,
    )).map((e) => ({ ...e, kind: 'rental' as const, overdue: e.status === 'active' && (e.planned_return_at ?? '') < now })),
    ...(await all<Omit<CalendarEvent, 'kind'>>(
      `SELECT id, vehicle_id, type AS label, start_date || 'T00:00' AS start,
              COALESCE(NULLIF(end_date,''), CASE WHEN status = 'in_progress' THEN ? ELSE start_date END) || 'T23:59' AS "end", status
       FROM maintenance WHERE status IN ('scheduled','in_progress','completed') AND start_date < ?`, end, end,
    ))
      .filter((m) => m.end > start)
      .map((e) => ({ ...e, kind: 'maintenance' as const })),
  ];
  return { from: start, days, vehicles, events, unassigned };
}


/** Sektör KPI'ları: doluluk, ADR, RevPAU, iptal/no-show, hasar, HGS/ceza tahsil oranı, NPS. */
async function kpis(from: string, to: string, fleetSize: number, periodDays: number, billed: number, rentedDays: number) {
  const toT = to + 'T23:59';
  const res = (await one<{ total: number; cancelled: number; no_show: number }>(
      `SELECT COUNT(*) total, SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) cancelled, SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) no_show FROM reservations WHERE pickup_at BETWEEN ? AND ?`, from, toT,
  ))!;
  const rentals = await scalar<number>("SELECT COUNT(*) FROM rentals WHERE status NOT IN ('cancelled','draft') AND pickup_at BETWEEN ? AND ?", from, toT);
  const dmg = (await one<{ n: number; cost: number; charged: number }>(
    'SELECT COUNT(*) n, COALESCE(SUM(repair_cost),0) cost, COALESCE(SUM(customer_charge),0) charged FROM damages WHERE reported_at BETWEEN ? AND ?', from, to,
  ))!;
  const km = await scalar<number>("SELECT COALESCE(SUM(end_km - start_km),0) FROM rentals WHERE end_km IS NOT NULL AND actual_return_at BETWEEN ? AND ?", from, toT);
  const tolls = (await one<{ total: number; charged: number }>(
    "SELECT COALESCE(SUM(amount),0) total, COALESCE(SUM(CASE WHEN status = 'charged' THEN amount ELSE 0 END),0) charged FROM toll_transactions WHERE passed_at BETWEEN ? AND ?", from, toT,
  ))!;
  const fines = (await one<{ total: number; charged: number }>(
    "SELECT COALESCE(SUM(amount),0) total, COALESCE(SUM(CASE WHEN charge_id IS NOT NULL THEN amount ELSE 0 END),0) charged FROM traffic_fines WHERE violation_at BETWEEN ? AND ? AND status <> 'cancelled'", from, toT,
  ))!;
  const fuelCharges = await scalar<number>("SELECT COALESCE(SUM(c.amount),0) FROM rental_charges c JOIN rentals r ON r.id = c.rental_id WHERE c.type = 'fuel' AND r.actual_return_at BETWEEN ? AND ?", from, toT);
  const available = fleetSize * periodDays;
  return {
    utilization: available ? round2((rentedDays / available) * 100) : 0,
    adr: rentedDays ? round2(billed / rentedDays) : 0,
    revpau: available ? round2(billed / available) : 0,
    cancel_rate: res.total ? round2((num(res.cancelled) / res.total) * 100) : 0,
    no_show_rate: res.total ? round2((num(res.no_show) / res.total) * 100) : 0,
    damage_count: dmg.n,
    damage_per_100_rentals: rentals ? round2((dmg.n / rentals) * 100) : 0,
    damage_cost: round2(dmg.cost),
    damage_recovered: round2(dmg.charged),
    damage_per_10k_km: km ? round2((dmg.n / km) * 10000) : 0,
    fuel_charges: round2(fuelCharges),
    toll_total: round2(tolls.total),
    toll_collection_rate: tolls.total ? round2((tolls.charged / tolls.total) * 100) : 0,
    fine_total: round2(fines.total),
    fine_collection_rate: fines.total ? round2((fines.charged / fines.total) * 100) : 0,
    nps: await npsSummary(),
  };
}
