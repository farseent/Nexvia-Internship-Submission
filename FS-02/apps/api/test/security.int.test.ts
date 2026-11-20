import { afterAll, describe, expect, it } from 'vitest';
import { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from '../../../tests/helpers.js';
import { DEFAULT_RATE_LIMITS } from './helpers.js';
import {
  PASSWORD,
  capture,
  createHarness,
  deleteTestUsers,
  uniqueEmail,
  type Harness,
  type HarnessOptions,
} from './auth-harness.js';

const MINUTE = 60_000;
const RELAXED = { max: 100_000, timeWindowMs: MINUTE };
const open: Harness[] = [];

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const created = await createHarness(options);
  open.push(created);
  return created;
}

afterAll(async () => {
  if (open[0]) await deleteTestUsers(open[0].deps);
  await Promise.all(open.map((h) => h.close()));
});

describe('rate limiting', () => {
  it('limits login attempts per client IP and answers 429 with Retry-After', async () => {
    const h = await harness({
      config: {
        rateLimits: {
          general: RELAXED,
          collabToken: RELAXED,
          assetUpload: RELAXED,
          invitation: RELAXED,
          register: RELAXED,
          password: RELAXED,
          loginAccount: RELAXED,
          login: { max: 3, timeWindowMs: MINUTE },
        },
      },
    });
    const email = uniqueEmail();
    await h.register({ email });

    for (let i = 0; i < 3; i += 1) {
      const res = await h.login(email, 'wrong password here', { ip: '10.1.1.1' });
      expect(res.status).toBe(401);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
    }
    const blocked = await h.login(email, 'wrong password here', { ip: '10.1.1.1' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.token).toBeUndefined();

    // The *correct* password is also refused while limited: no guessing oracle.
    expect((await h.login(email, PASSWORD, { ip: '10.1.1.1' })).status).toBe(429);
    // Another address is unaffected.
    expect((await h.login(email, PASSWORD, { ip: '10.1.1.2' })).status).toBe(200);
  });

  it('limits attempts against one account across many addresses', async () => {
    const h = await harness({
      config: {
        rateLimits: {
          general: RELAXED,
          collabToken: RELAXED,
          assetUpload: RELAXED,
          invitation: RELAXED,
          register: RELAXED,
          password: RELAXED,
          login: RELAXED,
          loginAccount: { max: 3, timeWindowMs: MINUTE },
        },
      },
    });
    const email = uniqueEmail();
    await h.register({ email });

    for (let i = 0; i < 3; i += 1) {
      const res = await h.login(email, 'wrong password here', { ip: `10.2.0.${i + 1}` });
      expect(res.status).toBe(401);
    }
    const blocked = await h.login(email, PASSWORD, { ip: '10.2.0.99' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // A different account from the same fresh address is not affected.
    const other = uniqueEmail();
    await h.register({ email: other });
    expect((await h.login(other, PASSWORD, { ip: '10.2.0.99' })).status).toBe(200);
  });

  it('limits registrations per client IP', async () => {
    const h = await harness({
      config: {
        rateLimits: {
          general: RELAXED,
          collabToken: RELAXED,
          assetUpload: RELAXED,
          invitation: RELAXED,
          login: RELAXED,
          password: RELAXED,
          loginAccount: RELAXED,
          register: { max: 2, timeWindowMs: MINUTE },
        },
      },
    });
    expect((await h.register({}, { ip: '10.3.0.1' })).status).toBe(201);
    expect((await h.register({}, { ip: '10.3.0.1' })).status).toBe(201);
    const blocked = await h.register({}, { ip: '10.3.0.1' });
    expect(blocked.status).toBe(429);
    expect((await h.register({}, { ip: '10.3.0.2' })).status).toBe(201);
  });

  it('limits password-change attempts per user, even with the right password', async () => {
    const h = await harness({
      config: {
        rateLimits: {
          general: RELAXED,
          collabToken: RELAXED,
          assetUpload: RELAXED,
          invitation: RELAXED,
          login: RELAXED,
          register: RELAXED,
          loginAccount: RELAXED,
          password: { max: 2, timeWindowMs: MINUTE },
        },
      },
    });
    const reg = await h.register();
    const attempt = (currentPassword: string, ip: string) =>
      h.call('POST', '/api/v1/auth/password', {
        token: reg.token,
        ip,
        body: { currentPassword, newPassword: 'another long passphrase' },
      });

    // Different IPs: the per-user limit still applies.
    expect((await attempt('wrong one', '10.4.0.1')).status).toBe(401);
    expect((await attempt('wrong two', '10.4.0.2')).status).toBe(401);
    const blocked = await attempt(PASSWORD, '10.4.0.3');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // The blocked request changed nothing.
    expect((await h.login(reg.body.data.user.email, PASSWORD)).status).toBe(200);
  });

  it('applies a general per-IP limit to authenticated endpoints', async () => {
    const h = await harness({
      config: {
        rateLimits: {
          invitation: RELAXED,
          login: RELAXED,
          register: RELAXED,
          password: RELAXED,
          loginAccount: RELAXED,
          general: { max: 3, timeWindowMs: MINUTE },
          collabToken: RELAXED,
          assetUpload: RELAXED,
        },
      },
    });
    const reg = await h.register();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        (await h.call('GET', '/api/v1/users/me', { token: reg.token, ip: '10.5.0.1' })).status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('ships production-sized defaults', () => {
    expect(DEFAULT_RATE_LIMITS.login.max).toBeLessThanOrEqual(20);
    expect(DEFAULT_RATE_LIMITS.loginAccount.max).toBeLessThanOrEqual(10);
    expect(DEFAULT_RATE_LIMITS.register.max).toBeLessThanOrEqual(10);
    expect(DEFAULT_RATE_LIMITS.password.max).toBeLessThanOrEqual(5);
  });
});

describe('dependency failures', () => {
  it('fails closed with 503 when Redis (the rate limiter) is unreachable', async () => {
    const h = await harness({ env: { REDIS_URL: UNREACHABLE_REDIS_URL } });
    const res = await h.login(uniqueEmail(), PASSWORD);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(res.token).toBeUndefined();
    expect(res.raw.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|ioredis|redis:\/\//i);

    const reg = await h.register();
    expect(reg.status).toBe(503);
    expect(
      await h.deps.prisma.user.count({ where: { email: reg.body?.data?.user?.email ?? '' } }),
    ).toBe(0);
    // Liveness does not depend on Redis.
    expect((await h.call('GET', '/health')).status).toBe(200);
  });

  it('answers 503 (not 500) when PostgreSQL is unreachable, without leaking details', async () => {
    const h = await harness({ env: { DATABASE_URL: UNREACHABLE_DATABASE_URL } });
    const res = await h.login(uniqueEmail(), PASSWORD);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.raw.body).not.toMatch(/nopass|127\.0\.0\.1|prisma|P1001/i);
  });
});

describe('client address handling', () => {
  const lastIp = async (h: Harness, userId: string) =>
    (await h.deps.prisma.session.findFirstOrThrow({ where: { userId } })).ipAddress;

  it('records the forwarded client address only when the proxy is trusted', async () => {
    const trusted = await harness({ config: { trustProxy: ['loopback'] } });
    const a = await trusted.register({}, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(await lastIp(trusted, a.body.data.user.id)).toBe('203.0.113.9');

    const untrusting = await harness({ config: { trustProxy: [] } });
    const b = await untrusting.register({}, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(await lastIp(untrusting, b.body.data.user.id)).toBe('127.0.0.1');
  });

  it('ignores a client-supplied left-most X-Forwarded-For entry (rate-limit evasion)', async () => {
    const h = await harness({ config: { trustProxy: ['loopback'] } });
    // The trusted proxy appends the real peer address; the leading entry is attacker input.
    const res = await h.register({}, { headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' } });
    expect(await lastIp(h, res.body.data.user.id)).toBe('203.0.113.9');
  });

  it('does not honour X-Forwarded-For from an untrusted peer, even with a trusted list', async () => {
    const h = await harness({ config: { trustProxy: ['10.0.0.0/8'] } });
    // The test peer is 127.0.0.1, which is not in the trusted list.
    const res = await h.register({}, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(await lastIp(h, res.body.data.user.id)).toBe('127.0.0.1');
  });

  it('truncates an oversized User-Agent instead of failing', async () => {
    const h = await harness();
    const res = await h.register({}, { headers: { 'user-agent': 'U'.repeat(2000) } });
    expect(res.status).toBe(201);
    const row = await h.deps.prisma.session.findFirstOrThrow({
      where: { userId: res.body.data.user.id },
    });
    expect(row.userAgent).toHaveLength(512);
  });
});

describe('production cookie configuration', () => {
  it('uses the __Host- prefix with Secure, Path=/ and no Domain, and clears it identically', async () => {
    const h = await harness({
      config: { nodeEnv: 'production', secureCookies: true, cookieName: '__Host-conote_session' },
    });
    const reg = await h.register();
    const set = reg.setCookie.find((c) => c.startsWith('__Host-conote_session='))!;
    expect(set).toMatch(/; Secure/i);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Path=\//i);
    expect(set).not.toMatch(/Domain=/i);

    const out = await h.call('POST', '/api/v1/auth/logout', { token: reg.token });
    const cleared = out.setCookie.find((c) => c.startsWith('__Host-conote_session='))!;
    expect(cleared).toMatch(/; Secure/i);
    expect(cleared).toMatch(/Path=\//i);
    expect(out.cleared).toBe(true);
  });
});

describe('secrets never reach logs or error bodies', () => {
  it('does not log passwords, session tokens or hashes', async () => {
    const logs = capture();
    const h = await harness({ logger: logs.logger });
    const email = uniqueEmail();
    const SECRET = 'my very secret passphrase 123';
    const reg = await h.register({ email, password: SECRET });
    const login = await h.login(email, SECRET);
    await h.login(email, 'wrong wrong wrong wrong');
    await h.call('PATCH', '/api/v1/users/me', { token: login.token, body: { displayName: '' } });
    await h.call('POST', '/api/v1/auth/password', {
      token: login.token,
      body: { currentPassword: SECRET, newPassword: 'short' },
    });
    await h.call('POST', '/api/v1/auth/logout', { token: reg.token });

    const text = logs.lines();
    expect(text.length).toBeGreaterThan(0);
    for (const secret of [SECRET, 'wrong wrong wrong wrong', reg.token!, login.token!, '$argon2']) {
      expect(text).not.toContain(secret);
    }
    // Nor does the cookie header appear in request logs.
    expect(text).not.toMatch(/conote_session=/);
  });

  it('returns the same error envelope shape for every failure class', async () => {
    const h = await harness();
    const reg = await h.register();
    const failures = [
      await h.call('GET', '/api/v1/users/me'), // 401
      await h.call('GET', '/api/v1/nope', { token: reg.token }), // 404
      await h.call('PATCH', '/api/v1/users/me', { token: reg.token, body: {} }), // 400
      await h.call('POST', '/api/v1/auth/logout', {
        token: reg.token,
        origin: 'https://evil.example',
      }), // 403
      await h.call('POST', '/api/v1/auth/logout', {
        token: reg.token,
        contentType: 'text/plain',
        body: 'x',
      }), // 415
      await h.login(reg.body.data.user.email, 'wrong password here'), // 401
    ];
    expect(failures.map((f) => f.status)).toEqual([401, 404, 400, 403, 415, 401]);
    for (const f of failures) {
      expect(f.body.success).toBe(false);
      expect(Object.keys(f.body.error).sort()).toEqual(
        expect.arrayContaining(['code', 'message', 'requestId']),
      );
      expect(f.body.error.requestId).toBe(f.headers['x-request-id']);
    }
  });
});
