import { login, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';
import { errorResponse } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { user, token } = login(body.username, body.password);
    const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
    return Response.json(
      { ...user, token },
      { headers: { 'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}` } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
