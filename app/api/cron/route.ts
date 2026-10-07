// Vercel Cron (vercel.json) ile tetiklenen otomasyon: opsiyon iptalleri, hatırlatmalar, NPS, e-posta kuyruğu.
// CRON_SECRET tanımlıysa Vercel isteğe `Authorization: Bearer <CRON_SECRET>` ekler; başka çağrılar reddedilir.
import { runAutomation } from '@/lib/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Yetkisiz' }, { status: 401 });
  }
  return Response.json(await runAutomation());
}
