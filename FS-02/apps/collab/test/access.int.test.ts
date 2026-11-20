import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Harness, sleep, until, type TestClient } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await Harness.start();
});
afterAll(async () => {
  await h.stop();
  await h.cleanup();
});

async function trio() {
  const { owner, workspaceId, pageId } = await h.scene();
  const member = await h.user('member');
  await h.member(workspaceId, member, 'EDITOR');
  const bystander = await h.user('bystander');
  await h.member(workspaceId, bystander, 'EDITOR');
  const m = await h.connect(member, pageId);
  const b = await h.connect(bystander, pageId);
  const o = await h.connect(owner, pageId);
  return { owner, member, bystander, workspaceId, pageId, m, b, o };
}

const revokedWith = (c: TestClient, reason: string) =>
  c.messages.some((x) => x.type === 'access.revoked' && x.payload.reason === reason);

/** After revocation nothing the client writes may reach anyone. */
async function expectSilenced(revoked: TestClient, others: TestClient[]) {
  revoked.insert('AFTER-REVOCATION');
  await sleep(400);
  for (const c of others) expect(c.text).not.toContain('AFTER-REVOCATION');
}

describe('access events (EVENTS)', () => {
  it("session.revoked closes that user's connection and nobody else's", async () => {
    const { member, pageId, m, b, o } = await trio();
    await h.prisma.session.update({
      where: { id: member.sessionId },
      data: { revokedAt: new Date() },
    });
    await h.publish({ type: 'session.revoked', userId: member.id, sessionId: member.sessionId });
    await until(() => revokedWith(m, 'SESSION_REVOKED'), 'member told');
    await until(
      () => m.closes.some((c) => c.code === 4410),
      'member socket closed with ACCESS_REVOKED',
    );
    await expectSilenced(m, [b, o]);
    expect(b.messages.filter((x) => x.type === 'access.revoked')).toEqual([]);
    b.insert('still works');
    await until(() => o.text.includes('still works'), 'others keep collaborating');
    // A new attempt with a perfectly valid token is refused: the session is gone.
    const again = await h.connect(member, pageId, { reconnect: false });
    expect(again.authFailures).toEqual(['AUTH_FAILED']);
    await Promise.all([m, b, o, again].map((c) => c.destroy()));
  });

  it('member.removed revokes MEMBER_REMOVED', async () => {
    const { member, workspaceId, m, b, o } = await trio();
    await h.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: member.id } },
    });
    await h.publish({ type: 'member.removed', userId: member.id, workspaceId });
    await until(() => revokedWith(m, 'MEMBER_REMOVED'), 'member told');
    await expectSilenced(m, [b, o]);
    await Promise.all([m, b, o].map((c) => c.destroy()));
  });

  it('page deletion revokes PAGE_DELETED for everyone on the page', async () => {
    const { workspaceId, pageId, m, b, o } = await trio();
    await h.prisma.page.update({ where: { id: pageId }, data: { deletedAt: new Date() } });
    await h.publish({ type: 'page.access_changed', workspaceId, pageId });
    await until(() => [m, b, o].every((c) => revokedWith(c, 'PAGE_DELETED')), 'all told');
    await Promise.all([m, b, o].map((c) => c.destroy()));
  });

  it('a page permission of NONE revokes ACCESS_REMOVED', async () => {
    const { owner, member, workspaceId, pageId, m, b, o } = await trio();
    await h.prisma.pagePermission.create({
      data: { pageId, userId: member.id, role: 'NONE', createdById: owner.id },
    });
    await h.publish({ type: 'page.access_changed', workspaceId, pageId, userId: member.id });
    await until(() => revokedWith(m, 'ACCESS_REMOVED'), 'member told');
    expect(b.messages).toEqual([]);
    await Promise.all([m, b, o].map((c) => c.destroy()));
  });

  it('workspace.deleted revokes WORKSPACE_DELETED', async () => {
    const { workspaceId, m, b, o } = await trio();
    await h.prisma.workspace.delete({ where: { id: workspaceId } });
    await h.publish({ type: 'workspace.deleted', workspaceId });
    await until(() => [m, b, o].every((c) => revokedWith(c, 'WORKSPACE_DELETED')), 'all told');
    await Promise.all([m, b, o].map((c) => c.destroy()));
  });

  it('a downgrade to VIEWER makes the live connection read-only, an upgrade restores editing', async () => {
    const { member, workspaceId, m, o } = await trio();
    m.insert('editing ');
    await until(() => o.text === 'editing ', 'editor edit arrives');

    await h.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: member.id } },
      data: { role: 'VIEWER' },
    });
    await h.publish({ type: 'member.role_changed', userId: member.id, workspaceId });
    await until(
      () =>
        m.messages.some(
          (x) => x.type === 'access.changed' && x.payload.readOnly && x.payload.role === 'VIEWER',
        ),
      'told about the downgrade',
    );
    m.insert('BLOCKED ');
    await sleep(400);
    expect(o.text).toBe('editing ');
    // Still receives what others write.
    o.insert('owner-writes ');
    await until(() => m.text.includes('owner-writes'), 'viewer still receives live edits');

    await h.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: member.id } },
      data: { role: 'EDITOR' },
    });
    await h.publish({ type: 'member.role_changed', userId: member.id, workspaceId });
    await until(
      () => m.messages.some((x) => x.type === 'access.changed' && !x.payload.readOnly),
      'told about the upgrade',
    );
    // Protocol rule for clients: after an upgrade, resynchronize. Updates the server dropped
    // while the connection was read-only leave a gap in the client's history, and later updates
    // that depend on them would otherwise wait for ever.
    m.provider.forceSync();
    m.insert('editing-again');
    await until(() => o.text.includes('editing-again'), 'edits flow again');
    await Promise.all([m, o].map((c) => c.destroy()));
  });

  it('ignores events for other workspaces, malformed events and events that are not JSON', async () => {
    const { m, o } = await trio();
    await h.publish({ type: 'member.removed', userId: randomUUID(), workspaceId: randomUUID() });
    await h.publish({ type: 'session.revoked', sessionId: randomUUID() });
    await h.redis.publish('conote:events:access', 'not json');
    await h.redis.publish(
      'conote:events:access',
      JSON.stringify({ v: 1, type: 'unknown', at: 'x' }),
    );
    await h.redis.publish(
      'conote:events:access',
      JSON.stringify({ v: 2, type: 'member.removed', at: 'x' }),
    );
    await sleep(300);
    expect(m.messages).toEqual([]);
    m.insert('fine');
    await until(() => o.text === 'fine', 'collaboration unaffected');
    await Promise.all([m, o].map((c) => c.destroy()));
  });
});

describe('periodic revalidation (REVALIDATE) without any event', () => {
  it('finds a removed member and a downgrade when an event was lost', async () => {
    const { member, bystander, workspaceId, m, b, o } = await trio();
    await h.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: member.id } },
    });
    await h.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: bystander.id } },
      data: { role: 'COMMENTER' },
    });
    await h.collab.revalidation.runOnce();
    expect(revokedWith(m, 'MEMBER_REMOVED')).toBe(true);
    await until(
      () => b.messages.some((x) => x.type === 'access.changed' && x.payload.readOnly),
      'downgrade found',
    );
    expect(o.messages).toEqual([]);
    await Promise.all([m, b, o].map((c) => c.destroy()));
  });

  it('runs on its own timer, and expired sessions are cut off', async () => {
    const local = await Harness.start({ config: { revalidateIntervalMs: 150 } });
    try {
      const { owner, workspaceId, pageId } = await local.scene();
      const member = await local.user('m');
      await local.member(workspaceId, member, 'EDITOR');
      const c = await local.connect(member, pageId);
      await local.prisma.session.update({
        where: { id: member.sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await until(
        () => revokedWith(c, 'SESSION_REVOKED'),
        'timer revalidation closed the connection',
        4000,
      );
      const o = await local.connect(owner, pageId);
      expect(o.synced).toBe(true);
      await Promise.all([c.destroy(), o.destroy()]);
    } finally {
      await local.stop();
      await local.cleanup();
    }
  });

  it('keeps connections as they are when PostgreSQL cannot be reached for the check', async () => {
    const { m, o } = await trio();
    const real = h.prisma.session.findUnique.bind(h.prisma.session);
    (h.prisma.session as { findUnique: unknown }).findUnique = () =>
      Promise.reject(new Error('db down'));
    try {
      const result = await h.collab.access.revalidate(h.collab.registry.snapshot());
      expect(result.failed).toBeGreaterThan(0);
      expect(result.revoked).toBe(0);
    } finally {
      (h.prisma.session as { findUnique: unknown }).findUnique = real;
    }
    m.insert('alive');
    await until(() => o.text === 'alive', 'still connected');
    await Promise.all([m, o].map((c) => c.destroy()));
  });
});
