export interface AssetFetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  ASSETS: AssetFetcher;
  JWT_SECRET?: string;
  AUTH_USERS_JSON?: string;
  AUTH_USERS_KV?: KvStore;
  SESSION_TTL_SECONDS?: string;
  BAP_PROJECT_CODE?: string;
  SETUP_TOKEN?: string;
}

export interface StoredUserRecord {
  username: string;
  passwordHash: string;
  salt: string;
  iterations?: number;
  name: string;
  role: string;
  bapProject: string;
}

export interface PublicUserProfile {
  username: string;
  name: string;
  role: string;
  bapProject: string;
}

export interface AuthSystemStatus {
  initialized: boolean;
  canSelfSetup: boolean;
  requiresSetupToken: boolean;
  teamManagementEnabled: boolean;
}

export interface JwtSessionPayload {
  sub: string;
  name: string;
  role: string;
  bapProject: string;
  iat: number;
  exp: number;
  jti: string;
  iss: string;
  aud: string;
}
