import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAST_SEEN_THROTTLE_MS } from '../src/auth/sessions.js';
import { cleanupSessions, SESSION_CLEANUP_GRACE_MS } from '../src/jobs/session-cleanup.js';
import {
  PASSWORD,
  createHarness,
  deleteTestUsers,
  uniqueEmail,
  type Harness,
} from './auth-harness.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

const me = (token: string | undefined) => h.call('GET', '/api/v1/users/me', { token });

describe('session expiry (controlled clock)', () => {
  it('expires after 7 days without activity, to the millisecond', async () => {
    const reg = await h.register();
    h.clock.advance(7 * DAY - 1);
    // Still valid one millisecond before the idle limit. (This request slides the window,
    // so use a second session to test the boundary itself.)
    expect((await me(reg.token)).status).toBe(200);

    const idle = await h.register();
    h.clock.advance(7 * DAY);
    const res = await me(idle.token);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.cleared).toBe(true);
  });

  it('slides the idle window on activity', async () => {
    const reg = await h.register();
    for (let i = 0; i < 4; i += 1) {
      h.clock.advance(6 * DAY); // always inside the 7-day idle window
      expect((await me(reg.token)).status).toBe(200);
    }
  });

  it('ends at the 30-day absolute limit even for a continuously active session', async () => {
    const reg = await h.register();
    const results: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      h.clock.advance(6 * DAY);
      results.push((await me(reg.token)).status);
    }
    // Days 6, 12, 18, 24 are fine; day 30 reaches the absolute expiry.
    expect(results).toEqual([200, 200, 200, 200, 401]);
  });

  it('reports the earlier of idle and absolute expiry', async () => {
    const reg = await h.register();
    const created = h.clock.now.getTime();
    for (let i = 0; i < 4; i += 1) {
      h.clock.advance(6 * DAY); // keep the session active up to day 24
      await me(reg.token);
    }
    h.clock.advance(4 * DAY); // day 28: the idle window would end on day 35, the absolute limit on day 30
    const res = await h.call('GET', '/api/v1/auth/session', { token: reg.token });
    expect(res.status).toBe(200);
    expect(Date.parse(res.body.data.session.expiresAt)).toBe(created + 30 * DAY);
  });

  it('refreshes lastSeenAt at most once per minute', async () => {
    const reg = await h.register();
    const find = () =>
      h.deps.prisma.session.findFirstOrThrow({ where: { user: { id: reg.body.data.user.id } } });
    const created = (await find()).lastSeenAt;

    h.clock.advance(LAST_SEEN_THROTTLE_MS - 1000);
    await me(reg.token);
    expect((await find()).lastSeenAt.getTime()).toBe(created.getTime());

    h.clock.advance(1000);
    await me(reg.token);
    expect((await find()).lastSeenAt.getTime()).toBe(created.getTime() + LAST_SEEN_THROTTLE_MS);
  });

  it('hides expired sessions from the list and cannot revoke them', async () => {
    const email = uniqueEmail();
    const old = await h.register({ email });
    const oldId = (await h.call('GET', '/api/v1/auth/session', { token: old.token })).body.data
      .session.id as string;
    h.clock.advance(8 * DAY);
    const fresh = await h.login(email);

    const list = await h.call('GET', '/api/v1/auth/sessions', { token: fresh.token });
    expect(list.body.data.sessions).toHaveLength(1);
    const res = await h.call('DELETE', `/api/v1/auth/sessions/${oldId}`, { token: fresh.token });
    expect(res.status).toBe(404);
  });

  it('keeps a revoked session invalid even though its timestamps are still in range', async () => {
    const reg = await h.register();
    await h.call('POST', '/api/v1/auth/logout', { token: reg.token });
    h.clock.advance(1000);
    expect((await me(reg.token)).status).toBe(401);
  });
});

describe('session cleanup job', () => {
  it('deletes sessions revoked or expired beyond the grace period and keeps the rest', async () => {
    const email = uniqueEmail();
    const reg = await h.register({ email });
    const userId = reg.body.data.user.id as string;
    const now = h.clock.now;
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const future = new Date(now.getTime() + 5 * DAY);
    const hex = (n: number) => n.toString(16).padStart(64, '0');
    const base = { userId, expiresAt: future, absoluteExpiresAt: future };

    await h.deps.prisma.session.createMany({
      data: [
        { ...base, tokenHash: hex(1), revokedAt: ago(SESSION_CLEANUP_GRACE_MS + MINUTE) }, // delete
        { ...base, tokenHash: hex(2), revokedAt: ago(SESSION_CLEANUP_GRACE_MS - MINUTE) }, // keep
        { ...base, tokenHash: hex(3), expiresAt: ago(SESSION_CLEANUP_GRACE_MS + MINUTE) }, // delete
        { ...base, tokenHash: hex(4), expiresAt: ago(MINUTE) }, // keep (inside grace)
        { ...base, tokenHash: hex(5), absoluteExpiresAt: ago(SESSION_CLEANUP_GRACE_MS + MINUTE) }, // delete
        { ...base, tokenHash: hex(6) }, // active: keep
      ],
    });

    const deleted = await cleanupSessions(h.deps.prisma, now);
    expect(deleted).toBeGreaterThanOrEqual(3);

    const remaining = (
      await h.deps.prisma.session.findMany({ where: { userId }, select: { tokenHash: true } })
    ).map((s) => s.tokenHash);
    expect(remaining).toEqual(expect.arrayContaining([hex(2), hex(4), hex(6)]));
    expect(remaining).not.toContain(hex(1));
    expect(remaining).not.toContain(hex(3));
    expect(remaining).not.toContain(hex(5));
    // The live login session from registration is untouched.
    expect((await me(reg.token)).status).toBe(200);
  });

  it('is idempotent', async () => {
    expect(await cleanupSessions(h.deps.prisma, h.clock.now)).toBeGreaterThanOrEqual(0);
    expect(await cleanupSessions(h.deps.prisma, h.clock.now)).toBe(0);
  });
});

describe('database constraints (docs/DATABASE_SCHEMA.md §5)', () => {
  const insertUser = (email: string, color = '#112233') =>
    h.deps.prisma.$executeRawUnsafe(
      `INSERT INTO users (id, email, "passwordHash", "displayName", "presenceColor", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'x', 'n', $2, now())`,
      email,
      color,
    );

  it('rejects an upper-case email', async () => {
    await expect(insertUser(`UPPER${uniqueEmail()}`.toUpperCase())).rejects.toThrow(
      /users_email_lowercase|violates check/i,
    );
  });

  it('rejects a malformed presence colour', async () => {
    await expect(insertUser(uniqueEmail(), 'blue')).rejects.toThrow(
      /presence_color|violates check/i,
    );
  });

  it('rejects a duplicate email at the database level', async () => {
    const email = uniqueEmail();
    await insertUser(email);
    await expect(insertUser(email)).rejects.toThrow();
  });

  it('refuses to store anything but a SHA-256 hex digest as a token hash', async () => {
    const reg = await h.register();
    const raw = reg.token!; // a raw cookie token must never fit in tokenHash
    await expect(
      h.deps.prisma.session.create({
        data: {
          userId: reg.body.data.user.id,
          tokenHash: raw.padEnd(64, 'x'),
          expiresAt: new Date(),
          absoluteExpiresAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('cascades: deleting a user deletes their sessions', async () => {
    const email = uniqueEmail();
    const reg = await h.register({ email });
    await h.login(email, PASSWORD);
    const userId = reg.body.data.user.id as string;
    expect(await h.deps.prisma.session.count({ where: { userId } })).toBe(2);
    await h.deps.prisma.user.delete({ where: { id: userId } });
    expect(await h.deps.prisma.session.count({ where: { userId } })).toBe(0);
  });
});
