import {
  AuthSetupError,
  buildLogoutCookies,
  buildSessionCookie,
  checkLoginRateLimit,
  clearLoginFailures,
  createTeamMemberUser,
  getAuthSystemStatus,
  getClientIp,
  getEffectiveJwtSecret,
  getSessionTtlSeconds,
  initializeFirstAdminUser,
  isHttpsRequest,
  listTeamMembers,
  recordLoginFailure,
  verifyUserCredentials,
} from './auth';
import { JWT_AUDIENCE, JWT_ISSUER, signJwt } from './jwt';
import {
  applySecurityHeaders,
  authenticateRequest,
  sanitizeNextPath,
  withAuthMiddleware,
} from './middleware';
import { Env, JwtSessionPayload, PublicUserProfile } from './types';

const PUBLIC_ASSET_PATHS = new Set(['/brand-mark.svg', '/favicon.ico', '/robots.txt']);

async function parseLoginBody(
  request: Request,
): Promise<{ username: string; password: string; next?: string; isForm: boolean }> {
  const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    return {
      username: String(form.get('username') ?? ''),
      password: String(form.get('password') ?? ''),
      next: form.get('next') ? String(form.get('next')) : undefined,
      isForm: true,
    };
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    username: typeof body.username === 'string' ? body.username : '',
    password: typeof body.password === 'string' ? body.password : '',
    next: typeof body.next === 'string' ? body.next : undefined,
    isForm: false,
  };
}

function isSameOriginAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return true;
  }
  return origin === url.origin;
}

async function issueAuthCookieAndResponse(
  request: Request,
  env: Env,
  user: PublicUserProfile,
  redirectTo: string,
  options: { status?: number; isForm?: boolean; url: URL } ,
): Promise<Response> {
  const jwtSecret = await getEffectiveJwtSecret(env);
  if (!jwtSecret) {
    return applySecurityHeaders(
      Response.json(
        { error: 'SERVER_CONFIG_ERROR', message: 'Kimlik doğrulama yapılandırması eksik.' },
        { status: 500 },
      ),
      { isHtmlOrApi: true },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = getSessionTtlSeconds(env);
  const payload: JwtSessionPayload = {
    sub: user.username,
    name: user.name,
    role: user.role,
    bapProject: user.bapProject,
    iat: now,
    exp: now + ttl,
    jti: crypto.randomUUID(),
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
  };

  const token = await signJwt(payload, jwtSecret);
  const sessionCookie = buildSessionCookie(token, isHttpsRequest(request), ttl);

  if (options.isForm) {
    return applySecurityHeaders(
      new Response(null, {
        status: 303,
        headers: { Location: new URL(redirectTo, options.url.origin).toString() },
      }),
      { isHtmlOrApi: true, extraSetCookies: [sessionCookie] },
    );
  }

  return applySecurityHeaders(
    Response.json(
      {
        authenticated: true,
        redirectTo,
        user,
      },
      { status: options.status ?? 200 },
    ),
    { isHtmlOrApi: true, extraSetCookies: [sessionCookie] },
  );
}

async function handleLoginGet(request: Request, env: Env, url: URL): Promise<Response> {
  const existingSession = await authenticateRequest(request, env);
  if (existingSession) {
    const target = sanitizeNextPath(url.searchParams.get('next'));
    return applySecurityHeaders(
      Response.redirect(new URL(target, url.origin).toString(), 302),
      { isHtmlOrApi: true },
    );
  }

  const assetReq = new Request(new URL('/login.html', url.origin).toString(), {
    method: 'GET',
    headers: { Accept: 'text/html' },
  });
  const assetRes = await env.ASSETS.fetch(assetReq);
  if (!assetRes.ok) {
    return applySecurityHeaders(
      new Response('Login sayfası yüklenemedi.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
      { isHtmlOrApi: true },
    );
  }
  const html = await assetRes.text();
  return applySecurityHeaders(
    new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
    { isHtmlOrApi: true },
  );
}

async function handleLoginPost(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isSameOriginAllowed(request, url)) {
    return applySecurityHeaders(
      Response.json({ error: 'FORBIDDEN_ORIGIN', message: 'Geçersiz istek kaynağı.' }, { status: 403 }),
      { isHtmlOrApi: true },
    );
  }

  const jwtSecret = await getEffectiveJwtSecret(env);
  if (!jwtSecret) {
    return applySecurityHeaders(
      Response.json(
        { error: 'SERVER_CONFIG_ERROR', message: 'Kimlik doğrulama yapılandırması eksik.' },
        { status: 500 },
      ),
      { isHtmlOrApi: true },
    );
  }

  const clientIp = getClientIp(request);
  const rateStatus = await checkLoginRateLimit(env, clientIp);
  if (!rateStatus.allowed) {
    return applySecurityHeaders(
      new Response(
        JSON.stringify({
          error: 'RATE_LIMITED',
          message: `Çok fazla başarısız giriş denemesi. Lütfen ${rateStatus.retryAfterSeconds} saniye sonra tekrar deneyin.`,
          retryAfterSeconds: rateStatus.retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Retry-After': String(rateStatus.retryAfterSeconds),
          },
        },
      ),
      { isHtmlOrApi: true },
    );
  }

  const { username, password, next, isForm } = await parseLoginBody(request);
  const user = await verifyUserCredentials(env, username, password);
  if (!user) {
    await recordLoginFailure(env, clientIp);
    return applySecurityHeaders(
      Response.json(
        { error: 'INVALID_CREDENTIALS', message: 'Kullanıcı adı veya parola hatalı.' },
        { status: 401 },
      ),
      { isHtmlOrApi: true },
    );
  }

  await clearLoginFailures(env, clientIp);
  const redirectTo = sanitizeNextPath(next ?? url.searchParams.get('next'));
  return issueAuthCookieAndResponse(request, env, user, redirectTo, { isForm, url });
}

async function handleSetupPost(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isSameOriginAllowed(request, url)) {
    return applySecurityHeaders(
      Response.json({ error: 'FORBIDDEN_ORIGIN', message: 'Geçersiz istek kaynağı.' }, { status: 403 }),
      { isHtmlOrApi: true },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const user = await initializeFirstAdminUser(env, {
      username: typeof body.username === 'string' ? body.username : undefined,
      password: typeof body.password === 'string' ? body.password : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      bapProject: typeof body.bapProject === 'string' ? body.bapProject : undefined,
      setupToken: typeof body.setupToken === 'string' ? body.setupToken : undefined,
    });
    const redirectTo = sanitizeNextPath(typeof body.next === 'string' ? body.next : null);
    return issueAuthCookieAndResponse(request, env, user, redirectTo, { status: 201, url });
  } catch (err) {
    if (err instanceof AuthSetupError) {
      return applySecurityHeaders(
        Response.json({ error: err.code, message: err.message }, { status: err.status }),
        { isHtmlOrApi: true },
      );
    }
    throw err;
  }
}

async function handleLogoutPost(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isSameOriginAllowed(request, url)) {
    return applySecurityHeaders(
      Response.json({ error: 'FORBIDDEN_ORIGIN', message: 'Geçersiz istek kaynağı.' }, { status: 403 }),
      { isHtmlOrApi: true },
    );
  }

  const session = await authenticateRequest(request, env);
  if (session && env.AUTH_USERS_KV) {
    const remaining = Math.max(60, session.exp - Math.floor(Date.now() / 1000));
    try {
      await env.AUTH_USERS_KV.put(`revoked:${session.jti}`, '1', { expirationTtl: remaining });
    } catch {
      /* ignore revocation write error */
    }
  }

  const clearCookies = buildLogoutCookies(isHttpsRequest(request));
  return applySecurityHeaders(
    Response.json({ authenticated: false, redirectTo: '/login' }),
    { isHtmlOrApi: true, extraSetCookies: clearCookies },
  );
}

async function serveProtectedSpaOrAsset(request: Request, env: Env, url: URL): Promise<Response> {
  let assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status === 404 && !url.pathname.includes('.')) {
    assetResponse = await env.ASSETS.fetch(
      new Request(new URL('/index.html', url.origin).toString(), {
        method: 'GET',
        headers: request.headers,
      }),
    );
  }
  const contentType = assetResponse.headers.get('Content-Type') ?? '';
  const isHtml = contentType.includes('text/html') || !url.pathname.includes('.');
  return applySecurityHeaders(assetResponse, { isHtmlOrApi: isHtml });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/health' && request.method === 'GET') {
      return applySecurityHeaders(
        Response.json({ status: 'ok', service: 'hypotheca-auth-worker' }),
        { isHtmlOrApi: true },
      );
    }

    if (pathname === '/api/auth/status' && request.method === 'GET') {
      const status = await getAuthSystemStatus(env);
      return applySecurityHeaders(Response.json(status), { isHtmlOrApi: true });
    }

    if (pathname === '/api/auth/setup' && request.method === 'POST') {
      return handleSetupPost(request, env, url);
    }

    if ((pathname === '/login' || pathname === '/login.html') && request.method === 'GET') {
      return handleLoginGet(request, env, url);
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      return handleLoginPost(request, env, url);
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      return handleLogoutPost(request, env, url);
    }

    if (PUBLIC_ASSET_PATHS.has(pathname) && (request.method === 'GET' || request.method === 'HEAD')) {
      const publicAsset = await env.ASSETS.fetch(request);
      return applySecurityHeaders(publicAsset);
    }

    return withAuthMiddleware(request, env, async (session) => {
      if (pathname === '/api/auth/me' && request.method === 'GET') {
        return applySecurityHeaders(
          Response.json({
            authenticated: true,
            capabilities: {
              teamManagementEnabled: Boolean(env.AUTH_USERS_KV),
            },
            user: {
              username: session.sub,
              name: session.name,
              role: session.role,
              bapProject: session.bapProject,
              exp: session.exp,
            },
          }),
          { isHtmlOrApi: true },
        );
      }

      if (pathname === '/api/auth/team' && request.method === 'GET') {
        if (session.role !== 'principal_investigator') {
          return applySecurityHeaders(
            Response.json(
              { error: 'FORBIDDEN', message: 'Ekip listesini yalnızca Proje Yürütücüsü görüntüleyebilir.' },
              { status: 403 },
            ),
            { isHtmlOrApi: true },
          );
        }
        const members = await listTeamMembers(env);
        return applySecurityHeaders(Response.json({ members }), { isHtmlOrApi: true });
      }

      if (pathname === '/api/auth/team' && request.method === 'POST') {
        if (!isSameOriginAllowed(request, url)) {
          return applySecurityHeaders(
            Response.json({ error: 'FORBIDDEN_ORIGIN', message: 'Geçersiz istek kaynağı.' }, { status: 403 }),
            { isHtmlOrApi: true },
          );
        }
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        try {
          const member = await createTeamMemberUser(env, session.role, {
            username: typeof body.username === 'string' ? body.username : undefined,
            password: typeof body.password === 'string' ? body.password : undefined,
            name: typeof body.name === 'string' ? body.name : undefined,
            role: typeof body.role === 'string' ? body.role : undefined,
            bapProject: typeof body.bapProject === 'string' ? body.bapProject : session.bapProject,
          });
          return applySecurityHeaders(
            Response.json({ member }, { status: 201 }),
            { isHtmlOrApi: true },
          );
        } catch (err) {
          if (err instanceof AuthSetupError) {
            return applySecurityHeaders(
              Response.json({ error: err.code, message: err.message }, { status: err.status }),
              { isHtmlOrApi: true },
            );
          }
          throw err;
        }
      }

      if (pathname.startsWith('/api/')) {
        return applySecurityHeaders(
          Response.json({ error: 'NOT_FOUND', message: 'API uç noktası bulunamadı.' }, { status: 404 }),
          { isHtmlOrApi: true },
        );
      }

      if (pathname === '/' && request.method === 'GET') {
        return applySecurityHeaders(
          Response.redirect(new URL('/dashboard', url.origin).toString(), 302),
          { isHtmlOrApi: true },
        );
      }

      return serveProtectedSpaOrAsset(request, env, url);
    });
  },
};
