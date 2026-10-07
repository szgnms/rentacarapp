import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, userFromToken } from './auth';
import type { SessionUser } from './types';

/** Server Component'lerde oturumdaki kullanıcı (yoksa null). */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userFromToken(token);
}

/** Oturum yoksa giriş sayfasına yönlendirir. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}
