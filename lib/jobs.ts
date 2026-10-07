// Zamanlanmış otomasyonlar: opsiyon süresi, hatırlatmalar, geç iade uyarısı, NPS anketi, e-posta kuyruğu.
import { all, getSettings } from './db';
import { addDays, fmtDateTime, today } from './core';
import { expireOptions } from './domain/reservations';
import { notifyRental, notifyReservation, processOutbox } from './domain/notify';

export async function runAutomation() {
  const now = new Date();
  const nowS = fmtDateTime(now);
  const in24 = fmtDateTime(addDays(now, 1));
  const result = { expired_options: expireOptions(), pickup_reminders: 0, return_reminders: 0, late_warnings: 0, nps: 0, emails: { sent: 0, failed: 0 } };
  if (getSettings().notify_auto === '1') {
    for (const r of all<{ id: number }>("SELECT id FROM reservations WHERE status = 'confirmed' AND pickup_at > ? AND pickup_at <= ?", nowS, in24)) {
      result.pickup_reminders += notifyReservation('pickup_reminder', r.id, true).length ? 1 : 0;
    }
    for (const r of all<{ id: number }>("SELECT id FROM rentals WHERE status = 'active' AND planned_return_at > ? AND planned_return_at <= ?", nowS, in24)) {
      result.return_reminders += notifyRental('return_reminder', r.id, { dedupeKey: `return_reminder:${r.id}` }).length ? 1 : 0;
    }
    for (const r of all<{ id: number }>("SELECT id FROM rentals WHERE status = 'active' AND planned_return_at < ?", nowS)) {
      result.late_warnings += notifyRental('late_return', r.id, { dedupeKey: `late:${r.id}:${today()}` }).length ? 1 : 0;
    }
    const since = fmtDateTime(addDays(now, -3));
    for (const r of all<{ id: number }>("SELECT id FROM rentals WHERE status IN ('returned','closed') AND actual_return_at >= ? AND id NOT IN (SELECT rental_id FROM nps_responses)", since)) {
      result.nps += notifyRental('nps', r.id, { dedupeKey: `nps:${r.id}` }).length ? 1 : 0;
    }
  }
  result.emails = await processOutbox();
  return result;
}

const g = globalThis as unknown as { __rentacarScheduler?: NodeJS.Timeout };

/** Sunucu başlarken (instrumentation) 10 dakikada bir otomasyonu çalıştırır. */
export function startScheduler() {
  if (g.__rentacarScheduler || process.env.DISABLE_SCHEDULER === '1') return;
  const tick = () => runAutomation().catch((e) => console.error('[otomasyon]', e));
  g.__rentacarScheduler = setInterval(tick, 10 * 60 * 1000);
  g.__rentacarScheduler.unref?.();
  setTimeout(tick, 15_000).unref?.();
}
