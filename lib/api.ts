import { HttpError } from './core';
import { SESSION_COOKIE, assertAdmin, userFromToken } from './auth';
import type { Body, SessionUser } from './types';

export interface Ctx<P> {
  req: Request;
  user: SessionUser;
  token: string;
  params: P;
  body: Body;
  query: Record<string, string>;
}

type Params = Record<string, string>;

export function tokenFromRequest(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return bearer || null;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, details: e.details }, { status: e.status });
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('constraint failed')) return Response.json({ error: 'Veri kısıtı ihlali: ' + msg }, { status: 400 });
  console.error(e);
  return Response.json({ error: 'Sunucu hatası' }, { status: 500 });
}

export const created = (data: unknown) => Response.json(data, { status: 201 });

/**
 * Route handler sarmalayıcısı: oturum doğrulama, (opsiyonel) yönetici kontrolü,
 * JSON gövde/sorgu ayrıştırma ve hata → JSON yanıt dönüşümü.
 */
export function handler<P extends Params = Params>(
  fn: (ctx: Ctx<P>) => unknown | Promise<unknown>,
  opts: { admin?: boolean } = {},
) {
  return async (req: Request, segment?: { params: Promise<P> }): Promise<Response> => {
    try {
      const token = tokenFromRequest(req);
      const user = userFromToken(token);
      if (!user || !token) throw new HttpError(401, 'Oturum açmanız gerekiyor');
      if (opts.admin) assertAdmin(user);
      let body: Body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const text = await req.text();
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            throw new HttpError(400, 'Geçersiz JSON');
          }
        }
      }
      const query = Object.fromEntries(new URL(req.url).searchParams);
      const params = (segment ? await segment.params : {}) as P;
      const result = await fn({ req, user, token, params, body, query });
      return result instanceof Response ? result : Response.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
