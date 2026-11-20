import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { DependencyStatus } from '@conote/shared';
import { AppError } from '@conote/shared';
import { buildApp } from '../src/app.js';
import type { Dependencies } from '../src/dependencies.js';
import { testConfig, unconnectedDependencies } from './helpers.js';

function fakeDeps(postgres: DependencyStatus, redis: DependencyStatus): Dependencies {
  return unconnectedDependencies({
    checkPostgres: async () => postgres,
    checkRedis: async () => redis,
  });
}

const silent = pino({ level: 'silent' });
let current: ReturnType<typeof buildApp> | undefined;

function make(postgres: DependencyStatus, redis: DependencyStatus) {
  current = buildApp({
    logger: silent,
    dependencies: fakeDeps(postgres, redis),
    config: testConfig(),
  });
  return current;
}

afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('GET /health (liveness)', () => {
  it('returns 200 even when every dependency is down', async () => {
    const app = make('unavailable', 'unavailable');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'api' });
  });
});

describe('GET /ready (readiness)', () => {
  it('is ready when postgres and redis are healthy', async () => {
    const res = await make('healthy', 'healthy').inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ready',
      service: 'api',
      dependencies: { postgres: 'healthy', redis: 'healthy' },
    });
  });

  it('stays ready (200) when only redis is down, and reports it', async () => {
    const res = await make('healthy', 'unavailable').inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().dependencies.redis).toBe('unavailable');
  });

  it('returns 503 when postgres is unavailable', async () => {
    const res = await make('unavailable', 'healthy').inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('not_ready');
  });
});

describe('request ids and error handling', () => {
  it('echoes a safe inbound X-Request-Id and generates one otherwise', async () => {
    const app = make('healthy', 'healthy');
    const a = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'client-req-123456' },
    });
    expect(a.headers['x-request-id']).toBe('client-req-123456');

    const b = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'bad id!' },
    });
    expect(b.headers['x-request-id']).not.toBe('bad id!');
    expect(String(b.headers['x-request-id'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the standard envelope for unknown routes', async () => {
    const res = await make('healthy', 'healthy').inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('maps AppError to its status and code', async () => {
    const app = make('healthy', 'healthy');
    app.get('/boom-app', async () => {
      throw new AppError('FORBIDDEN', 'nope');
    });
    const res = await app.inject({ method: 'GET', url: '/boom-app' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'FORBIDDEN', message: 'nope' });
  });

  it('hides internals of unexpected errors', async () => {
    const app = make('healthy', 'healthy');
    app.get('/boom', async () => {
      throw new Error('connection to postgresql://u:topsecret@db failed');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('topsecret');
  });
});
