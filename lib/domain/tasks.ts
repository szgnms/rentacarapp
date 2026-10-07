// Operasyon iş emirleri: adrese teslim/alım, valet, yıkama/detailing, yol yardım, ikame araç, uzatma talebi.
import { all, insertRow, one, tx, updateRow } from '../db';
import { HttpError, mustGet, normDateTime, nowLocal, num, oneOf, optId, required, round2, str } from '../core';
import { audit } from '../audit';
import { scopedBranch } from '../permissions';
import { swapVehicle } from './agreements';
import type { Body, Rental, SessionUser } from '../types';

export const TASK_TYPES: Record<string, string> = {
  delivery: 'Adrese teslim',
  collection: 'Adresten alım',
  valet: 'Valet / havalimanı karşılama',
  wash: 'Yıkama',
  detailing: 'Detaylı temizlik',
  roadside: 'Yol yardım / çekici',
  replacement: 'İkame araç',
  extension_request: 'Uzatma talebi',
  other: 'Diğer',
};

export const TASK_STATUS = ['open', 'in_progress', 'done', 'cancelled'] as const;
export const TASK_PRIORITY = ['low', 'normal', 'high', 'urgent'] as const;

export interface Task {
  id: number;
  type: string;
  title: string;
  rental_id: number | null;
  reservation_id: number | null;
  vehicle_id: number | null;
  replacement_vehicle_id: number | null;
  branch_id: number | null;
  assigned_to: number | null;
  due_at: string | null;
  address: string | null;
  status: (typeof TASK_STATUS)[number];
  priority: (typeof TASK_PRIORITY)[number];
  cost: number;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
}

export type TaskRow = Task & {
  plate: string | null;
  contract_no: string | null;
  reservation_code: string | null;
  assigned_name: string | null;
  branch_name: string | null;
  replacement_plate: string | null;
};

export function listTasks(f: { status?: string; type?: string; assigned_to?: string; mine?: string; date?: string } = {}, user?: SessionUser): Promise<TaskRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status === 'open_all') where.push("t.status IN ('open','in_progress')");
  else if (str(f.status)) { where.push('t.status = ?'); params.push(str(f.status)!); }
  if (str(f.type)) { where.push('t.type = ?'); params.push(str(f.type)!); }
  if (str(f.assigned_to)) { where.push('t.assigned_to = ?'); params.push(num(f.assigned_to)); }
  if (f.mine === '1' && user) { where.push('(t.assigned_to = ? OR t.assigned_to IS NULL)'); params.push(user.id); }
  if (str(f.date)) { where.push("substr(COALESCE(t.due_at, t.created_at),1,10) <= ?"); params.push(str(f.date)!); }
  const branch = user ? scopedBranch(user) : null;
  if (branch) { where.push('(t.branch_id = ? OR t.branch_id IS NULL)'); params.push(branch); }
  return all<TaskRow>(
    `SELECT t.*, v.plate, r.contract_no, res.code AS reservation_code, u.full_name AS assigned_name, b.name AS branch_name, rv.plate AS replacement_plate
     FROM tasks t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN rentals r ON r.id = t.rental_id
     LEFT JOIN reservations res ON res.id = t.reservation_id LEFT JOIN users u ON u.id = t.assigned_to
     LEFT JOIN branches b ON b.id = t.branch_id LEFT JOIN vehicles rv ON rv.id = t.replacement_vehicle_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.status IN ('done','cancelled'), CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(t.due_at, t.created_at)
     LIMIT 500`,
    ...params,
  );
}

async function taskData(b: Body) {
  required(b, [['type', 'Tip']]);
  const type = oneOf(b.type, Object.keys(TASK_TYPES), 'Tip');
  let vehicleId = optId(b.vehicle_id);
  const rentalId = optId(b.rental_id);
  if (rentalId && !vehicleId) vehicleId = (await mustGet<Rental>('rentals', rentalId, 'Sözleşme')).vehicle_id;
  return {
    type,
    title: str(b.title) ?? TASK_TYPES[type],
    rental_id: rentalId,
    reservation_id: optId(b.reservation_id),
    vehicle_id: vehicleId,
    replacement_vehicle_id: optId(b.replacement_vehicle_id),
    branch_id: optId(b.branch_id),
    assigned_to: optId(b.assigned_to),
    due_at: str(b.due_at) ? normDateTime(b.due_at, 'Termin') : null,
    address: str(b.address),
    priority: oneOf(b.priority, TASK_PRIORITY, 'Öncelik', type === 'roadside' ? 'urgent' : 'normal'),
    cost: round2(Math.max(0, num(b.cost))),
    notes: str(b.notes),
  };
}

export async function saveTask(id: number | null, b: Body, user: SessionUser | null): Promise<Task> {
  if (id) {
    const old = await mustGet<Task>('tasks', id, 'İş emri');
    await updateRow('tasks', id, { ...await taskData({ ...old, ...b }), status: oneOf(b.status ?? old.status, TASK_STATUS, 'Durum') });
  } else id = await insertRow('tasks', { ...await taskData(b), created_by: user?.id ?? null });
  await audit('task.save', 'task', id, { type: b.type, status: b.status });
  return mustGet<Task>('tasks', id);
}

/** Durum ilerletme; ikame araç iş emri tamamlanınca sözleşmedeki araç değiştirilir. */
export async function setTaskStatus(id: number, status: unknown, b: Body, user: SessionUser): Promise<Task> {
  const t = await mustGet<Task>('tasks', id, 'İş emri');
  const s = oneOf(status, TASK_STATUS, 'Durum');
  await tx(async () => {
    if (s === 'done' && t.type === 'replacement' && t.rental_id && t.replacement_vehicle_id && t.status !== 'done') {
      await swapVehicle(t.rental_id, { vehicle_id: t.replacement_vehicle_id, reason: t.notes ?? 'İkame araç', old_vehicle_km: b.old_vehicle_km, old_vehicle_status: b.old_vehicle_status }, user);
    }
    await updateRow('tasks', id, { status: s, completed_at: s === 'done' ? nowLocal() : null, cost: str(b.cost) === null ? t.cost : round2(num(b.cost)) });
    if (s === 'done' && (b.cost || t.cost) && ['roadside', 'wash', 'detailing'].includes(t.type)) {
      await insertRow('expenses', {
        vehicle_id: t.vehicle_id, category: t.type === 'roadside' ? 'Çekici / yol yardım' : 'Yıkama/Temizlik',
        amount: round2(num(b.cost, t.cost)), expense_date: nowLocal().slice(0, 10), description: `İş emri #${id}: ${t.title}`, created_by: user.id,
      });
    }
  });
  await audit('task.status', 'task', id, { from: t.status, to: s });
  return mustGet<Task>('tasks', id);
}

export const openTaskCount = async () => (await one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE status IN ('open','in_progress')"))?.n ?? 0;

export async function deleteTask(id: number) {
  const t = await mustGet<Task>('tasks', id, 'İş emri');
  if (t.status === 'done') throw new HttpError(409, 'Tamamlanmış iş emri silinemez');
  await updateRow('tasks', id, { status: 'cancelled' });
  return { ok: true };
}
