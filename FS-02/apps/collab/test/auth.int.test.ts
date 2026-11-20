import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Harness, generateKeys, sleep, until, TEST_ORIGIN } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await Harness.start();
});
afterAll(async () => {
  await h.stop();
  await h.cleanup();
});

/** The server must hold no document and no connection for a refused attempt. */
const nothingOpen = () => {
  expect(h.collab.registry.size).toBe(0);
  expect(h.collab.server.hocuspocus.getDocumentsCount()).toBe(0);
};

describe('token verification (WS-AUTH)', () => {
  it('accepts a valid token and syncs', async () => {
    const { owner, pageId } = await h.scene();
    const c = await h.connect(owner, pageId);
    expect(c.synced).toBe(true);
    expect(c.authFailures).toEqual([]);
    await until(() => h.collab.registry.size === 1, 'one connection registered');
    await c.destroy();
    await until(() => h.collab.registry.size === 0, 'connection cleaned up');
  });

  it.each([
    [
      'signed with another key',
      async (u: Awaited<ReturnType<Harness['user']>>, p: string) =>
        h.token(u, p, { keys: generateKeys(h.keys.privateJwk.kid) }),
    ],
    [
      'unknown kid',
      async (u: Awaited<ReturnType<Harness['user']>>, p: string) =>
        h.token(u, p, { keys: { ...h.keys, privateJwk: { ...h.keys.privateJwk, kid: 'nope' } } }),
    ],
    [
      'no kid',
      async (u: Awaited<ReturnType<Harness['user']>>, p: string) => h.token(u, p, { kid: null }),
    ],
    [
      'expired',
      async (u: Awaited<ReturnType<Harness['user']>>, p: string) => {
        const iat = Math.floor(Date.now() / 1000) - 600;
        return h.token(u, p, { iat, exp: iat + 60 });
      },
    ],
    [
      'wrong audience',
      async (u: Awaited<ReturnType<Harness['user']>>, p: string) =>
        h.token(u, p, { aud: 'someone-else' }),
    ],
    [
      'wrong issuer',
      async (u: Awaited<ReturnType<Harness['user']>>, p: string) =>
        h.token(u, p, { iss: 'someone-else' }),
    ],
    [
      'issued in the future',
      async (u: Awaited<ReturnType<Harness['user']>>, p: string) => {
        const iat = Math.floor(Date.now() / 1000) + 600;
        return h.token(u, p, { iat, exp: iat + 60 });
      },
    ],
    [
      'lifetime of an hour',
      async (u: Awaited<ReturnType<Harness['user']>>, p: string) => {
        const iat = Math.floor(Date.now() / 1000);
        return h.token(u, p, { iat, exp: iat + 3600 });
      },
    ],
    [
      'token for another page',
      async (u: Awaited<ReturnType<Harness['user']>>) => h.token(u, randomUUID()),
    ],
    ['not a JWT', async () => 'definitely.not.ajwt'],
    ['empty', async () => ''],
  ])('refuses a token that is %s', async (_label, make) => {
    const { owner, pageId } = await h.scene();
    const c = await h.connect(owner, pageId, {
      token: () => make(owner, pageId),
      reconnect: false,
    });
    expect(c.synced).toBe(false);
    expect(c.authFailures).toEqual(['AUTH_FAILED']);
    await sleep(60);
    nothingOpen();
    await c.destroy();
  });

  it('refuses an unsigned (alg none) token', async () => {
    const { owner, pageId } = await h.scene();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      iss: 'conote-api',
      aud: 'conote-collab',
      sub: owner.id,
      sid: owner.sessionId,
      pid: pageId,
      jti: randomUUID(),
      iat: now,
      exp: now + 60,
    })}.`;
    const c = await h.connect(owner, pageId, { token, reconnect: false });
    expect(c.authFailures).toEqual(['AUTH_FAILED']);
    nothingOpen();
    await c.destroy();
  });

  it('refuses a document name that is not page:<uuid>', async () => {
    const { owner, pageId } = await h.scene();
    for (const name of ['page:not-a-uuid', pageId, `page:${pageId}/x`, 'other:' + pageId]) {
      const c = await h.connect(owner, pageId, { name, reconnect: false });
      expect(c.authFailures, name).toEqual(['PROTOCOL_VIOLATION']);
      await c.destroy();
    }
    nothingOpen();
  });

  it('refuses a WebSocket upgrade from a foreign origin', async () => {
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(h.url, { headers: { Origin: 'http://evil.example' } });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
      ws.on('error', () => undefined);
    });
    expect(status).toBe(403);
    const ok = await new Promise<number>((resolve) => {
      const ws = new WebSocket(h.url, { headers: { Origin: TEST_ORIGIN } });
      ws.on('open', () => (ws.close(), resolve(101)));
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => undefined);
    });
    expect(ok).toBe(101);
  });
});

describe('authorization from the database (PERM)', () => {
  it('refuses a user who is not a member of the workspace', async () => {
    const { pageId } = await h.scene();
    const stranger = await h.user('stranger');
    const c = await h.connect(stranger, pageId, { reconnect: false });
    expect(c.authFailures).toEqual(['ACCESS_DENIED']);
    expect(c.synced).toBe(false);
    nothingOpen();
    await c.destroy();
  });

  it('refuses a deleted page and a page that does not exist', async () => {
    const { owner, pageId } = await h.scene();
    await h.prisma.page.update({ where: { id: pageId }, data: { deletedAt: new Date() } });
    const c1 = await h.connect(owner, pageId, { reconnect: false });
    expect(c1.authFailures).toEqual(['PAGE_NOT_FOUND']);
    const ghost = randomUUID();
    const c2 = await h.connect(owner, ghost, { reconnect: false });
    expect(c2.authFailures).toEqual(['PAGE_NOT_FOUND']);
    await Promise.all([c1.destroy(), c2.destroy()]);
    nothingOpen();
  });

  it('refuses a revoked, expired or foreign session even with a valid token', async () => {
    const { owner, workspaceId, pageId } = await h.scene();
    const member = await h.user('member');
    await h.member(workspaceId, member, 'EDITOR');

    await h.prisma.session.update({
      where: { id: member.sessionId },
      data: { revokedAt: new Date() },
    });
    const revoked = await h.connect(member, pageId, { reconnect: false });
    expect(revoked.authFailures).toEqual(['AUTH_FAILED']);

    const expired = await h.session(member.id, { expiresAt: new Date(Date.now() - 1000) });
    const c2 = await h.connect({ ...member, sessionId: expired }, pageId, { reconnect: false });
    expect(c2.authFailures).toEqual(['AUTH_FAILED']);

    const absolute = await h.session(member.id, { absoluteExpiresAt: new Date(Date.now() - 1000) });
    const c3 = await h.connect({ ...member, sessionId: absolute }, pageId, { reconnect: false });
    expect(c3.authFailures).toEqual(['AUTH_FAILED']);

    // A token that names someone else's session (sub != session owner).
    const c4 = await h.connect({ ...member, sessionId: owner.sessionId }, pageId, {
      reconnect: false,
    });
    expect(c4.authFailures).toEqual(['AUTH_FAILED']);
    await Promise.all([revoked, c2, c3, c4].map((c) => c.destroy()));
    nothingOpen();
  });

  it('refuses a member whose page permission is NONE, and makes an override read-only', async () => {
    const { owner, workspaceId, pageId } = await h.scene();
    const blocked = await h.user('blocked');
    await h.member(workspaceId, blocked, 'EDITOR');
    await h.prisma.pagePermission.create({
      data: { pageId, userId: blocked.id, role: 'NONE', createdById: owner.id },
    });
    const c = await h.connect(blocked, pageId, { reconnect: false });
    expect(c.authFailures).toEqual(['ACCESS_DENIED']);

    const limited = await h.user('limited');
    await h.member(workspaceId, limited, 'EDITOR');
    await h.prisma.pagePermission.create({
      data: { pageId, userId: limited.id, role: 'VIEWER', createdById: owner.id },
    });
    const lc = await h.connect(limited, pageId);
    expect(lc.synced).toBe(true);
    lc.insert('should not arrive');
    await sleep(300);
    const oc = await h.connect(owner, pageId);
    expect(oc.text).toBe('');
    await Promise.all([c.destroy(), lc.destroy(), oc.destroy()]);
  });

  it('inherits a permission set on a parent page', async () => {
    const { owner, workspaceId, pageId: parent } = await h.scene();
    const child = await h.page(workspaceId, owner, parent);
    const user = await h.user('inherit');
    await h.member(workspaceId, user, 'EDITOR');
    await h.prisma.pagePermission.create({
      data: { pageId: parent, userId: user.id, role: 'NONE', createdById: owner.id },
    });
    const c = await h.connect(user, child, { reconnect: false });
    expect(c.authFailures).toEqual(['ACCESS_DENIED']);
    await c.destroy();
  });
});

describe('viewer and commenter restrictions (RO)', () => {
  it.each(['VIEWER', 'COMMENTER'] as const)(
    '%s sees live edits but cannot change the document',
    async (role) => {
      const { owner, workspaceId, pageId } = await h.scene();
      const reader = await h.user(role.toLowerCase());
      await h.member(workspaceId, reader, role);
      const writer = await h.connect(owner, pageId);
      const ro = await h.connect(reader, pageId);

      writer.insert('from the editor');
      await until(() => ro.text === 'from the editor', 'read-only client sees the live edit');

      ro.insert(' VANDAL');
      await sleep(400);
      expect(writer.text).toBe('from the editor');

      // Not stored either: a fresh client after everyone left sees only the editor's text.
      await until(
        async () => (await h.prisma.documentUpdate.count({ where: { pageId } })) > 0,
        'editor text stored',
      );
      await Promise.all([writer.destroy(), ro.destroy()]);
      await until(() => h.collab.server.hocuspocus.getDocumentsCount() === 0, 'document unloaded');
      const fresh = await h.connect(owner, pageId);
      expect(fresh.text).toBe('from the editor');
      await fresh.destroy();
    },
  );

  it('a read-only client that reconnects cannot push its offline edits either', async () => {
    const { owner, workspaceId, pageId } = await h.scene();
    const reader = await h.user('ro');
    await h.member(workspaceId, reader, 'VIEWER');
    const ro = await h.connect(reader, pageId);
    ro.dropNetwork();
    ro.insert('offline edit');
    await until(() => ro.connections >= 2 && ro.online, 'reconnected', 4000);
    await sleep(400);
    const oc = await h.connect(owner, pageId);
    expect(oc.text).toBe('');
    await Promise.all([ro.destroy(), oc.destroy()]);
  });
});
