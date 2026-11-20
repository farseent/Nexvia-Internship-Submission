import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDependencies } from '../src/dependencies.js';
import { testConfig } from './helpers.js';
import {
  UNREACHABLE_DATABASE_URL,
  UNREACHABLE_REDIS_URL,
  requireInfraEnv,
} from '../../../tests/helpers.js';

const infra = requireInfraEnv();
const logger = pino({ level: 'silent' });
let app: ReturnType<typeof buildApp> | undefined;

function make(env: { DATABASE_URL: string; REDIS_URL: string }) {
  app = buildApp({
    logger,
    dependencies: createDependencies(
      { ...env, ASSET_STORAGE_DIR: '.data/test-health-assets' },
      logger,
    ),
    config: testConfig(),
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('API readiness against real services', () => {
  it('is ready with real PostgreSQL and Redis', async () => {
    const res = await make(infra).inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ready',
      service: 'api',
      dependencies: { postgres: 'healthy', redis: 'healthy' },
    });
  });

  it('stays ready (200) when Redis is unreachable', async () => {
    const res = await make({ ...infra, REDIS_URL: UNREACHABLE_REDIS_URL }).inject({
      method: 'GET',
      url: '/ready',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dependencies).toEqual({ postgres: 'healthy', redis: 'unavailable' });
  });

  it('returns 503 when PostgreSQL is unreachable, without leaking the URL', async () => {
    const res = await make({ ...infra, DATABASE_URL: UNREACHABLE_DATABASE_URL }).inject({
      method: 'GET',
      url: '/ready',
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().dependencies.postgres).toBe('unavailable');
    expect(res.body).not.toContain('nopass');
  });
});
