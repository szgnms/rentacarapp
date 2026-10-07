// Fiyatlandırma yönetimi: sezonlar, grup × sezon × kanal × gün bandı tabloları, kanallar, kuponlar, depozito kuralları, acenteler.
import { all, insertRow, one, run, updateRow } from '../db';
import { HttpError, bool, mustGet, normDate, num, oneOf, optId, required, str } from '../core';
import { CATEGORIES, DAY_BANDS, type Coupon, type DepositRule, type RatePlan } from '../rules';
import { audit } from '../audit';
import type { Body } from '../types';

export interface Season {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  priority: number;
}

export interface Channel {
  code: string;
  name: string;
  markup_pct: number;
  commission_pct: number;
  active: number;
}

export interface Agency {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  tax_no: string | null;
  commission_pct: number;
  active: number;
}

export type RatePlanRow = RatePlan & { season_name: string | null };

export async function pricingData() {
  return {
    seasons: await all<Season>('SELECT * FROM seasons ORDER BY start_date'),
    plans: await all<RatePlanRow>('SELECT rp.*, s.name AS season_name FROM rate_plans rp LEFT JOIN seasons s ON s.id = rp.season_id ORDER BY rp.category, rp.season_id IS NOT NULL, s.start_date, rp.channel'),
    channels: await all<Channel>('SELECT * FROM channels ORDER BY code'),
    coupons: await all<Coupon>('SELECT * FROM coupons ORDER BY active DESC, id DESC'),
    deposit_rules: await all<DepositRule>('SELECT * FROM deposit_rules ORDER BY category, amount'),
    agencies: await all<Agency>('SELECT * FROM agencies ORDER BY active DESC, name'),
  };
}

export const listChannels = () => all<Channel>('SELECT * FROM channels WHERE active = 1 ORDER BY code');
export const listAgencies = () => all<Agency>('SELECT * FROM agencies WHERE active = 1 ORDER BY name');

type Kind = 'season' | 'plan' | 'channel' | 'coupon' | 'deposit_rule' | 'agency';

const TABLE: Record<Kind, string> = {
  season: 'seasons', plan: 'rate_plans', channel: 'channels', coupon: 'coupons', deposit_rule: 'deposit_rules', agency: 'agencies',
};

function data(kind: Kind, b: Body): Record<string, string | number | null> {
  switch (kind) {
    case 'season': {
      required(b, [['name', 'Ad'], ['start_date', 'Başlangıç'], ['end_date', 'Bitiş']]);
      const start = normDate(b.start_date, 'Başlangıç');
      const end = normDate(b.end_date, 'Bitiş');
      if (end < start) throw new HttpError(400, 'Bitiş başlangıçtan önce olamaz');
      return { name: str(b.name), start_date: start, end_date: end, priority: Math.floor(num(b.priority)) };
    }
    case 'plan': {
      required(b, [['name', 'Ad'], ['category', 'Araç grubu']]);
      const d: Record<string, string | number | null> = {
        name: str(b.name), category: oneOf(b.category, CATEGORIES, 'Araç grubu'), season_id: optId(b.season_id), channel: str(b.channel),
        active: b.active === undefined ? 1 : bool(b.active),
      };
      for (const [key, label] of DAY_BANDS) {
        const v = num(b[key], NaN);
        if (!(v >= 0)) throw new HttpError(400, `${label} fiyatı zorunludur`);
        d[key] = v;
      }
      return d;
    }
    case 'channel':
      required(b, [['code', 'Kod'], ['name', 'Ad']]);
      return { code: str(b.code), name: str(b.name), markup_pct: num(b.markup_pct), commission_pct: Math.max(0, num(b.commission_pct)), active: b.active === undefined ? 1 : bool(b.active) };
    case 'coupon': {
      required(b, [['code', 'Kod'], ['value', 'Değer']]);
      const type = oneOf(b.type, ['percent', 'amount'] as const, 'Tip', 'percent');
      const value = num(b.value);
      if (!(value > 0) || (type === 'percent' && value > 100)) throw new HttpError(400, 'Kupon değeri geçersiz');
      return {
        code: str(b.code)!.toUpperCase(), description: str(b.description), type, value,
        valid_from: normDate(b.valid_from, 'Başlangıç', true), valid_to: normDate(b.valid_to, 'Bitiş', true),
        min_days: Math.max(0, Math.floor(num(b.min_days))), early_booking_days: Math.max(0, Math.floor(num(b.early_booking_days))),
        category: str(b.category), max_uses: Math.max(0, Math.floor(num(b.max_uses))), active: b.active === undefined ? 1 : bool(b.active),
      };
    }
    case 'deposit_rule':
      required(b, [['amount', 'Tutar']]);
      return {
        category: str(b.category), driver_age_under: str(b.driver_age_under) === null ? null : Math.floor(num(b.driver_age_under)),
        license_years_under: str(b.license_years_under) === null ? null : Math.floor(num(b.license_years_under)), amount: Math.max(0, num(b.amount)), note: str(b.note),
      };
    case 'agency':
      required(b, [['name', 'Ad']]);
      return {
        name: str(b.name), contact_name: str(b.contact_name), phone: str(b.phone), email: str(b.email), tax_no: str(b.tax_no),
        commission_pct: Math.max(0, num(b.commission_pct)), active: b.active === undefined ? 1 : bool(b.active),
      };
  }
}

export async function savePricing(kind: Kind, id: string | null, b: Body) {
  if (!TABLE[kind]) throw new HttpError(404, 'Bilinmeyen tür');
  const d = data(kind, b);
  if (kind === 'channel') {
    if (id) await run('UPDATE channels SET name = ?, markup_pct = ?, commission_pct = ?, active = ? WHERE code = ?', d.name, d.markup_pct, d.commission_pct, d.active, id);
    else {
      if (await one('SELECT 1 FROM channels WHERE code = ?', d.code)) throw new HttpError(409, 'Bu kanal kodu zaten var');
      await insertRow('channels', d);
    }
  } else if (kind === 'coupon' && await one('SELECT 1 FROM coupons WHERE code = ? AND id <> ?', d.code, num(id))) {
    throw new HttpError(409, 'Bu kupon kodu zaten var');
  } else if (id) {
    await mustGet(TABLE[kind], num(id));
    await updateRow(TABLE[kind], num(id), d);
  } else id = String(await insertRow(TABLE[kind], d));
  await audit(`pricing.${kind}`, kind, num(id) || null, d);
  return pricingData();
}

export async function deletePricing(kind: Kind, id: string) {
  if (kind === 'channel') await run('UPDATE channels SET active = 0 WHERE code = ?', id);
  else if (kind === 'season') {
    if (await one('SELECT 1 FROM rate_plans WHERE season_id = ?', num(id))) throw new HttpError(409, 'Sezona bağlı fiyat planları var');
    await run('DELETE FROM seasons WHERE id = ?', num(id));
  } else if (kind === 'agency' || kind === 'coupon') await run(`UPDATE ${TABLE[kind]} SET active = 0 WHERE id = ?`, num(id));
  else await run(`DELETE FROM ${TABLE[kind]} WHERE id = ?`, num(id));
  await audit(`pricing.${kind}.delete`, kind, num(id) || null);
  return pricingData();
}

export const PRICING_KINDS = Object.keys(TABLE) as Kind[];
export type { Kind as PricingKind };
