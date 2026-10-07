import { handler } from '@/lib/api';
import { logout, SESSION_COOKIE } from '@/lib/auth';

export const POST = handler(async ({ token }) => {
  await logout(token);
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
});
