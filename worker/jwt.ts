import { JwtSessionPayload } from './types';

export const JWT_ISSUER = 'hypotheca-auth';
export const JWT_AUDIENCE = 'hypotheca-bap';
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlEncodeText(text: string): string {
  return base64UrlEncode(encoder.encode(text));
}

export function base64UrlDecode(b64u: string): Uint8Array {
  if (!b64u || !/^[A-Za-z0-9_-]+$/.test(b64u)) {
    throw new Error('Geçersiz Base64URL biçimi.');
  }
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function base64UrlDecodeText(b64u: string): string {
  return decoder.decode(base64UrlDecode(b64u));
}

async function importHmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET en az ${MIN_SECRET_LENGTH} karakter olmalıdır.`);
  }
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(encoder.encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function signJwt(payload: JwtSessionPayload, secret: string): Promise<string> {
  const headerPart = base64UrlEncodeText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadPart = base64UrlEncodeText(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;
  const key = await importHmacKey(secret, 'sign');
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    toArrayBuffer(encoder.encode(signingInput)),
  );
  const sigPart = base64UrlEncode(new Uint8Array(signatureBuffer));
  return `${signingInput}.${sigPart}`;
}

export async function verifyJwt(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<JwtSessionPayload | null> {
  try {
    if (!token || !secret || secret.length < MIN_SECRET_LENGTH) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [headerPart, payloadPart, sigPart] = parts;
    const header = JSON.parse(base64UrlDecodeText(headerPart)) as Record<string, unknown>;
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') {
      return null;
    }

    const key = await importHmacKey(secret, 'verify');
    const sigBytes = base64UrlDecode(sigPart);
    const signingInput = encoder.encode(`${headerPart}.${payloadPart}`);
    const validSig = await crypto.subtle.verify(
      'HMAC',
      key,
      toArrayBuffer(sigBytes),
      toArrayBuffer(signingInput),
    );
    if (!validSig) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecodeText(payloadPart)) as Partial<JwtSessionPayload>;
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.name !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.bapProject !== 'string' ||
      typeof payload.jti !== 'string' ||
      !payload.jti ||
      payload.iss !== JWT_ISSUER ||
      payload.aud !== JWT_AUDIENCE ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number'
    ) {
      return null;
    }

    if (payload.exp <= nowSeconds || payload.iat > nowSeconds + 60) {
      return null;
    }

    return payload as JwtSessionPayload;
  } catch {
    return null;
  }
}
