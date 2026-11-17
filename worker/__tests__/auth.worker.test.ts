import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker from '../index';
import {
  hashPasswordPbkdf2,
  resetRateLimiterForTests,
  SESSION_COOKIE_DEV,
  SESSION_COOKIE_SECURE,
} from '../auth';
import { JWT_AUDIENCE, JWT_ISSUER, signJwt } from '../jwt';
import { Env, KvStore } from '../types';

const TEST_SECRET = 'test-hypotheca-jwt-secret-key-must-be-at-least-32-chars';
const BASE_HTTPS = 'https://hypotheca.muammer-b28.workers.dev';
const BASE_HTTP = 'http://127.0.0.1:8787';

let loginHtmlFixture = '';
let usersJsonFixture = '';
let zeynepKvRecord = '';

function createMemoryKv(initial: Record<string, string> = {}): KvStore & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function createMockAssets() {
  return {
    async fetch(input: Request | string | URL): Promise<Response> {
      const reqUrl = typeof input === 'string' || input instanceof URL ? new URL(input.toString()) : new URL(input.url);
      if (reqUrl.pathname === '/login.html') {
        return new Response(loginHtmlFixture, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      if (reqUrl.pathname === '/brand-mark.svg') {
        return new Response('<svg></svg>', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        });
      }
      if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
        return new Response('<!doctype html><html><body><div id="root">Hypotheca SPA</div></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      if (reqUrl.pathname === '/dashboard') {
        return new Response(null, { status: 404 });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}

function extractCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('Set-Cookie başlığı bulunamadı.');
  return setCookieHeader.split(';')[0].trim();
}

describe('Hypotheca Cloudflare Worker Auth, Middleware & Routing', () => {
  beforeAll(async () => {
    loginHtmlFixture = await fs.readFile(path.resolve(process.cwd(), 'public/login.html'), 'utf8');
    const hashed = await hashPasswordPbkdf2('ZeynepGizli2026!', '1c7c31439887e686a26c23e363b8bcb4', 100_000);
    const zeynepRecord = {
      username: 'zeynep.hoca',
      passwordHash: hashed.hashHex,
      salt: hashed.saltHex,
      iterations: hashed.iterations,
      name: 'Prof. Dr. Zeynep Kaya',
      role: 'principal_investigator',
      bapProject: 'BAP-2026-ZEYNEP-01',
    };
    usersJsonFixture = JSON.stringify([zeynepRecord]);
    zeynepKvRecord = JSON.stringify(zeynepRecord);
  });

  beforeEach(() => {
    resetRateLimiterForTests();
  });

  function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
      ASSETS: createMockAssets(),
      JWT_SECRET: TEST_SECRET,
      AUTH_USERS_JSON: usersJsonFixture,
      SESSION_TTL_SECONDS: '3600',
      BAP_PROJECT_CODE: 'BAP-2026-ZEYNEP-01',
      ...overrides,
    };
  }

  it('unauthenticated GET / and /dashboard redirect 302 to /login?next=/dashboard', async () => {
    const env = makeEnv();
    for (const targetPath of ['/', '/dashboard']) {
      const res = await worker.fetch(new Request(`${BASE_HTTPS}${targetPath}`), env);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(`${BASE_HTTPS}/login?next=%2Fdashboard`);
    }
  });

  it('unauthenticated GET /api/auth/me returns 401 JSON', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request(`${BASE_HTTPS}/api/auth/me`), env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('serves /login with strict security headers and no-store caching', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request(`${BASE_HTTPS}/login`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const html = await res.text();
    expect(html).toContain('Hypotheca');
    expect(html).toContain('/api/auth/login');
  });

  it('rejects wrong password with 401 and rate-limits after 5 failures (429)', async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(
        new Request(`${BASE_HTTPS}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
          body: JSON.stringify({ username: 'zeynep.hoca', password: 'WrongPassword!' }),
        }),
        env,
      );
      expect(res.status).toBe(401);
    }

    const blocked = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
        body: JSON.stringify({ username: 'zeynep.hoca', password: 'ZeynepGizli2026!' }),
      }),
      env,
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('authenticates via AUTH_USERS_JSON, sets __Host- HttpOnly Secure cookie, and routes to /dashboard', async () => {
    const env = makeEnv();
    const loginRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: BASE_HTTPS,
          'CF-Connecting-IP': '203.0.113.10',
        },
        body: JSON.stringify({
          username: 'zeynep.hoca',
          password: 'ZeynepGizli2026!',
          next: '//evil.example.com',
        }),
      }),
      env,
    );

    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get('Set-Cookie');
    expect(setCookie).toContain(`${SESSION_COOKIE_SECURE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');

    const loginJson = (await loginRes.json()) as {
      authenticated: boolean;
      redirectTo: string;
      user: { username: string; name: string; bapProject: string };
    };
    expect(loginJson.authenticated).toBe(true);
    expect(loginJson.redirectTo).toBe('/dashboard');
    expect(loginJson.user.name).toBe('Prof. Dr. Zeynep Kaya');

    const cookieHeader = extractCookiePair(setCookie);

    // Authenticated GET / redirects to /dashboard
    const rootRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/`, { headers: { Cookie: cookieHeader } }),
      env,
    );
    expect(rootRes.status).toBe(302);
    expect(rootRes.headers.get('Location')).toBe(`${BASE_HTTPS}/dashboard`);

    // Authenticated GET /login?next=//evil.example.com safely redirects to /dashboard
    const loginRedirect = await worker.fetch(
      new Request(`${BASE_HTTPS}/login?next=//evil.example.com`, {
        headers: { Cookie: cookieHeader },
      }),
      env,
    );
    expect(loginRedirect.status).toBe(302);
    expect(loginRedirect.headers.get('Location')).toBe(`${BASE_HTTPS}/dashboard`);

    // Authenticated GET /dashboard serves SPA
    const dashRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/dashboard`, { headers: { Cookie: cookieHeader } }),
      env,
    );
    expect(dashRes.status).toBe(200);
    expect(await dashRes.text()).toContain('Hypotheca SPA');

    // Authenticated GET /api/auth/me returns user profile
    const meRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/me`, { headers: { Cookie: cookieHeader } }),
      env,
    );
    expect(meRes.status).toBe(200);
    const meJson = (await meRes.json()) as { user: { username: string; bapProject: string } };
    expect(meJson.user.username).toBe('zeynep.hoca');
    expect(meJson.user.bapProject).toBe('BAP-2026-ZEYNEP-01');
  });

  it('supports Cloudflare KV user store and revokes jti on logout', async () => {
    const kv = createMemoryKv({ 'user:zeynep.hoca': zeynepKvRecord });
    const env = makeEnv({ AUTH_USERS_JSON: undefined, AUTH_USERS_KV: kv });

    const loginRes = await worker.fetch(
      new Request(`${BASE_HTTP}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
        body: JSON.stringify({ username: 'zeynep.hoca', password: 'ZeynepGizli2026!' }),
      }),
      env,
    );
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get('Set-Cookie');
    expect(setCookie).toContain(`${SESSION_COOKIE_DEV}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).not.toContain('Secure');

    const cookieHeader = extractCookiePair(setCookie);
    const meBefore = await worker.fetch(
      new Request(`${BASE_HTTP}/api/auth/me`, { headers: { Cookie: cookieHeader } }),
      env,
    );
    expect(meBefore.status).toBe(200);

    const logoutRes = await worker.fetch(
      new Request(`${BASE_HTTP}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookieHeader },
      }),
      env,
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get('Set-Cookie')).toContain('Max-Age=0');

    // Old token must now be rejected because jti was revoked in KV
    const meAfter = await worker.fetch(
      new Request(`${BASE_HTTP}/api/auth/me`, { headers: { Cookie: cookieHeader } }),
      env,
    );
    expect(meAfter.status).toBe(401);
  });

  it('rejects tampered and expired JWT tokens and clears stale cookie', async () => {
    const env = makeEnv();
    const now = Math.floor(Date.now() / 1000);
    const validToken = await signJwt(
      {
        sub: 'zeynep.hoca',
        name: 'Prof. Dr. Zeynep Kaya',
        role: 'principal_investigator',
        bapProject: 'BAP-2026-ZEYNEP-01',
        iat: now - 10,
        exp: now + 300,
        jti: 'jti-tamper-test',
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
      },
      TEST_SECRET,
    );
    const tampered = `${validToken.slice(0, -4)}xxxx`;

    const tamperedRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/dashboard`, {
        headers: { Cookie: `${SESSION_COOKIE_SECURE}=${tampered}` },
      }),
      env,
    );
    expect(tamperedRes.status).toBe(302);
    expect(tamperedRes.headers.get('Location')).toContain('/login');
    expect(tamperedRes.headers.get('Set-Cookie')).toContain('Max-Age=0');

    const expiredToken = await signJwt(
      {
        sub: 'zeynep.hoca',
        name: 'Prof. Dr. Zeynep Kaya',
        role: 'principal_investigator',
        bapProject: 'BAP-2026-ZEYNEP-01',
        iat: now - 7200,
        exp: now - 60,
        jti: 'jti-expired-test',
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
      },
      TEST_SECRET,
    );
    const expiredRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_SECURE}=${expiredToken}` },
      }),
      env,
    );
    expect(expiredRes.status).toBe(401);
  });

  it('supports zero-config first-run setup in fresh KV (auto-generates JWT secret, locks setup, and manages team)', async () => {
    const kv = createMemoryKv();
    const env = makeEnv({
      JWT_SECRET: undefined,
      AUTH_USERS_JSON: undefined,
      AUTH_USERS_KV: kv,
    });

    // 1. Fresh instance advertises canSelfSetup: true
    const statusBefore = await worker.fetch(new Request(`${BASE_HTTPS}/api/auth/status`), env);
    expect(statusBefore.status).toBe(200);
    expect(await statusBefore.json()).toEqual({
      initialized: false,
      canSelfSetup: true,
      requiresSetupToken: false,
      teamManagementEnabled: true,
    });

    // 2. First-run setup creates PI account and auto-generates KV JWT secret + HttpOnly cookie
    const setupRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_HTTPS },
        body: JSON.stringify({
          name: 'Prof. Dr. Zeynep Kaya',
          username: 'zeynep.hoca',
          password: 'AkademikParola2026!',
          bapProject: 'BAP-2026-KV',
        }),
      }),
      env,
    );
    expect(setupRes.status).toBe(201);
    const setupCookie = extractCookiePair(setupRes.headers.get('Set-Cookie'));
    expect(setupCookie).toContain(`${SESSION_COOKIE_SECURE}=`);
    expect(kv.store.get('system:jwt_secret')?.length).toBe(64);
    expect(kv.store.get('system:initialized')).toBe('true');

    // 3. Second setup attempt is permanently blocked (403 ALREADY_INITIALIZED)
    const secondSetup = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_HTTPS },
        body: JSON.stringify({
          name: 'Saldırgan',
          username: 'hacker',
          password: 'HackerPassword123',
        }),
      }),
      env,
    );
    expect(secondSetup.status).toBe(403);

    // 4. PI can access /api/auth/me and add a team member via /api/auth/team
    const meRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/me`, { headers: { Cookie: setupCookie } }),
      env,
    );
    expect(meRes.status).toBe(200);
    const meJson = (await meRes.json()) as {
      capabilities: { teamManagementEnabled: boolean };
      user: { username: string; role: string };
    };
    expect(meJson.capabilities.teamManagementEnabled).toBe(true);
    expect(meJson.user.role).toBe('principal_investigator');

    const addMemberRes = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_HTTPS, Cookie: setupCookie },
        body: JSON.stringify({
          name: 'Arş. Gör. Eren Demir',
          username: 'eren.arastirmaci',
          password: 'AsistanParola2026!',
          role: 'co_researcher',
        }),
      }),
      env,
    );
    expect(addMemberRes.status).toBe(201);

    // 5. Added team member can log in, and co_researcher cannot manage team (403)
    const erenLogin = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_HTTPS },
        body: JSON.stringify({
          username: 'eren.arastirmaci',
          password: 'AsistanParola2026!',
        }),
      }),
      env,
    );
    expect(erenLogin.status).toBe(200);
    const erenCookie = extractCookiePair(erenLogin.headers.get('Set-Cookie'));

    const erenTeamTry = await worker.fetch(
      new Request(`${BASE_HTTPS}/api/auth/team`, { headers: { Cookie: erenCookie } }),
      env,
    );
    expect(erenTeamTry.status).toBe(403);
  });
});
