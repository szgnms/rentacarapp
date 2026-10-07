// İstek bağlamı: denetim izi için kullanıcı, IP ve cihaz bilgisini domain katmanına taşır.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionUser } from './types';

export interface RequestContext {
  user: SessionUser | null;
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const withContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);
export const getContext = (): RequestContext => storage.getStore() ?? { user: null, ip: null, userAgent: null };

export function contextFromHeaders(h: Headers, user: SessionUser | null): RequestContext {
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || null;
  return { user, ip, userAgent: h.get('user-agent') };
}
