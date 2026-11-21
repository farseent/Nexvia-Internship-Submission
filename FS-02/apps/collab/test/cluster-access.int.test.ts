import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sleep, type Harness, type TestClient } from './harness.js';
import { Cluster, eventually } from './cluster-helpers.js';

/**
 * Phase 9, AC-9.5: access changes reach the connection on whichever instance holds it.
 * One access event is published once to Redis; every instance receives it and acts on its own
 * connections. The periodic revalidation of each instance covers a missed event.
 */

let cluster: Cluster;
let a: Harness;
let b: Harness;
beforeAll(async () => {
  cluster = new Cluster();
  a = await cluster.add();
  b = await cluster.add();
});
afterAll(async () => {
  await cluster.close();
});

const revokedWith = (client: TestClient, reason: string) =>
  client.messages.some((m) => m.type === 'access.revoked' && m.payload.reason === reason);

async function scene() {
  const { owner, workspaceId, pageId } = await a.scene();
  const member = await a.user('member');
  await a.member(workspaceId, member, 'EDITOR');
  const bystander = await a.user('bystander');
  await a.member(workspaceId, bystander, 'EDITOR');
  return { owner, member, bystander, workspaceId, pageId };
}

describe('access events across instances (AC-9.5)', () => {
  it('a removed member is cut off on every instance that holds a connection of theirs', async () => {
    const { owner, member, bystander, workspaceId, pageId } = await scene();
    const tabOnA = await a.connect(member, pageId);
    const tabOnB = await b.connect(member, pageId);
    const otherOnB = await b.connect(bystander, pageId);
    const ownerOnA = await a.connect(owner, pageId);
    await a.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: member.id } },
    });
    await a.publish({ type: 'member.removed', userId: member.id, workspaceId });
    await eventually(() => revokedWith(tabOnA, 'MEMBER_REMOVED'), 'tab on instance a told');
    await eventually(() => revokedWith(tabOnB, 'MEMBER_REMOVED'), 'tab on instance b told');
    // Nothing the removed member writes afterwards reaches anyone, on either instance.
    tabOnA.insert('A-BLOCKED ');
    tabOnB.insert('B-BLOCKED ');
    await sleep(500);
    expect(ownerOnA.text).toBe('');
    expect(otherOnB.text).toBe('');
    // The others are not disturbed.
    expect(revokedWith(otherOnB, 'MEMBER_REMOVED')).toBe(false);
    ownerOnA.insert('still works');
    await eventually(() => otherOnB.text === 'still works', 'live sync continues across instances');
  });

  it('a role downgrade makes the connection read-only on the instance that holds it, and its writes reach nobody', async () => {
    const { owner, member, workspaceId, pageId } = await scene();
    const memberOnB = await b.connect(member, pageId);
    const ownerOnA = await a.connect(owner, pageId);
    memberOnB.insert('before ');
    await eventually(() => ownerOnA.text === 'before ', 'editor writes cross instances');
    await a.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: member.id } },
      data: { role: 'VIEWER' },
    });
    await a.publish({ type: 'member.role_changed', userId: member.id, workspaceId });
    await eventually(
      () =>
        memberOnB.messages.some(
          (m) => m.type === 'access.changed' && m.payload.readOnly && m.payload.role === 'VIEWER',
        ),
      'viewer told on instance b',
    );
    memberOnB.insert('BLOCKED ');
    await sleep(500);
    expect(ownerOnA.text).toBe('before ');
    ownerOnA.insert('owner ');
    await eventually(
      () => memberOnB.text.includes('owner'),
      'the viewer still receives live edits across instances',
    );
  });

  it('a deleted page closes its connections on both instances', async () => {
    const { owner, workspaceId, pageId } = await scene();
    const onA = await a.connect(owner, pageId);
    const onB = await b.connect(owner, pageId);
    await a.prisma.page.update({ where: { id: pageId }, data: { deletedAt: new Date() } });
    await a.publish({ type: 'page.access_changed', workspaceId, pageId });
    await eventually(() => revokedWith(onA, 'PAGE_DELETED'), 'told on a');
    await eventually(() => revokedWith(onB, 'PAGE_DELETED'), 'told on b');
  });
});

describe('periodic revalidation on each instance (AC-9.5, no event published)', () => {
  it('each instance cuts off a removed member by itself within its interval', async () => {
    const own = new Cluster();
    const x = await own.add({ config: { revalidateIntervalMs: 150 } });
    const y = await own.add({ config: { revalidateIntervalMs: 150 } });
    try {
      const { owner, workspaceId, pageId } = await x.scene();
      const member = await x.user('member');
      await x.member(workspaceId, member, 'EDITOR');
      const onX = await x.connect(member, pageId);
      const onY = await y.connect(member, pageId);
      // The change is made in the database only: no event is published.
      await x.prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId, userId: member.id } },
      });
      await eventually(() => revokedWith(onX, 'MEMBER_REMOVED'), 'instance x revalidated', 5_000);
      await eventually(() => revokedWith(onY, 'MEMBER_REMOVED'), 'instance y revalidated', 5_000);
      const ownerOnY = await y.connect(owner, pageId);
      expect(ownerOnY.synced).toBe(true);
    } finally {
      await own.close();
    }
  });
});
