import { afterEach, describe, expect, it } from 'vitest';
import { parseRelayedAwareness } from '@conote/shared';
import { Harness, sleep, until, type TestClient } from './harness.js';

/*
 * Presence on the real server (docs/WEBSOCKET_PROTOCOL.md §18, D61, AC-7.3 to AC-7.5): the
 * relayed identity is built by the server, clients cannot speak for or erase each other, and
 * presence is cleaned up and never stored.
 */

const harnesses: Harness[] = [];
afterEach(async () => {
  const all = harnesses.splice(0);
  for (const h of all) await h.stop().catch(() => undefined);
  for (const h of all) await h.cleanup().catch(() => undefined);
});
async function start(config: Parameters<typeof Harness.start>[0] = {}) {
  const h = await Harness.start(config);
  harnesses.push(h);
  return h;
}

const CURSOR = {
  anchor: { item: { client: 11, clock: 2 }, assoc: 0 },
  head: { item: { client: 11, clock: 5 }, assoc: 0 },
};

/** The state `observer` has for `subject`'s awareness client id, as the server relayed it. */
const stateOf = (observer: TestClient, subject: TestClient): Record<string, unknown> | undefined =>
  observer.provider.awareness?.getStates().get(subject.doc.clientID);

/** All awareness states `observer` holds that belong to person `userId`. */
const statesOfUser = (observer: TestClient, userId: string) =>
  [...(observer.provider.awareness?.getStates().values() ?? [])].filter(
    (state) => parseRelayedAwareness(state)?.user.id === userId,
  );

async function scene(h: Harness, roles: ('EDITOR' | 'VIEWER' | 'COMMENTER')[] = ['EDITOR']) {
  const { owner, workspaceId, pageId } = await h.scene();
  const members = [];
  for (const [i, role] of roles.entries()) {
    const user = await h.user(`member${i}`, ['#0E7490', '#B45309', '#BE123C'][i] ?? '#111111');
    await h.member(workspaceId, user, role);
    members.push(user);
  }
  return { owner, members, workspaceId, pageId };
}

describe('presence identity (D61)', () => {
  it("relays each person's name and colour from the database, with the cursor", async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const [bob] = members;
    const a = await h.connect(owner, pageId);
    const b = await h.connect(bob!, pageId);
    a.provider.setAwarenessField('cursor', CURSOR);
    await until(() => stateOf(b, a)?.cursor !== undefined, 'b sees a cursor');
    expect(stateOf(b, a)).toEqual({
      user: { id: owner.id, name: owner.name, color: owner.color.toUpperCase() },
      cursor: CURSOR,
    });
    // The server also tells the first client about the one that joined later.
    await until(() => stateOf(a, b) !== undefined, 'a sees b');
    expect(parseRelayedAwareness(stateOf(a, b))?.user).toMatchObject({
      id: bob!.id,
      name: 'member0',
    });
  });

  it('ignores a forged user id, name and colour (AC-7.3)', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    a.provider.setAwarenessField('user', {
      id: members[0]!.id,
      name: 'Administrator',
      color: '#FF0000',
      email: 'x@example.com',
    });
    a.provider.setAwarenessField('cursor', CURSOR);
    await until(() => stateOf(b, a)?.cursor !== undefined, 'b sees the update');
    const shown = parseRelayedAwareness(stateOf(b, a));
    expect(shown?.user).toEqual({
      id: owner.id,
      name: owner.name,
      color: owner.color.toUpperCase(),
    });
    expect(JSON.stringify(stateOf(b, a))).not.toContain('Administrator');
    expect(JSON.stringify(stateOf(b, a))).not.toContain('x@example.com');
    // Nobody appears as the person a tried to impersonate.
    expect(statesOfUser(b, members[0]!.id)).toHaveLength(0);
  });

  it('drops extra fields and a malformed or oversized cursor, but keeps the person present', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    a.provider.setAwarenessField('cursor', { anchor: { item: { client: -1, clock: 'x' } } });
    a.provider.setAwarenessField('blob', 'x'.repeat(5000));
    await until(() => stateOf(b, a) !== undefined, 'a is present');
    await sleep(150);
    const shown = stateOf(b, a);
    expect(shown?.cursor).toBeUndefined();
    expect(shown?.blob).toBeUndefined();
    expect(parseRelayedAwareness(shown)?.user.id).toBe(owner.id);
    // A good cursor in a state that is too large is dropped too.
    a.provider.setAwarenessField('cursor', CURSOR);
    await sleep(150);
    expect(stateOf(b, a)?.cursor).toBeUndefined();
  });

  it('refuses presence for a client id that belongs to another connection', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h, ['EDITOR', 'EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    const mallory = await h.connect(members[1]!, pageId);
    a.provider.setAwarenessField('cursor', CURSOR);
    await until(() => stateOf(b, a)?.cursor !== undefined, 'b sees a');

    // Mallory publishes under a's client id, with a clock that would win.
    const forged = mallory.provider.awareness!;
    forged.meta.set(a.doc.clientID, { clock: 1000, lastUpdated: Date.now() });
    forged.clientID = a.doc.clientID;
    forged.setLocalState({ cursor: { anchor: CURSOR.head, head: CURSOR.head } });
    await sleep(300);
    expect(stateOf(b, a)).toMatchObject({ user: { id: owner.id }, cursor: CURSOR });
    expect(statesOfUser(b, members[1]!.id).every((s) => s.cursor === undefined)).toBe(true);
  });

  it("cannot erase another person's presence", async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h, ['EDITOR', 'EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    const mallory = await h.connect(members[1]!, pageId);
    await until(() => stateOf(b, a) !== undefined, 'b sees a');

    const forged = mallory.provider.awareness!;
    forged.states.set(a.doc.clientID, {});
    forged.meta.set(a.doc.clientID, { clock: 1000, lastUpdated: Date.now() });
    forged.clientID = a.doc.clientID;
    forged.setLocalState(null); // announces "a is gone"
    await sleep(300);
    expect(stateOf(b, a)).toBeDefined();
    expect(parseRelayedAwareness(stateOf(b, a))?.user.id).toBe(owner.id);
  });

  it('shows a viewer and a commenter like everyone else, though they cannot edit (AC-7.5)', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h, ['VIEWER', 'COMMENTER']);
    const a = await h.connect(owner, pageId);
    const viewer = await h.connect(members[0]!, pageId);
    const commenter = await h.connect(members[1]!, pageId);
    viewer.provider.setAwarenessField('cursor', CURSOR);
    await until(() => stateOf(a, viewer)?.cursor !== undefined, 'a sees the viewer cursor');
    await until(() => stateOf(a, commenter) !== undefined, 'a sees the commenter');
    expect(parseRelayedAwareness(stateOf(a, viewer))?.user.name).toBe('member0');
    // Presence is not a way to write: the viewer's document edit is still refused.
    viewer.insert('viewer text');
    await sleep(300);
    expect(a.text).toBe('');
  });
});

describe('presence cleanup (AC-7.4)', () => {
  it('removes a person who disconnects cleanly', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    await until(() => stateOf(b, a) !== undefined, 'b sees a');
    await a.destroy();
    await until(() => statesOfUser(b, owner.id).length === 0, 'a disappears', 3000);
  });

  it('removes a client whose network was cut', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId, { reconnect: false });
    const b = await h.connect(members[0]!, pageId);
    await until(() => stateOf(b, a) !== undefined, 'b sees a');
    a.dropNetwork();
    await until(() => statesOfUser(b, owner.id).length === 0, 'a disappears', 3000);
  });

  it('removes presence when access is revoked while connected', async () => {
    const h = await start();
    const { owner, members, workspaceId, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId, { reconnect: false });
    await until(() => stateOf(a, b) !== undefined, 'a sees b');
    await h.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: members[0]!.id } },
    });
    await h.publish({ type: 'member.removed', userId: members[0]!.id, workspaceId });
    await until(() => statesOfUser(a, members[0]!.id).length === 0, 'b disappears', 5000);
  });

  it('expires a state that is not renewed, after the y-protocols timeout', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    await until(() => stateOf(b, a) !== undefined, 'b sees a');
    // Simulate 31 s without a renewal by ageing the server's record (a real wait is 30 s).
    const documents = h.collab.server.hocuspocus.documents;
    const document = [...documents.values()][0]!;
    const meta = document.awareness.meta.get(a.doc.clientID)!;
    meta.lastUpdated -= 31_000;
    await until(() => statesOfUser(b, owner.id).length === 0, 'the stale state expires', 6000);
  });

  it('keeps one state per client after a reconnection, and the right one (AC: reconnection)', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    a.provider.setAwarenessField('cursor', CURSOR);
    await until(() => stateOf(b, a)?.cursor !== undefined, 'b sees a');

    a.dropNetwork(); // the provider reconnects by itself, keeping its Yjs client id
    await until(() => a.connections >= 2 && a.online, 'a reconnected', 8000);
    a.provider.setAwarenessField('cursor', { anchor: CURSOR.head, head: CURSOR.head });
    await until(
      () => (stateOf(b, a)?.cursor as typeof CURSOR | undefined)?.anchor.item?.clock === 5,
      'b sees the new cursor',
    );
    await sleep(500); // time for the old connection's cleanup to run, if it were going to hurt
    expect(statesOfUser(b, owner.id)).toHaveLength(1);
    expect(stateOf(b, a)).toBeDefined();
  });

  it('keeps a person visible after a reconnection without any cursor movement', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    await until(() => stateOf(b, a) !== undefined, 'b sees a');
    a.dropNetwork();
    await until(() => a.connections >= 2 && a.online, 'a reconnected', 8000);
    await sleep(600); // the stale connection is closed by now; its cleanup must not remove a
    expect(statesOfUser(b, owner.id)).toHaveLength(1);
    expect(a.closes.length).toBeGreaterThan(0);
  });

  it('shows two tabs of one person as two awareness states of the same user id', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const tab1 = await h.connect(owner, pageId);
    const tab2 = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    await until(() => statesOfUser(b, owner.id).length === 2, 'both tabs are shown');
    await tab1.destroy();
    await until(() => statesOfUser(b, owner.id).length === 1, 'one tab left', 3000);
    expect(stateOf(b, tab2)).toBeDefined();
  });
});

describe('presence is ephemeral and bounded', () => {
  it('never writes presence to PostgreSQL', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    for (let i = 0; i < 20; i += 1) {
      a.provider.setAwarenessField('cursor', {
        anchor: { item: { client: 1, clock: i }, assoc: 0 },
        head: { item: { client: 1, clock: i }, assoc: 0 },
      });
      await sleep(10);
    }
    await until(() => stateOf(b, a)?.cursor !== undefined, 'presence is flowing');
    await sleep(400); // longer than the test store debounce
    expect(await h.hasStoredData(pageId)).toBe(false);
    expect(await h.prisma.documentUpdate.count({ where: { pageId } })).toBe(0);
  });

  it('keeps presence out of the stored document after real edits', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    await h.connect(members[0]!, pageId);
    a.provider.setAwarenessField('cursor', CURSOR);
    a.insert('hello');
    await until(() => h.hasStoredData(pageId), 'the edit is stored');
    const rows = await h.prisma.documentUpdate.findMany({ where: { pageId } });
    const bytes = Buffer.concat(rows.map((row) => Buffer.from(row.update)));
    expect(bytes.includes(Buffer.from(owner.id))).toBe(false);
    expect(bytes.includes(Buffer.from('member0'))).toBe(false);
  });

  it('drops awareness above the per-connection rate without closing the connection', async () => {
    const h = await start({ config: { maxAwarenessPerSecond: 5 } });
    const { owner, members, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    let received = 0;
    b.provider.awareness!.on('update', () => (received += 1));
    for (let i = 0; i < 60; i += 1) {
      a.provider.setAwarenessField('cursor', {
        anchor: { item: { client: 1, clock: i }, assoc: 0 },
        head: { item: { client: 1, clock: i }, assoc: 0 },
      });
    }
    await sleep(600);
    expect(received).toBeLessThan(30);
    expect(a.online).toBe(true);
    expect(a.closes).toHaveLength(0);
    // Edits still work for the flooding connection.
    a.insert('still editing');
    await until(() => b.text === 'still editing', 'edit reaches b');
  });

  it('needs authentication: a refused connection publishes nothing', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h);
    const b = await h.connect(members[0]!, pageId);
    const intruder = await h.connect(owner, pageId, { token: 'not-a-token', reconnect: false });
    intruder.provider.setAwarenessField('cursor', CURSOR);
    await sleep(300);
    expect(intruder.authFailures).toEqual(['AUTH_FAILED']);
    expect(statesOfUser(b, owner.id)).toHaveLength(0);
  });
});
