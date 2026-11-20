import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRESENCE_COLORS } from '@conote/shared';
import { requireInfraEnv } from '../../../tests/helpers.js';
import {
  PASSWORD,
  createHarness,
  deleteTestUsers,
  subscribeAccessEvents,
  uniqueEmail,
  type Harness,
} from './auth-harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

const FORBIDDEN_FIELDS = ['passwordHash', 'password_hash', '$argon2'];
function expectNoSecrets(text: string): void {
  for (const needle of FORBIDDEN_FIELDS) expect(text).not.toContain(needle);
}

describe('AUTH-01 registration', () => {
  it('creates the user, a session and a hardened cookie', async () => {
    const email = uniqueEmail('Reg');
    const res = await h.register({ email: `  ${email.toUpperCase()}  `, displayName: '  Ada  ' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email: email.toLowerCase(), // trimmed and lower-cased
      displayName: 'Ada',
      avatarUrl: null,
    });
    expect(PRESENCE_COLORS).toContain(res.body.data.user.presenceColor);
    expect(res.body.data.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expectNoSecrets(res.raw.body);
    expect(res.raw.body).not.toContain(PASSWORD);

    // Cookie attributes (D5, ARCHITECTURE §10.2).
    const cookie = res.setCookie.find((c) => c.startsWith('conote_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('stores an Argon2id hash and only a hash of the session token', async () => {
    const email = uniqueEmail();
    const res = await h.register({ email });
    const user = await h.deps.prisma.user.findUniqueOrThrow({ where: { email } });

    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.email).toBe(email);
    expect(user.lastLoginAt).not.toBeNull();

    const sessions = await h.deps.prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions[0]!.tokenHash).not.toBe(res.token);
    expect(JSON.stringify(sessions)).not.toContain(res.token!);
  });

  it('logs the new user in: the cookie works immediately', async () => {
    const res = await h.register();
    const me = await h.call('GET', '/api/v1/users/me', { token: res.token });
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(res.body.data.user.id);
  });

  it('rejects a duplicate email regardless of case with 409 EMAIL_TAKEN', async () => {
    const email = uniqueEmail();
    expect((await h.register({ email })).status).toBe(201);
    const dup = await h.register({ email: email.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
    expect(dup.token).toBeUndefined();
  });

  it('lets exactly one of two simultaneous registrations for one email win', async () => {
    const email = uniqueEmail();
    const results = await Promise.all([h.register({ email }), h.register({ email })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await h.deps.prisma.user.count({ where: { email } })).toBe(1);
  });

  it.each([
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['overlong email', { email: `${'a'.repeat(250)}@example.com` }, 'email'],
    ['short password', { password: 'short' }, 'password'],
    ['overlong password', { password: 'x'.repeat(129) }, 'password'],
    ['empty display name', { displayName: '   ' }, 'displayName'],
    ['overlong display name', { displayName: 'n'.repeat(81) }, 'displayName'],
  ])('rejects %s with field details', async (_label, overrides, path) => {
    const res = await h.register(overrides);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
    expect(res.token).toBeUndefined();
  });

  it('never echoes the submitted password in an error', async () => {
    const res = await h.register({ password: 'tooshort' });
    expect(res.raw.body).not.toContain('tooshort');
  });

  it('rejects unknown fields and missing fields', async () => {
    const extra = await h.call('POST', '/api/v1/auth/register', {
      body: { email: uniqueEmail(), password: PASSWORD, displayName: 'X', isAdmin: true },
    });
    expect(extra.status).toBe(400);
    const missing = await h.call('POST', '/api/v1/auth/register', {
      body: { email: uniqueEmail() },
    });
    expect(missing.status).toBe(400);
    const malformed = await h.call('POST', '/api/v1/auth/register', { body: '{not json' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an oversized body with 413', async () => {
    const res = await h.call('POST', '/api/v1/auth/register', {
      body: { email: uniqueEmail(), password: PASSWORD, displayName: 'x'.repeat(100_000) },
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('AUTH-02 login', () => {
  it('logs in, issuing a fresh session token each time', async () => {
    const email = uniqueEmail();
    const registered = await h.register({ email });
    const login = await h.login(email.toUpperCase());

    expect(login.status).toBe(200);
    expect(login.body.data.user.email).toBe(email);
    expectNoSecrets(login.raw.body);
    expect(login.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.token).not.toBe(registered.token); // no session fixation / reuse

    const row = await h.deps.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.lastLoginAt).not.toBeNull();
    const me = await h.call('GET', '/api/v1/users/me', { token: login.token });
    expect(me.status).toBe(200);
  });

  it('does not reuse a session token presented with the login request', async () => {
    const email = uniqueEmail();
    const first = await h.register({ email });
    const login = await h.login(email, PASSWORD, { token: first.token });
    expect(login.token).not.toBe(first.token);
  });

  it('rejects a wrong password and an unknown email identically', async () => {
    const email = uniqueEmail();
    await h.register({ email });
    const wrong = await h.login(email, 'definitely wrong password');
    const unknown = await h.login(uniqueEmail('nobody'), PASSWORD);

    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.token).toBeUndefined();
      expect(res.setCookie).toEqual([]);
    }
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('validates the login body', async () => {
    const res = await h.call('POST', '/api/v1/auth/login', { body: { email: 'x', password: '' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('AUTH-03 logout and session invalidation', () => {
  it('revokes the session, clears the cookie and rejects the old token', async () => {
    const reg = await h.register();
    const out = await h.call('POST', '/api/v1/auth/logout', { token: reg.token });

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true, data: null });
    expect(out.cleared).toBe(true);

    const after = await h.call('GET', '/api/v1/users/me', { token: reg.token });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');

    const row = await h.deps.prisma.session.findFirstOrThrow({
      where: { user: { id: reg.body.data.user.id } },
    });
    expect(row.revokedAt).not.toBeNull();
  });

  it('only revokes the calling session; other devices stay signed in', async () => {
    const email = uniqueEmail();
    const a = await h.register({ email });
    const b = await h.login(email);
    await h.call('POST', '/api/v1/auth/logout', { token: a.token });
    expect((await h.call('GET', '/api/v1/users/me', { token: b.token })).status).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await h.call('POST', '/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });

  it('publishes a session.revoked access event', async () => {
    const sub = await subscribeAccessEvents(requireInfraEnv().REDIS_URL);
    try {
      const reg = await h.register();
      await h.call('POST', '/api/v1/auth/logout', { token: reg.token });
      const events = await sub.waitFor(1);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        v: 1,
        type: 'session.revoked',
        userId: reg.body.data.user.id,
      });
      expect(events[0]!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(events)).not.toContain(reg.token!);
    } finally {
      await sub.stop();
    }
  });
});

describe('access control middleware', () => {
  const protectedRoutes: [string, string][] = [
    ['GET', '/api/v1/auth/session'],
    ['GET', '/api/v1/auth/sessions'],
    ['POST', '/api/v1/auth/logout'],
    ['POST', '/api/v1/auth/password'],
    ['DELETE', '/api/v1/auth/sessions/6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11'],
    ['GET', '/api/v1/users/me'],
    ['PATCH', '/api/v1/users/me'],
  ];

  it.each(protectedRoutes)('%s %s rejects a request without a cookie', async (method, url) => {
    const res = await h.call(method, url, { body: {} });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it.each([
    ['malformed token', 'not-a-token'],
    ['well-formed but unknown token', 'A'.repeat(43)],
  ])('rejects a %s and clears the stale cookie', async (_label, token) => {
    const res = await h.call('GET', '/api/v1/users/me', { token });
    expect(res.status).toBe(401);
    expect(res.cleared).toBe(true);
  });

  it('does not accept the token from anywhere but the cookie', async () => {
    const reg = await h.register();
    const viaHeader = await h.call('GET', '/api/v1/users/me', {
      headers: { authorization: `Bearer ${reg.token}` },
    });
    expect(viaHeader.status).toBe(401);
    const viaQuery = await h.call('GET', `/api/v1/users/me?token=${reg.token}`);
    expect(viaQuery.status).toBe(401);
  });

  it('keeps public routes public', async () => {
    expect((await h.call('GET', '/health')).status).toBe(200);
  });
});

describe('AUTH-04 / AUTH-05 / AUTH-06 sessions', () => {
  it('returns the current session', async () => {
    const reg = await h.register();
    const res = await h.call('GET', '/api/v1/auth/session', { token: reg.token });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(reg.body.data.user.id);
    expect(res.body.data.session).toMatchObject({ current: true });
    expectNoSecrets(res.raw.body);
    expect(res.raw.body).not.toContain(reg.token!);
  });

  it('lists only the caller’s live sessions, newest first, marking the current one', async () => {
    const email = uniqueEmail();
    const a = await h.register({ email });
    h.clock.advance(1000);
    const b = await h.login(email, PASSWORD, { headers: { 'user-agent': 'TestBrowser/2' } });
    const other = await h.register();

    const res = await h.call('GET', '/api/v1/auth/sessions', { token: a.token });
    expect(res.status).toBe(200);
    const list = res.body.data.sessions;
    expect(list).toHaveLength(2);
    expect(list[0].userAgent).toBe('TestBrowser/2');
    expect(list.map((s: { current: boolean }) => s.current)).toEqual([false, true]);
    expect(res.raw.body).not.toContain(other.body.data.user.id);
    expect(res.raw.body).not.toMatch(/tokenHash|ipAddress/);
    expect(b.token).toBeTruthy();
  });

  it('revokes another session; that device is signed out, the caller is not', async () => {
    const email = uniqueEmail();
    const a = await h.register({ email });
    const b = await h.login(email);
    const list = await h.call('GET', '/api/v1/auth/sessions', { token: a.token });
    const target = list.body.data.sessions.find((s: { current: boolean }) => !s.current);

    const res = await h.call('DELETE', `/api/v1/auth/sessions/${target.id}`, { token: a.token });
    expect(res.status).toBe(200);
    expect(res.cleared).toBe(false); // not the current session
    expect((await h.call('GET', '/api/v1/users/me', { token: b.token })).status).toBe(401);
    expect((await h.call('GET', '/api/v1/users/me', { token: a.token })).status).toBe(200);

    const again = await h.call('DELETE', `/api/v1/auth/sessions/${target.id}`, { token: a.token });
    expect(again.status).toBe(404);
  });

  it('clears the cookie when the revoked session is the current one', async () => {
    const reg = await h.register();
    const current = await h.call('GET', '/api/v1/auth/session', { token: reg.token });
    const res = await h.call('DELETE', `/api/v1/auth/sessions/${current.body.data.session.id}`, {
      token: reg.token,
    });
    expect(res.status).toBe(200);
    expect(res.cleared).toBe(true);
  });

  it('answers 404 for another user’s session and leaves it intact', async () => {
    const victim = await h.register();
    const attacker = await h.register();
    const victimSession = await h.call('GET', '/api/v1/auth/session', { token: victim.token });

    const res = await h.call(
      'DELETE',
      `/api/v1/auth/sessions/${victimSession.body.data.session.id}`,
      { token: attacker.token },
    );
    expect(res.status).toBe(404);
    expect((await h.call('GET', '/api/v1/users/me', { token: victim.token })).status).toBe(200);
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    const reg = await h.register();
    const unknown = await h.call(
      'DELETE',
      '/api/v1/auth/sessions/6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11',
      {
        token: reg.token,
      },
    );
    expect(unknown.status).toBe(404);
    const bad = await h.call('DELETE', '/api/v1/auth/sessions/not-a-uuid', { token: reg.token });
    expect(bad.status).toBe(400);
  });
});

describe('AUTH-07 change password', () => {
  it('changes the hash, keeps this session and revokes every other one', async () => {
    const email = uniqueEmail();
    const a = await h.register({ email });
    const b = await h.login(email);
    const before = await h.deps.prisma.user.findUniqueOrThrow({ where: { email } });
    h.clock.advance(5000);

    const sub = await subscribeAccessEvents(requireInfraEnv().REDIS_URL);
    try {
      const NEW = 'a brand new passphrase 42';
      const res = await h.call('POST', '/api/v1/auth/password', {
        token: a.token,
        body: { currentPassword: PASSWORD, newPassword: NEW },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: null });

      const after = await h.deps.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(after.passwordHash).not.toBe(before.passwordHash);
      expect(after.passwordHash).toMatch(/^\$argon2id\$/);
      expect(after.passwordChangedAt.getTime()).toBeGreaterThan(before.passwordChangedAt.getTime());

      expect((await h.call('GET', '/api/v1/users/me', { token: a.token })).status).toBe(200);
      expect((await h.call('GET', '/api/v1/users/me', { token: b.token })).status).toBe(401);
      expect((await h.login(email, PASSWORD)).status).toBe(401);
      expect((await h.login(email, NEW)).status).toBe(200);

      const events = await sub.waitFor(1);
      expect(events.some((e) => e.userId === a.body.data.user.id)).toBe(true);
    } finally {
      await sub.stop();
    }
  });

  it('rejects a wrong current password without touching anything', async () => {
    const email = uniqueEmail();
    const a = await h.register({ email });
    const before = await h.deps.prisma.user.findUniqueOrThrow({ where: { email } });
    const res = await h.call('POST', '/api/v1/auth/password', {
      token: a.token,
      body: { currentPassword: 'not my password', newPassword: 'another long passphrase' },
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const after = await h.deps.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect((await h.call('GET', '/api/v1/users/me', { token: a.token })).status).toBe(200);
  });

  it('enforces the password policy on the new password', async () => {
    const a = await h.register();
    const res = await h.call('POST', '/api/v1/auth/password', {
      token: a.token,
      body: { currentPassword: PASSWORD, newPassword: 'short' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('newPassword');
  });
});

describe('USER-01 / USER-02 profile', () => {
  it('returns the profile without secrets', async () => {
    const reg = await h.register({ displayName: 'Grace' });
    const res = await h.call('GET', '/api/v1/users/me', { token: reg.token });
    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBe('Grace');
    expect(Object.keys(res.body.data.user).sort()).toEqual(
      ['avatarUrl', 'createdAt', 'displayName', 'email', 'id', 'presenceColor'].sort(),
    );
    expectNoSecrets(res.raw.body);
  });

  it('updates display name and presence colour, persisting them', async () => {
    const reg = await h.register();
    const res = await h.call('PATCH', '/api/v1/users/me', {
      token: reg.token,
      body: { displayName: '  New Name ', presenceColor: '#0d9488' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ displayName: 'New Name', presenceColor: '#0D9488' });

    const again = await h.call('GET', '/api/v1/users/me', { token: reg.token });
    expect(again.body.data.user).toMatchObject({
      displayName: 'New Name',
      presenceColor: '#0D9488',
    });
  });

  it('allows a partial update', async () => {
    const reg = await h.register({ displayName: 'Keep Me' });
    const res = await h.call('PATCH', '/api/v1/users/me', {
      token: reg.token,
      body: { presenceColor: '#112233' },
    });
    expect(res.body.data.user).toMatchObject({ displayName: 'Keep Me', presenceColor: '#112233' });
  });

  it.each([
    ['empty body', {}],
    ['blank display name', { displayName: '  ' }],
    ['long display name', { displayName: 'x'.repeat(81) }],
    ['bad colour', { presenceColor: 'red' }],
    ['email change', { email: 'someone-else@auth-test.example' }],
    ['password hash', { passwordHash: 'x' }],
    ['id', { id: '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11' }],
    ['avatar (Phase 4)', { avatarAssetId: '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11' }],
  ])('rejects %s', async (_label, body) => {
    const reg = await h.register();
    const res = await h.call('PATCH', '/api/v1/users/me', { token: reg.token, body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const me = await h.call('GET', '/api/v1/users/me', { token: reg.token });
    expect(me.body.data.user.email).toBe(reg.body.data.user.email);
  });

  it('only ever changes the caller’s own profile', async () => {
    const a = await h.register({ displayName: 'Alice' });
    const b = await h.register({ displayName: 'Bob' });
    await h.call('PATCH', '/api/v1/users/me', { token: b.token, body: { displayName: 'Bobby' } });
    const aliceNow = await h.call('GET', '/api/v1/users/me', { token: a.token });
    expect(aliceNow.body.data.user.displayName).toBe('Alice');
  });
});

describe('request integrity (Origin, Content-Type, CORS)', () => {
  it('rejects state-changing requests with a missing or foreign Origin', async () => {
    const reg = await h.register();
    for (const origin of [
      null,
      'https://evil.example',
      'null',
      'http://localhost:3000.evil.example',
    ]) {
      const res = await h.call('POST', '/api/v1/auth/logout', { token: reg.token, origin });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVALID_ORIGIN');
    }
    // The session survived every rejected attempt.
    expect((await h.call('GET', '/api/v1/users/me', { token: reg.token })).status).toBe(200);
  });

  it('rejects a foreign Origin on login and registration too', async () => {
    const res = await h.register({}, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    const login = await h.login(uniqueEmail(), PASSWORD, { origin: 'https://evil.example' });
    expect(login.status).toBe(403);
  });

  it('rejects non-JSON content types with 415', async () => {
    const reg = await h.register();
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', null]) {
      const res = await h.call('POST', '/api/v1/auth/logout', {
        token: reg.token,
        contentType,
        body: 'a=b',
      });
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
    expect((await h.call('GET', '/api/v1/users/me', { token: reg.token })).status).toBe(200);
  });

  it('accepts a charset parameter on the JSON content type', async () => {
    const res = await h.register({}, { contentType: 'application/json; charset=utf-8' });
    expect(res.status).toBe(201);
  });

  it('does not require Origin for safe methods', async () => {
    const reg = await h.register();
    const res = await h.call('GET', '/api/v1/users/me', { token: reg.token, origin: null });
    expect(res.status).toBe(200);
  });

  it('answers CORS preflight only for allow-listed origins, with credentials', async () => {
    const ok = await h.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/users/me',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'PATCH',
      },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const evil = await h.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/users/me',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PATCH' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets standard security headers', async () => {
    const res = await h.call('GET', '/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
