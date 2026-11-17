import {
  buildLogoutCookies,
  extractSessionToken,
  getEffectiveJwtSecret,
  isHttpsRequest,
} from './auth';
import { verifyJwt } from './jwt';
import { Env, JwtSessionPayload } from './types';

export const SECURITY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') {
    return '/dashboard';
  }
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    /[\r\n\0]/.test(trimmed)
  ) {
    return '/dashboard';
  }
  if (trimmed === '/' || trimmed === '/login' || trimmed.startsWith('/login?')) {
    return '/dashboard';
  }
  return trimmed;
}

export function applySecurityHeaders(
  response: Response,
  options: { isHtmlOrApi?: boolean; extraSetCookies?: string[] } = {},
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', SECURITY_CSP);
  if (options.isHtmlOrApi) {
    headers.set('Cache-Control', 'private, no-store, max-age=0');
  }
  if (options.extraSetCookies) {
    for (const cookie of options.extraSetCookies) {
      headers.append('Set-Cookie', cookie);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function authenticateRequest(
  request: Request,
  env: Env,
): Promise<JwtSessionPayload | null> {
  const token = extractSessionToken(request);
  if (!token) {
    return null;
  }
  const secret = await getEffectiveJwtSecret(env);
  if (!secret) {
    return null;
  }
  const payload = await verifyJwt(token, secret);
  if (!payload) {
    return null;
  }
  if (env.AUTH_USERS_KV) {
    try {
      const revoked = await env.AUTH_USERS_KV.get(`revoked:${payload.jti}`);
      if (revoked) {
        return null;
      }
    } catch {
      /* ignore KV check error */
    }
  }
  return payload;
}

function expectsJson(request: Request, pathname: string): boolean {
  if (pathname.startsWith('/api/')) {
    return true;
  }
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

export async function withAuthMiddleware(
  request: Request,
  env: Env,
  protectedHandler: (session: JwtSessionPayload) => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  const session = await authenticateRequest(request, env);

  if (!session) {
    const clearCookies = extractSessionToken(request)
      ? buildLogoutCookies(isHttpsRequest(request))
      : [];

    if (expectsJson(request, url.pathname)) {
      return applySecurityHeaders(
        Response.json(
          {
            error: 'UNAUTHORIZED',
            message: 'Oturum geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.',
          },
          { status: 401 },
        ),
        { isHtmlOrApi: true, extraSetCookies: clearCookies },
      );
    }

    const nextTarget = sanitizeNextPath(`${url.pathname}${url.search}`);
    const loginUrl = new URL('/login', url.origin);
    loginUrl.searchParams.set('next', nextTarget);
    const headers = new Headers({
      Location: loginUrl.toString(),
      'Cache-Control': 'private, no-store, max-age=0',
    });
    for (const cookie of clearCookies) {
      headers.append('Set-Cookie', cookie);
    }
    return applySecurityHeaders(
      new Response(null, { status: 302, headers }),
      { isHtmlOrApi: true },
    );
  }

  return protectedHandler(session);
}
