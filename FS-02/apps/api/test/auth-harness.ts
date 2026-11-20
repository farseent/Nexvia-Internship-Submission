import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Redis } from 'ioredis';
import { pino, type Logger } from 'pino';
import { ACCESS_EVENTS_CHANNEL, type AccessEvent } from '@conote/shared';
import { buildApp } from '../src/app.js';
import type { ApiConfig } from '../src/config.js';
import { createDependencies, type Dependencies } from '../src/dependencies.js';
import { waitUntilReady } from '../src/redis.js';
import { requireInfraEnv } from '../../../tests/helpers.js';
import { TEST_ORIGIN, testConfig } from './helpers.js';

export const EMAIL_DOMAIN = '@auth-test.example';
export const PASSWORD = 'correct horse battery staple';
export const COOKIE_NAME = 'conote_session';

/** Parsed JSON response; deliberately untyped so tests can assert on any shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

export const uniqueEmail = (label = 'user'): string =>
  `${label}-${randomUUID().slice(0, 8)}${EMAIL_DOMAIN}`;

/** A mutable "now" so tests can move through session lifetimes without sleeping. */
export interface TestClock {
  now: Date;
  advance(ms: number): void;
}

export function createTestClock(start = '2026-11-13T00:00:00.000Z'): TestClock {
  const clock: TestClock = {
    now: new Date(start),
    advance(ms) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };
  return clock;
}

export interface Harness {
  app: FastifyInstance;
  deps: Dependencies;
  clock: TestClock;
  config: ApiConfig;
  call: (method: string, url: string, options?: CallOptions) => Promise<Reply>;
  register: (overrides?: Partial<RegisterInput>, options?: CallOptions) => Promise<Reply>;
  login: (email: string, password?: string, options?: CallOptions) => Promise<Reply>;
  close: () => Promise<void>;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface CallOptions {
  body?: unknown;
  /** Raw session token to send as the cookie. */
  token?: string | undefined;
  origin?: string | null;
  contentType?: string | null;
  ip?: string;
  headers?: Record<string, string>;
}

export interface Reply {
  status: number;
  body: Body;
  headers: LightMyRequestResponse['headers'];
  raw: LightMyRequestResponse;
  /** Raw `Set-Cookie` header lines. */
  setCookie: string[];
  /** Session token set by this response, if any. */
  token: string | undefined;
  /** True when this response clears the session cookie. */
  cleared: boolean;
}

export function capture(): { logger: Logger; lines: () => string } {
  const chunks: string[] = [];
  const logger = pino({ level: 'debug' }, { write: (chunk: string) => void chunks.push(chunk) });
  return { logger, lines: () => chunks.join('') };
}

export interface HarnessOptions {
  config?: Partial<ApiConfig>;
  env?: Partial<{ DATABASE_URL: string; REDIS_URL: string; ASSET_STORAGE_DIR: string }>;
  logger?: Logger;
  cookieName?: string;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  // Each harness gets its own image directory, removed again on close.
  const assetDir = mkdtempSync(join(tmpdir(), 'conote-assets-'));
  const infra = { ...requireInfraEnv(), ASSET_STORAGE_DIR: assetDir, ...options.env };
  const logger = options.logger ?? pino({ level: 'silent' });
  const clock = createTestClock();
  const base = createDependencies(infra, logger);
  const deps: Dependencies = { ...base, clock: () => clock.now };
  const config = testConfig(options.config);
  const app = buildApp({ logger, dependencies: deps, config });
  await app.ready();
  if (infra.REDIS_URL === requireInfraEnv().REDIS_URL) await waitUntilReady(deps.redis, 3000);

  const cookieName = options.cookieName ?? config.cookieName;

  const call: Harness['call'] = async (method, url, callOptions = {}) => {
    const headers: Record<string, string> = { ...callOptions.headers };
    const origin = callOptions.origin === undefined ? TEST_ORIGIN : callOptions.origin;
    if (origin !== null) headers['origin'] = origin;
    const contentType =
      callOptions.contentType === undefined ? 'application/json' : callOptions.contentType;
    if (contentType !== null) headers['content-type'] = contentType;
    if (callOptions.token !== undefined) headers['cookie'] = `${cookieName}=${callOptions.token}`;

    const unsafe = method !== 'GET';
    const payload =
      callOptions.body === undefined
        ? unsafe && contentType === 'application/json'
          ? '{}'
          : undefined
        : typeof callOptions.body === 'string' || Buffer.isBuffer(callOptions.body)
          ? callOptions.body
          : JSON.stringify(callOptions.body);

    const raw = await app.inject({
      method: method as 'GET',
      url,
      headers,
      ...(payload === undefined ? {} : { payload }),
      ...(callOptions.ip === undefined ? {} : { remoteAddress: callOptions.ip }),
    });
    const setCookieHeader = raw.headers['set-cookie'];
    const setCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : typeof setCookieHeader === 'string'
        ? [setCookieHeader]
        : [];
    const line = setCookie.find((value) => value.startsWith(`${cookieName}=`));
    const value = line?.split(';')[0]?.slice(cookieName.length + 1);
    const maxAgeZero = line !== undefined && /Max-Age=0/i.test(line);
    return {
      status: raw.statusCode,
      body: (raw.headers['content-type']?.toString().includes('json')
        ? raw.json()
        : undefined) as Body,
      headers: raw.headers,
      raw,
      setCookie,
      token: value === undefined || value === '' || maxAgeZero ? undefined : value,
      cleared: line !== undefined && (value === '' || maxAgeZero),
    };
  };

  return {
    app,
    deps,
    clock,
    config,
    call,
    register: (overrides = {}, callOptions = {}) =>
      call('POST', '/api/v1/auth/register', {
        ...callOptions,
        body: {
          email: uniqueEmail(),
          password: PASSWORD,
          displayName: 'Test User',
          ...overrides,
        },
      }),
    login: (email, password = PASSWORD, callOptions = {}) =>
      call('POST', '/api/v1/auth/login', { ...callOptions, body: { email, password } }),
    close: async () => {
      await app.close();
      rmSync(assetDir, { recursive: true, force: true });
    },
  };
}

/** Remove every user created by tests (sessions cascade). */
export async function deleteTestUsers(deps: Dependencies): Promise<void> {
  // Workspaces first: deleting an owner while their workspace survives would leave it without
  // an owner, which the deferred database trigger rejects at commit (DATABASE_SCHEMA §5).
  await deps.prisma.workspace.deleteMany({
    where: { members: { some: { user: { email: { endsWith: EMAIL_DOMAIN } } } } },
  });
  await deps.prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}

/** Collects `session.revoked` access events from Redis pub/sub. */
export async function subscribeAccessEvents(redisUrl: string): Promise<{
  events: AccessEvent[];
  waitFor: (count: number) => Promise<AccessEvent[]>;
  stop: () => Promise<void>;
}> {
  const subscriber = new Redis(redisUrl);
  const events: AccessEvent[] = [];
  subscriber.on('message', (_channel: string, message: string) => {
    events.push(JSON.parse(message) as AccessEvent);
  });
  await subscriber.subscribe(ACCESS_EVENTS_CHANNEL);
  return {
    events,
    waitFor: async (count) => {
      const deadline = Date.now() + 2000;
      while (events.length < count && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return events;
    },
    stop: async () => {
      subscriber.disconnect();
    },
  };
}
