import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { createPrismaClient } from '@conote/db';
import { createApiConfig, DEFAULT_RATE_LIMITS, type ApiConfig } from '../src/config.js';
import type { Dependencies } from '../src/dependencies.js';
import { connectInBackground, createRedisClient } from '../src/redis.js';
import { LocalStorageAdapter } from '../src/storage/local-storage.js';
import { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from '../../../tests/helpers.js';

export const TEST_ORIGIN = 'http://localhost:3000';

/** Limits high enough to never interfere, except in tests that exercise them. */
const RELAXED = { max: 100_000, timeWindowMs: 60_000 };

export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    ...createApiConfig({
      NODE_ENV: 'test',
      APP_URL: TEST_ORIGIN,
      ALLOWED_ORIGINS: [TEST_ORIGIN],
      TRUST_PROXY: [],
      SESSION_IDLE_TTL_DAYS: 7,
      SESSION_ABSOLUTE_TTL_DAYS: 30,
      COLLAB_JWT_PRIVATE_KEY: undefined,
      COLLAB_URL: 'ws://localhost:4100',
    }),
    rateLimits: {
      general: RELAXED,
      register: RELAXED,
      login: RELAXED,
      loginAccount: RELAXED,
      password: RELAXED,
      invitation: RELAXED,
      collabToken: RELAXED,
      assetUpload: RELAXED,
    },
    // A fresh namespace per app keeps rate-limit counters isolated between tests.
    rateLimitNamespace: `conote:rl:test:${randomUUID()}:`,
    ...overrides,
  };
}

export { DEFAULT_RATE_LIMITS };

/**
 * Dependencies whose clients never connect: for tests that only exercise routes which
 * need no database or Redis (health, error mapping, validation).
 */
export function unconnectedDependencies(
  checks: Pick<Dependencies, 'checkPostgres' | 'checkRedis'>,
): Dependencies {
  return {
    prisma: createPrismaClient(UNREACHABLE_DATABASE_URL),
    redis: createRedisClient(UNREACHABLE_REDIS_URL),
    clock: () => new Date(),
    storage: new LocalStorageAdapter(join(tmpdir(), 'conote-unused-assets')),
    ...checks,
    close: async () => {},
  };
}

export const silentLogger = pino({ level: 'silent' });
export { connectInBackground };
