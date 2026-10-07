import { login, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';
import { errorResponse } from '@/lib/api';
import { audit } from '@/lib/audit';
import { contextFromHeaders, withContext } from '@/lib/context';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { user, token } = await login(body.username, body.password);
    await withContext(contextFromHeaders(req.headers, user), () => audit('auth.login', 'user', user.id));
    const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
    return Response.json(
      { ...user, token },
      { headers: { 'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}` } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
