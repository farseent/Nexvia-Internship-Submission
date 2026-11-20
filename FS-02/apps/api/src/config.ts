import { sessionCookieName, type ApiEnv } from '@conote/shared';

export type Clock = () => Date;

export interface RateLimitRule {
  max: number;
  timeWindowMs: number;
}

/**
 * Rate-limit rules (docs/API_CONTRACTS.md §1, D25). Values are the initial Phase 2
 * choices recorded in docs/ARCHITECTURE.md §10.4; they are tunable, not measured.
 */
export interface RateLimits {
  /** Per client IP, all authenticated endpoints. */
  general: RateLimitRule;
  /** Per client IP: AUTH-01. */
  register: RateLimitRule;
  /** Per client IP: AUTH-02. */
  login: RateLimitRule;
  /** Per normalized email: AUTH-02 (brute force on one account from many addresses). */
  loginAccount: RateLimitRule;
  /** Per client IP and per user: AUTH-07 and ownership transfer (WS-09). */
  password: RateLimitRule;
  /** Per client IP: invitation preview and accept, which take a bearer token (INV-05, INV-06). */
  invitation: RateLimitRule;
  /** Per client IP: PAGE-10, one collaboration token per connection or reconnection (D22). */
  collabToken: RateLimitRule;
  /** Per client IP: image upload authorization, upload and completion (ASSET-01, -02, -04; D55). */
  assetUpload: RateLimitRule;
}

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

export const DEFAULT_RATE_LIMITS: RateLimits = {
  general: { max: 300, timeWindowMs: MINUTE },
  register: { max: 10, timeWindowMs: 60 * MINUTE },
  login: { max: 20, timeWindowMs: 15 * MINUTE },
  loginAccount: { max: 10, timeWindowMs: 15 * MINUTE },
  password: { max: 5, timeWindowMs: 15 * MINUTE },
  invitation: { max: 20, timeWindowMs: 15 * MINUTE },
  // One token per editor opened and per reconnection (backoff keeps reconnects slow). Strict
  // compared with `general`, but with room for several tabs and for people behind one address.
  collabToken: { max: 120, timeWindowMs: MINUTE },
  assetUpload: { max: 120, timeWindowMs: 15 * MINUTE },
};

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  /** Browser-facing origin of the web app, used to build invitation links (D30). */
  appUrl: string;
  allowedOrigins: string[];
  /** Trusted reverse-proxy addresses; empty = trust none. */
  trustProxy: string[];
  sessionIdleTtlMs: number;
  sessionAbsoluteTtlMs: number;
  cookieName: string;
  secureCookies: boolean;
  rateLimits: RateLimits;
  /** Redis key prefix for rate-limit counters. */
  rateLimitNamespace: string;
  collab: {
    /** Signs collaboration tokens (D22); `undefined` leaves PAGE-10 answering 503. */
    privateKey: CollabPrivateKey | undefined;
    /** Browser-facing WebSocket URL returned to clients. */
    url: string;
  };
}

/** Ed25519 private key as JWK, with the `kid` that collaboration servers select the public key by. */
export interface CollabPrivateKey {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d: string;
  kid: string;
}

export function createApiConfig(
  env: Pick<
    ApiEnv,
    | 'NODE_ENV'
    | 'APP_URL'
    | 'ALLOWED_ORIGINS'
    | 'TRUST_PROXY'
    | 'SESSION_IDLE_TTL_DAYS'
    | 'SESSION_ABSOLUTE_TTL_DAYS'
    | 'COLLAB_JWT_PRIVATE_KEY'
    | 'COLLAB_URL'
  >,
): ApiConfig {
  return {
    nodeEnv: env.NODE_ENV,
    appUrl: env.APP_URL,
    allowedOrigins: env.ALLOWED_ORIGINS,
    trustProxy: env.TRUST_PROXY,
    sessionIdleTtlMs: env.SESSION_IDLE_TTL_DAYS * DAY_MS,
    sessionAbsoluteTtlMs: env.SESSION_ABSOLUTE_TTL_DAYS * DAY_MS,
    cookieName: sessionCookieName(env.NODE_ENV),
    secureCookies: env.NODE_ENV === 'production',
    rateLimits: DEFAULT_RATE_LIMITS,
    rateLimitNamespace: 'conote:rl:',
    collab: { privateKey: env.COLLAB_JWT_PRIVATE_KEY, url: env.COLLAB_URL },
  };
}
