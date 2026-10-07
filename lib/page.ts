import { notFound } from 'next/navigation';
import { HttpError } from './core';
import { listVehicles } from './domain/fleet';

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
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}

/** Diyaloglardaki araç seçim listesi. */
export const vehicleOptions = () => listVehicles().map((v) => ({ id: v.id, label: `${v.plate} · ${v.brand} ${v.model}` }));
