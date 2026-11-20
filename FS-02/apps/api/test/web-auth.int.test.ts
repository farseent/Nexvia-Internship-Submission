import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@conote/db';
import { resolve } from 'node:path';
import { freePort, requireInfraEnv } from '../../../tests/helpers.js';

const ROOT = resolve(import.meta.dirname, '../../..');

/**
 * End-to-end authentication through the real stack: a real API process behind a real
 * Next.js server, reached only through the same-origin rewrite proxy (D6, validation V7),
 * the way a browser reaches it. Pages are fetched as HTML with redirects left unfollowed.
 * This exercises the server side (rewrites, cookie forwarding, SSR guards, redirects);
 * client-side form behaviour is covered separately in apps/web component tests.
 * Lives in apps/api/test because it needs the API's dependencies (ioredis, @conote/db).
 */
const infra = requireInfraEnv();
const EMAIL_DOMAIN = '@web-e2e.example';
const PASSWORD = 'correct horse battery staple';

interface Proc {
  child: ChildProcess;
  logs: () => string;
}

function spawnProc(command: string[], cwd: string, env: Record<string, string>): Proc {
  const child = spawn(process.execPath, command, {
    cwd,
    env: { PATH: process.env['PATH'] ?? '', NEXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  return { child, logs: () => out };
}

async function waitFor(url: string, proc: Proc, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.child.exitCode !== null) throw new Error(`process exited early:\n${proc.logs()}`);
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}\n${proc.logs()}`);
}

async function stop(proc: Proc | undefined): Promise<void> {
  if (!proc || proc.child.exitCode !== null) return;
  const closed = new Promise<void>((resolve) => proc.child.once('close', () => resolve()));
  proc.child.kill('SIGTERM');
  const timer = setTimeout(() => proc.child.kill('SIGKILL'), 5000);
  await closed;
  clearTimeout(timer);
}

let api: Proc;
let web: Proc;
let origin: string;
const prisma = createPrismaClient(infra.DATABASE_URL);

beforeAll(async () => {
  // Earlier runs may have used up the (per-IP) auth rate limits of the default namespace.
  const redis = new Redis(infra.REDIS_URL);
  const keys = await redis.keys('conote:rl:*');
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();

  const apiPort = await freePort();
  const webPort = await freePort();
  origin = `http://127.0.0.1:${webPort}`;

  api = spawnProc(['--import', 'tsx', 'apps/api/src/main.ts'], ROOT, {
    NODE_ENV: 'development',
    LOG_LEVEL: 'warn',
    PORT: String(apiPort),
    APP_URL: origin,
    // The web tier reaches the API over loopback here, so loopback is the trusted proxy.
    TRUST_PROXY: 'loopback',
    ...infra,
  });
  await waitFor(`http://127.0.0.1:${apiPort}/health`, api, 30_000);

  web = spawnProc(
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(webPort),
    ],
    resolve(ROOT, 'apps/web'),
    {
      APP_URL: origin,
      API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
    },
  );
  await waitFor(`${origin}/health`, web, 90_000);
}, 150_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await prisma.$disconnect();
  await Promise.all([stop(web), stop(api)]);
});

interface Hit {
  status: number;
  headers: Headers;
  text: string;
  setCookies: string[];
}

async function hit(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Hit> {
  const res = await fetch(`${origin}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return {
    status: res.status,
    headers: res.headers,
    text: await res.text(),
    setCookies: res.headers.getSetCookie(),
  };
}

const post = (path: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  hit('POST', path, {
    body,
    ...(cookie ? { cookie } : {}),
    headers: { origin, ...headers },
  });

function cookieFrom(res: Hit): string {
  const line = res.setCookies.find((c) => c.startsWith('conote_session='));
  if (!line) throw new Error(`no session cookie in: ${JSON.stringify(res.setCookies)}`);
  return line.split(';')[0]!;
}

describe('authentication through the Next.js proxy', () => {
  const email = `e2e-${randomUUID().slice(0, 8)}${EMAIL_DOMAIN}`;
  let cookie = '';

  it('redirects an unauthenticated visitor from protected pages to /login', async () => {
    for (const path of ['/', '/profile']) {
      const res = await hit('GET', path);
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get('location')!, origin).pathname).toBe('/login');
    }
    const login = await hit('GET', '/login');
    expect(login.status).toBe(200);
    expect(login.text).toContain('Sign in');
    expect((await hit('GET', '/register')).status).toBe(200);
  }, 90_000);

  it('registers through the proxy: Origin, body and Set-Cookie all survive', async () => {
    const res = await post('/api/v1/auth/register', {
      email,
      password: PASSWORD,
      displayName: 'E2E Ada',
    });
    expect(res.status, res.text).toBe(201);
    expect(JSON.parse(res.text).data.user.displayName).toBe('E2E Ada');
    expect(res.text).not.toContain('passwordHash');

    const set = res.setCookies.find((c) => c.startsWith('conote_session='))!;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Path=\//i);
    cookie = cookieFrom(res);
    expect(res.headers.get('cache-control')).toBe('no-store');

    // Measured (V7): the rewrite forwards a client-supplied X-Forwarded-For unchanged and
    // never adds the peer address, so the client IP is only trustworthy behind an outer
    // reverse proxy that sets it. docs/ARCHITECTURE.md §10.4 records this deployment rule.
  }, 60_000);

  it('serves protected pages to a signed-in user and bounces them off /login', async () => {
    const home = await hit('GET', '/', { cookie });
    expect(home.status).toBe(200);
    expect(home.text).toContain('Welcome, E2E Ada');

    const profile = await hit('GET', '/profile', { cookie });
    expect(profile.status).toBe(200);
    expect(profile.text).toContain('Your profile');
    expect(profile.text).toContain(email);

    for (const path of ['/login', '/register']) {
      const res = await hit('GET', path, { cookie });
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get('location')!, origin).pathname).toBe('/');
    }
  }, 60_000);

  it('forwards the cookie on API calls and reflects profile updates in rendered pages', async () => {
    const me = await hit('GET', '/api/v1/users/me', { cookie });
    expect(me.status).toBe(200);

    const patched = await hit('PATCH', '/api/v1/users/me', {
      cookie,
      body: { displayName: 'E2E Grace' },
      headers: { origin },
    });
    expect(patched.status, patched.text).toBe(200);
    expect((await hit('GET', '/', { cookie })).text).toContain('Welcome, E2E Grace');
  }, 60_000);

  it('passes API rejections through unchanged (missing Origin, bad content type, no cookie)', async () => {
    const noOrigin = await hit('POST', '/api/v1/auth/logout', { cookie, body: {} });
    expect(noOrigin.status).toBe(403);
    expect(JSON.parse(noOrigin.text).error.code).toBe('INVALID_ORIGIN');

    const wrongType = await hit('POST', '/api/v1/auth/logout', {
      cookie,
      body: {},
      headers: { origin, 'content-type': 'text/plain' },
    });
    expect(wrongType.status).toBe(415);

    const anonymous = await hit('GET', '/api/v1/users/me');
    expect(anonymous.status).toBe(401);
    expect(JSON.parse(anonymous.text).error.code).toBe('UNAUTHENTICATED');

    // The session survived all of the rejected attempts.
    expect((await hit('GET', '/api/v1/users/me', { cookie })).status).toBe(200);
  }, 60_000);

  it('rejects bad credentials with 401 and passes rate-limit headers through on 429', async () => {
    const bad = await post('/api/v1/auth/login', { email, password: 'wrong password here' });
    expect(bad.status).toBe(401);
    expect(bad.setCookies).toEqual([]);

    // Per-account limit (10 / 15 min) trips regardless of address.
    let limited: Hit | undefined;
    for (let i = 0; i < 12 && limited === undefined; i += 1) {
      const res = await post('/api/v1/auth/login', { email, password: 'wrong password here' });
      if (res.status === 429) limited = res;
    }
    expect(limited, 'expected a 429 within 12 attempts').toBeDefined();
    expect(JSON.parse(limited!.text).error.code).toBe('RATE_LIMITED');
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 60_000);

  it('logout revokes the session and the cookie stops working everywhere', async () => {
    const out = await post('/api/v1/auth/logout', {}, cookie);
    expect(out.status).toBe(200);
    expect(out.setCookies.some((c) => /^conote_session=;/.test(c) || /Max-Age=0/i.test(c))).toBe(
      true,
    );

    const profile = await hit('GET', '/profile', { cookie });
    expect(profile.status).toBe(307);
    expect(new URL(profile.headers.get('location')!, origin).pathname).toBe('/login');
    expect((await hit('GET', '/api/v1/users/me', { cookie })).status).toBe(401);
  }, 60_000);
});
