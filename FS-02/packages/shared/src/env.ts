import { z } from 'zod';
import { LOG_LEVELS } from './logging.js';

/**
 * Environment variable names and validation (docs/DEPLOYMENT.md §4).
 * Only variables used by the current phase are validated. Later phases add
 * their variables together with the code that uses them.
 *
 * Validation errors list variable NAMES and reasons only, never the values,
 * because values may be secrets.
 */

const port = (defaultPort: number) =>
  z.coerce.number().int().min(1).max(65535).default(defaultPort);

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must start with postgresql:// or postgres://');

const redisUrl = z
  .string()
  .min(1)
  .refine((v) => /^rediss?:\/\//.test(v), 'must start with redis:// or rediss://');

const httpOrigin = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === v;
    } catch {
      return false;
    }
  }, 'must be an origin such as http://localhost:3000 (no path, no trailing slash)');

const httpUrl = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

const PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const IP_OR_CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

const trustedProxies = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  )
  .refine((entries) => entries.every((e) => PROXY_KEYWORDS.has(e) || IP_OR_CIDR.test(e)), {
    error: 'must be a comma-separated list of IPs, CIDR ranges, loopback, linklocal or uniquelocal',
  });

const wsUrl = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'ws:' || u.protocol === 'wss:';
    } catch {
      return false;
    }
  }, 'must be a ws:// or wss:// URL');

// Strict: a public key list that contains private material (`d`) is a mistake worth failing on,
// and the collaboration server must never be handed a private key.
const ed25519PublicJwk = z.strictObject({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string().min(1),
  kid: z.string().min(1).max(64),
});
const ed25519PrivateJwk = z.strictObject({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string().min(1),
  d: z.string().min(1),
  kid: z.string().min(1).max(64),
});

/** JSON text holding a value that must satisfy `schema`; the error never shows the text. */
const jsonOf = <T extends z.ZodType>(schema: T, description: string) =>
  z.string().transform((text, ctx): z.output<T> => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      ctx.addIssue({ code: 'custom', message: `must be JSON (${description})` });
      return z.NEVER;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: `must be ${description}` });
      return z.NEVER;
    }
    return parsed.data;
  });

const days = (defaultDays: number) => z.coerce.number().int().min(1).max(365).default(defaultDays);

const nodeEnv = z.enum(['development', 'test', 'production']);
const logLevel = z.enum(LOG_LEVELS).default('info');

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    LOG_LEVEL: logLevel,
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    PORT: port(4000),
    APP_URL: httpOrigin,
    ALLOWED_ORIGINS: z.string().optional(),
    /**
     * Addresses of reverse proxies whose `X-Forwarded-For` is trusted: comma-separated
     * IPs, CIDR ranges or the keywords `loopback`, `linklocal`, `uniquelocal`. Empty (the
     * default) trusts none. The client address is the first untrusted entry from the right,
     * so a client-supplied left-most entry is ignored and a direct client cannot spoof it.
     */
    TRUST_PROXY: trustedProxies,
    /** Idle (sliding) session lifetime; docs/DECISIONS.md D5 (7 days). */
    SESSION_IDLE_TTL_DAYS: days(7),
    /** Absolute session lifetime; docs/DECISIONS.md D5 (30 days). */
    SESSION_ABSOLUTE_TTL_DAYS: days(30),
    /**
     * Directory of the local-disk image storage adapter (D55). Relative paths are resolved
     * against the API's working directory. Use a persistent volume; it is not a database.
     */
    ASSET_STORAGE_DIR: z.string().min(1).default('.data/assets'),
    /**
     * Private Ed25519 key (JWK JSON, with `kid`) that signs collaboration tokens (D22). Only the
     * API holds it. Without it `PAGE-10` answers 503 and nobody can open a document live.
     * Generate with `pnpm collab:keys`.
     */
    COLLAB_JWT_PRIVATE_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      jsonOf(ed25519PrivateJwk, 'an Ed25519 private JWK with kid').optional(),
    ),
    /** Browser-facing WebSocket URL of the collaboration server, returned by `PAGE-10`. */
    COLLAB_URL: wsUrl.default('ws://localhost:4100'),
  })
  .transform((env) => ({
    ...env,
    ALLOWED_ORIGINS: parseOriginList(env.ALLOWED_ORIGINS, env.APP_URL),
  }));
export type ApiEnv = z.infer<typeof apiEnvSchema>;

const positiveInt = (defaultValue: number, max = 86_400_000) =>
  z.coerce.number().int().min(1).max(max).default(defaultValue);

export const collabEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    LOG_LEVEL: logLevel,
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    COLLAB_PORT: port(4100),
    /** Web origin; the default of `COLLAB_ALLOWED_ORIGINS`. */
    APP_URL: httpOrigin,
    /** Origins allowed to open a WebSocket (D25), comma-separated; defaults to `APP_URL`. */
    COLLAB_ALLOWED_ORIGINS: z.string().optional(),
    /**
     * Public Ed25519 keys (JWK JSON array, each with `kid`) that verify collaboration tokens
     * (D22). The collaboration server never holds a private key. Several keys allow rotation.
     */
    COLLAB_JWT_PUBLIC_KEYS: jsonOf(
      z.array(ed25519PublicJwk).min(1),
      'a JSON array of Ed25519 public JWKs with kid',
    ),
    /** Re-check every open connection against PostgreSQL this often (D22). */
    COLLAB_REVALIDATE_INTERVAL_MS: positiveInt(60_000),
    /** Store debounce (D15); the document is stored this long after the last change. */
    COLLAB_STORE_DEBOUNCE_MS: positiveInt(2_000),
    /** A document that is edited without pause is stored at least this often. */
    COLLAB_STORE_MAX_DEBOUNCE_MS: positiveInt(10_000),
    /** Fold stored updates into the state after this many rows (D15). */
    COLLAB_COMPACT_UPDATE_COUNT: positiveInt(200, 100_000),
    /** Largest WebSocket message accepted (bytes); larger ones close the connection (1009). */
    COLLAB_MAX_PAYLOAD_BYTES: positiveInt(1_048_576, 64 * 1_048_576),
    /** Open connections one user may hold on one instance. */
    COLLAB_MAX_CONNECTIONS_PER_USER: positiveInt(50, 10_000),
    /** Open connections on one instance. */
    COLLAB_MAX_CONNECTIONS: positiveInt(5_000, 1_000_000),
    /** Messages one connection may send per second before it is closed (4429). */
    COLLAB_MAX_MESSAGES_PER_SECOND: positiveInt(100, 100_000),
    /** How long a shutdown waits for stores and closes before it gives up. */
    COLLAB_SHUTDOWN_TIMEOUT_MS: positiveInt(10_000, 600_000),
    /** Awareness messages one connection may send per second; the excess is dropped. */
    COLLAB_MAX_AWARENESS_PER_SECOND: positiveInt(30, 10_000),
    /** Phase 8 (D63): an automatic snapshot is taken at most this often while a page is edited. */
    COLLAB_AUTO_SNAPSHOT_INTERVAL_MS: positiveInt(600_000, 86_400_000),
    /** Automatic snapshots kept per page; older ones are pruned. Manual and pre-restore snapshots are never pruned (U11). */
    COLLAB_AUTO_SNAPSHOT_KEEP: positiveInt(50, 10_000),
    /** A user's edits are logged as `page.edited` at most this often per page (contributors, AC-8.9). */
    COLLAB_EDIT_ACTIVITY_INTERVAL_MS: positiveInt(300_000, 86_400_000),
    /** How long a restore barrier lasts if its holder disappears (D62). */
    COLLAB_RESTORE_BARRIER_TTL_MS: positiveInt(30_000, 600_000),
  })
  .transform((env) => ({
    ...env,
    COLLAB_ALLOWED_ORIGINS: parseOriginList(env.COLLAB_ALLOWED_ORIGINS, env.APP_URL),
  }));
export type CollabEnv = z.infer<typeof collabEnvSchema>;

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  APP_URL: httpOrigin,
  API_INTERNAL_URL: httpUrl,
});
export type WebEnv = z.infer<typeof webEnvSchema>;

/** Migration/Prisma tooling only needs the database URL. */
export const dbEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
});
export type DbEnv = z.infer<typeof dbEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly { variable: string; message: string }[];

  constructor(scope: string, issues: readonly { variable: string; message: string }[]) {
    const lines = issues.map((i) => `  - ${i.variable}: ${i.message}`).join('\n');
    super(`Invalid environment for ${scope}:\n${lines}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validate an environment-like object (e.g. `process.env`) against a schema.
 * Pure: the caller supplies the source. Throws EnvValidationError listing
 * variable names and reasons, never values.
 */
export function parseEnv<S extends z.ZodType>(
  scope: string,
  schema: S,
  source: Record<string, string | undefined>,
): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    variable: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
  throw new EnvValidationError(scope, issues);
}

export function parseOriginList(raw: string | undefined, fallback: string): string[] {
  const source = raw === undefined || raw.trim() === '' ? fallback : raw;
  return source
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
