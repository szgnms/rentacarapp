import { notFound } from 'next/navigation';
import { HttpError } from './core';
import { listVehicles } from './domain/vehicles';
import { all } from './db';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export type IdParams = Promise<{ id: string }>;

/** Next.js searchParams → düz string sözlüğü (dizi değerlerde ilki). */
export async function flat(sp: SearchParams): Promise<Record<string, string>> {
  const o = await sp;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? '') : (v ?? '')]));
}

/** Domain çağrısında 404 → Next.js notFound(). */
export function orNotFound<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400 || e.status === 410)) notFound();
    throw e;
  }
}

/** Diyaloglardaki araç seçim listesi. */
export const vehicleOptions = () => listVehicles().map((v) => ({ id: v.id, label: `${v.plate} · ${v.brand} ${v.model}` }));

/** HGS/ceza eşleştirme diyalogları için son sözleşmeler. */
export const rentalOptions = () =>
  all<{ id: number; contract_no: string; plate: string; pickup_at: string; customer_name: string }>(
    `SELECT r.id, r.contract_no, v.plate, r.pickup_at, c.first_name || ' ' || c.last_name AS customer_name FROM rentals r
     JOIN vehicles v ON v.id = r.vehicle_id JOIN customers c ON c.id = r.customer_id
     WHERE r.status IN ('active','returned','closed') ORDER BY r.pickup_at DESC LIMIT 400`,
  ).map((r) => [r.id, `${r.contract_no} · ${r.plate} · ${r.customer_name} · ${r.pickup_at.slice(0, 10)}`] as [number, string]);
