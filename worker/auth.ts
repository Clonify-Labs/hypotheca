import { toArrayBuffer } from './jwt';
import { AuthSystemStatus, Env, PublicUserProfile, StoredUserRecord } from './types';

export const PBKDF2_ITERATIONS = 100_000;
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const SESSION_COOKIE_SECURE = '__Host-hypotheca_session';
export const SESSION_COOKIE_DEV = 'hypotheca_session';

const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_SECONDS = 300;
const DUMMY_SALT_HEX = '7a65796e65702d6879706f74686563612d6261702d73616c742d3230323621';
const DUMMY_HASH_HEX = '0000000000000000000000000000000000000000000000000000000000000000';
const KV_JWT_SECRET_KEY = 'system:jwt_secret';
const KV_INITIALIZED_KEY = 'system:initialized';
const KV_USERS_LIST_KEY = 'users:list';
const USERNAME_REGEX = /^[a-z0-9._-]{3,40}$/;

const encoder = new TextEncoder();
const failedLoginLog = new Map<string, number[]>();

export class AuthSetupError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthSetupError';
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error('Geçersiz hex dizesi.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function constantTimeEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = hexToBytes(aHex);
    const b = hexToBytes(bHex);
    if (a.length !== b.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  } catch {
    return false;
  }
}

export function constantTimeEqualText(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export async function hashPasswordPbkdf2(
  password: string,
  saltHex?: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ hashHex: string; saltHex: string; iterations: number }> {
  const safeIterations = Math.min(Math.max(10_000, Math.floor(iterations)), PBKDF2_ITERATIONS);
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(encoder.encode(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations: safeIterations,
    },
    keyMaterial,
    256,
  );
  return {
    hashHex: bytesToHex(new Uint8Array(derived)),
    saltHex: bytesToHex(salt),
    iterations: safeIterations,
  };
}

function parseUsersJson(raw: string | undefined): StoredUserRecord[] {
  if (!raw || !raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (u): u is StoredUserRecord =>
          Boolean(u) &&
          typeof u === 'object' &&
          typeof (u as StoredUserRecord).username === 'string' &&
          typeof (u as StoredUserRecord).passwordHash === 'string' &&
          typeof (u as StoredUserRecord).salt === 'string',
      );
    }
    if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed as Record<string, Partial<StoredUserRecord>>);
      return entries
        .filter(([, val]) => val && typeof val.passwordHash === 'string' && typeof val.salt === 'string')
        .map(([key, val]) => ({
          username: (val.username ?? key).toLowerCase(),
          passwordHash: val.passwordHash!,
          salt: val.salt!,
          iterations: val.iterations,
          name: val.name ?? key,
          role: val.role ?? 'researcher',
          bapProject: val.bapProject ?? 'BAP-GENEL',
        }));
    }
    return [];
  } catch {
    return [];
  }
}

export async function getEffectiveJwtSecret(env: Env): Promise<string | null> {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 32) {
    return env.JWT_SECRET;
  }
  if (!env.AUTH_USERS_KV) {
    return null;
  }
  try {
    const existing = await env.AUTH_USERS_KV.get(KV_JWT_SECRET_KEY);
    if (existing && existing.length >= 32) {
      return existing;
    }
    const generated = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    await env.AUTH_USERS_KV.put(KV_JWT_SECRET_KEY, generated);
    return generated;
  } catch {
    return null;
  }
}

export async function hasAnyConfiguredUsers(env: Env): Promise<boolean> {
  if (parseUsersJson(env.AUTH_USERS_JSON).length > 0) {
    return true;
  }
  if (!env.AUTH_USERS_KV) {
    return false;
  }
  try {
    const flag = await env.AUTH_USERS_KV.get(KV_INITIALIZED_KEY);
    if (flag === 'true') {
      return true;
    }
    const listRaw = await env.AUTH_USERS_KV.get(KV_USERS_LIST_KEY);
    if (listRaw) {
      const parsed = JSON.parse(listRaw) as unknown;
      return Array.isArray(parsed) && parsed.length > 0;
    }
    return false;
  } catch {
    return false;
  }
}

export async function getAuthSystemStatus(env: Env): Promise<AuthSystemStatus> {
  const initialized = await hasAnyConfiguredUsers(env);
  return {
    initialized,
    canSelfSetup: !initialized && Boolean(env.AUTH_USERS_KV),
    requiresSetupToken: Boolean(env.SETUP_TOKEN?.trim()),
    teamManagementEnabled: Boolean(env.AUTH_USERS_KV),
  };
}

function validateUserRegistrationInput(
  env: Env,
  input: { username?: string; password?: string; name?: string; bapProject?: string },
): { username: string; password: string; name: string; bapProject: string } {
  const username = String(input.username ?? '').trim().toLowerCase();
  const password = String(input.password ?? '');
  const name = String(input.name ?? '').trim();
  const bapProject = String(input.bapProject ?? env.BAP_PROJECT_CODE ?? 'BAP-2026-01').trim();

  if (!USERNAME_REGEX.test(username)) {
    throw new AuthSetupError(
      400,
      'INVALID_USERNAME',
      'Kullanıcı adı 3–40 karakter uzunluğunda olmalı ve yalnızca küçük harf, rakam, nokta, alt çizgi veya tire içermelidir.',
    );
  }
  if (password.length < 8 || password.length > 128) {
    throw new AuthSetupError(
      400,
      'WEAK_PASSWORD',
      'Parola en az 8 karakter olmalıdır.',
    );
  }
  if (name.length < 2 || name.length > 80) {
    throw new AuthSetupError(
      400,
      'INVALID_NAME',
      'Lütfen geçerli bir Ad Soyad / Unvan girin.',
    );
  }

  return {
    username,
    password,
    name,
    bapProject: bapProject || 'BAP-2026-01',
  };
}

export async function initializeFirstAdminUser(
  env: Env,
  input: {
    username?: string;
    password?: string;
    name?: string;
    bapProject?: string;
    setupToken?: string;
  },
): Promise<PublicUserProfile> {
  if (!env.AUTH_USERS_KV) {
    throw new AuthSetupError(
      400,
      'KV_REQUIRED',
      'Tarayıcı üzerinden ilk kurulum için AUTH_USERS_KV bağlantısı gereklidir.',
    );
  }

  const alreadyInitialized = await hasAnyConfiguredUsers(env);
  if (alreadyInitialized) {
    throw new AuthSetupError(
      403,
      'ALREADY_INITIALIZED',
      'Sistem kurulumu daha önce tamamlanmış. Lütfen mevcut hesabınızla giriş yapın.',
    );
  }

  const requiredSetupToken = env.SETUP_TOKEN?.trim();
  if (requiredSetupToken) {
    const provided = String(input.setupToken ?? '').trim();
    if (!provided || !constantTimeEqualText(provided, requiredSetupToken)) {
      throw new AuthSetupError(
        403,
        'INVALID_SETUP_TOKEN',
        'Kurulum anahtarı geçersiz. Lütfen sistem yöneticisinden aldığınız kurulum anahtarını girin.',
      );
    }
  }

  const clean = validateUserRegistrationInput(env, input);
  const { hashHex, saltHex, iterations } = await hashPasswordPbkdf2(clean.password);
  const storedRecord: StoredUserRecord = {
    username: clean.username,
    passwordHash: hashHex,
    salt: saltHex,
    iterations,
    name: clean.name,
    role: 'principal_investigator',
    bapProject: clean.bapProject,
  };
  const publicProfile: PublicUserProfile = {
    username: storedRecord.username,
    name: storedRecord.name,
    role: storedRecord.role,
    bapProject: storedRecord.bapProject,
  };

  await getEffectiveJwtSecret(env);
  await env.AUTH_USERS_KV.put(`user:${storedRecord.username}`, JSON.stringify(storedRecord));
  await env.AUTH_USERS_KV.put(KV_USERS_LIST_KEY, JSON.stringify([publicProfile]));
  await env.AUTH_USERS_KV.put(KV_INITIALIZED_KEY, 'true');

  return publicProfile;
}

export async function listTeamMembers(env: Env): Promise<PublicUserProfile[]> {
  const byUsername = new Map<string, PublicUserProfile>();

  for (const envUser of parseUsersJson(env.AUTH_USERS_JSON)) {
    byUsername.set(envUser.username.trim().toLowerCase(), {
      username: envUser.username.trim().toLowerCase(),
      name: envUser.name,
      role: envUser.role,
      bapProject: envUser.bapProject,
    });
  }

  if (env.AUTH_USERS_KV) {
    try {
      const raw = await env.AUTH_USERS_KV.get(KV_USERS_LIST_KEY);
      if (raw) {
        const list = JSON.parse(raw) as PublicUserProfile[];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && typeof item.username === 'string') {
              byUsername.set(item.username.toLowerCase(), item);
            }
          }
        }
      }
    } catch {
      /* ignore KV parse failure */
    }
  }

  return Array.from(byUsername.values());
}

const ALLOWED_TEAM_ROLES = new Set(['co_researcher', 'research_assistant', 'principal_investigator']);

export async function createTeamMemberUser(
  env: Env,
  actorRole: string,
  input: {
    username?: string;
    password?: string;
    name?: string;
    role?: string;
    bapProject?: string;
  },
): Promise<PublicUserProfile> {
  if (actorRole !== 'principal_investigator') {
    throw new AuthSetupError(
      403,
      'FORBIDDEN',
      'Ekip üyesi ekleme yetkisi yalnızca Proje Yürütücüsüne (principal_investigator) aittir.',
    );
  }
  if (!env.AUTH_USERS_KV) {
    throw new AuthSetupError(
      400,
      'KV_REQUIRED',
      'Ekip üyesi yönetimi için AUTH_USERS_KV bağlantısı gereklidir.',
    );
  }

  const clean = validateUserRegistrationInput(env, input);
  const existing = await findUserRecord(env, clean.username);
  if (existing) {
    throw new AuthSetupError(
      409,
      'USER_EXISTS',
      `"${clean.username}" kullanıcı adı zaten kayıtlı.`,
    );
  }

  const requestedRole = String(input.role ?? 'co_researcher').trim();
  const safeRole = ALLOWED_TEAM_ROLES.has(requestedRole) ? requestedRole : 'co_researcher';
  const { hashHex, saltHex, iterations } = await hashPasswordPbkdf2(clean.password);
  const storedRecord: StoredUserRecord = {
    username: clean.username,
    passwordHash: hashHex,
    salt: saltHex,
    iterations,
    name: clean.name,
    role: safeRole,
    bapProject: clean.bapProject,
  };
  const publicProfile: PublicUserProfile = {
    username: storedRecord.username,
    name: storedRecord.name,
    role: storedRecord.role,
    bapProject: storedRecord.bapProject,
  };

  await env.AUTH_USERS_KV.put(`user:${storedRecord.username}`, JSON.stringify(storedRecord));
  const currentList = await listTeamMembers(env);
  const updatedList = [
    ...currentList.filter((m) => m.username !== publicProfile.username),
    publicProfile,
  ];
  await env.AUTH_USERS_KV.put(KV_USERS_LIST_KEY, JSON.stringify(updatedList));
  await env.AUTH_USERS_KV.put(KV_INITIALIZED_KEY, 'true');

  return publicProfile;
}

export async function findUserRecord(env: Env, username: string): Promise<StoredUserRecord | null> {
  const normalized = username.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (env.AUTH_USERS_KV) {
    try {
      const kvRaw = await env.AUTH_USERS_KV.get(`user:${normalized}`);
      if (kvRaw) {
        const parsed = JSON.parse(kvRaw) as Partial<StoredUserRecord>;
        if (typeof parsed.passwordHash === 'string' && typeof parsed.salt === 'string') {
          return {
            username: (parsed.username ?? normalized).toLowerCase(),
            passwordHash: parsed.passwordHash,
            salt: parsed.salt,
            iterations: parsed.iterations,
            name: parsed.name ?? normalized,
            role: parsed.role ?? 'researcher',
            bapProject: parsed.bapProject ?? env.BAP_PROJECT_CODE ?? 'BAP-GENEL',
          };
        }
      }
    } catch {
      /* KV lookup failed: fall back to environment config */
    }
  }

  const users = parseUsersJson(env.AUTH_USERS_JSON);
  return users.find((u) => u.username.trim().toLowerCase() === normalized) ?? null;
}

export async function verifyUserCredentials(
  env: Env,
  username: string,
  password: string,
): Promise<PublicUserProfile | null> {
  const record = await findUserRecord(env, username);
  if (!record || !password) {
    await hashPasswordPbkdf2(password || 'invalid-password', DUMMY_SALT_HEX, PBKDF2_ITERATIONS);
    constantTimeEqualHex(DUMMY_HASH_HEX, DUMMY_HASH_HEX);
    return null;
  }

  const iterations = record.iterations ?? PBKDF2_ITERATIONS;
  const computed = await hashPasswordPbkdf2(password, record.salt, iterations);
  const matched = constantTimeEqualHex(computed.hashHex, record.passwordHash);
  if (!matched) {
    return null;
  }

  return {
    username: record.username,
    name: record.name,
    role: record.role,
    bapProject: record.bapProject || env.BAP_PROJECT_CODE || 'BAP-GENEL',
  };
}

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (cfIp) return cfIp;
  const xff = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  return xff || '127.0.0.1';
}

function pruneWindow(timestamps: number[], nowMs: number): number[] {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_SECONDS * 1000;
  return timestamps.filter((t) => t > cutoff);
}

export async function checkLoginRateLimit(
  env: Env,
  clientIp: string,
  nowMs = Date.now(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  let recent = pruneWindow(failedLoginLog.get(clientIp) ?? [], nowMs);
  if (env.AUTH_USERS_KV) {
    try {
      const kvRaw = await env.AUTH_USERS_KV.get(`ratelimit:${clientIp}`);
      if (kvRaw) {
        const kvList = JSON.parse(kvRaw) as number[];
        if (Array.isArray(kvList)) {
          const merged = new Set([...recent, ...pruneWindow(kvList, nowMs)]);
          recent = Array.from(merged).sort((a, b) => a - b);
        }
      }
    } catch {
      /* ignore KV rate-limit errors */
    }
  }
  failedLoginLog.set(clientIp, recent);
  if (recent.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    const oldestRelevant = recent[recent.length - RATE_LIMIT_MAX_ATTEMPTS];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldestRelevant + RATE_LIMIT_WINDOW_SECONDS * 1000 - nowMs) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordLoginFailure(
  env: Env,
  clientIp: string,
  nowMs = Date.now(),
): Promise<void> {
  const recent = pruneWindow(failedLoginLog.get(clientIp) ?? [], nowMs);
  recent.push(nowMs);
  failedLoginLog.set(clientIp, recent);
  if (env.AUTH_USERS_KV) {
    try {
      await env.AUTH_USERS_KV.put(`ratelimit:${clientIp}`, JSON.stringify(recent), {
        expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
      });
    } catch {
      /* ignore KV write failure */
    }
  }
}

export async function clearLoginFailures(env: Env, clientIp: string): Promise<void> {
  failedLoginLog.delete(clientIp);
  if (env.AUTH_USERS_KV) {
    try {
      await env.AUTH_USERS_KV.put(`ratelimit:${clientIp}`, '[]', {
        expirationTtl: 60,
      });
    } catch {
      /* ignore KV write failure */
    }
  }
}

export function resetRateLimiterForTests(): void {
  failedLoginLog.clear();
}

export function isHttpsRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    if (url.protocol === 'https:') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return request.headers.get('X-Forwarded-Proto')?.toLowerCase() === 'https';
}

export function buildSessionCookie(token: string, isSecure: boolean, maxAgeSeconds: number): string {
  const name = isSecure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_DEV;
  const attrs = [
    `${name}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(60, Math.floor(maxAgeSeconds))}`,
  ];
  if (isSecure) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}

export function buildLogoutCookies(isSecure: boolean): string[] {
  const cookies = [`${SESSION_COOKIE_DEV}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`];
  if (isSecure) {
    cookies.push(`${SESSION_COOKIE_SECURE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  }
  return cookies;
}

export function parseCookieHeader(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) {
    return map;
  }
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      map.set(key, val);
    }
  }
  return map;
}

export function extractSessionToken(request: Request): string | null {
  const cookies = parseCookieHeader(request.headers.get('Cookie'));
  return cookies.get(SESSION_COOKIE_SECURE) ?? cookies.get(SESSION_COOKIE_DEV) ?? null;
}

export function getSessionTtlSeconds(env: Env): number {
  const parsed = Number(env.SESSION_TTL_SECONDS);
  if (Number.isFinite(parsed) && parsed >= 300 && parsed <= 7 * 24 * 60 * 60) {
    return Math.floor(parsed);
  }
  return DEFAULT_SESSION_TTL_SECONDS;
}
