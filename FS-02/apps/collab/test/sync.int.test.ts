import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DocumentStore } from '@conote/db';
import { ydocToContent } from '@conote/editor/collaboration';
import { Harness, sleep, until, type TestClient } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await Harness.start();
});
afterAll(async () => {
  await h.stop();
  await h.cleanup();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function editors(count: number) {
  const { owner, workspaceId, pageId } = await h.scene();
  const users = [owner];
  for (let i = 1; i < count; i += 1) {
    const u = await h.user(`ed${i}`);
    await h.member(workspaceId, u, 'EDITOR');
    users.push(u);
  }
  return { users, workspaceId, pageId, owner };
}

const isUnloaded = (h2: Harness, pageId: string) => () =>
  !h2.collab.server.hocuspocus.documents.has(`page:${pageId}`);
const storedRows = (pageId: string) => h.prisma.documentUpdate.count({ where: { pageId } });

describe('live synchronization (SYNC)', () => {
  it("two clients see each other's edits in both directions", async () => {
    const { users, pageId } = await editors(2);
    const [a, b] = (await Promise.all(users.map((u) => h.connect(u, pageId)))) as [
      TestClient,
      TestClient,
    ];
    a.insert('hello');
    await until(() => b.text === 'hello', 'b sees a');
    b.insert(' world');
    await until(() => a.text === 'hello world', 'a sees b');
    expect(a.text).toBe(b.text);
    await Promise.all([a.destroy(), b.destroy()]);
  });

  it('a late joiner receives the current state', async () => {
    const { users, pageId } = await editors(2);
    const a = await h.connect(users[0]!, pageId);
    a.insert('already here');
    await sleep(100);
    const b = await h.connect(users[1]!, pageId);
    expect(b.text).toBe('already here');
    await Promise.all([a.destroy(), b.destroy()]);
  });

  it.each([3, 5])('%i simultaneous editors converge after concurrent edits', async (n) => {
    const { users, pageId } = await editors(n);
    const clients = await Promise.all(users.map((u) => h.connect(u, pageId)));
    // Every client types at once, at the start or the end (token boundaries, so no token is
    // split by another client's insert), in several bursts.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 20; round += 1) {
      for (const [i, c] of clients.entries()) {
        c.insert(`<${i}.${round}>`, rnd() < 0.5 ? 0 : c.text.length);
      }
      if (round % 5 === 0) await sleep(5);
    }
    const everything = (c: TestClient) => {
      for (let i = 0; i < n; i += 1) {
        for (let round = 0; round < 20; round += 1)
          if (!c.text.includes(`<${i}.${round}>`)) return false;
      }
      return true;
    };
    await until(
      () => clients.every((c) => everything(c) && c.text === clients[0]!.text),
      'all replicas equal and complete',
      10_000,
    );
    const final = clients[0]!.text;
    for (const c of clients) expect(c.text).toBe(final);
    // Nothing was lost or duplicated: every token is present exactly once.
    for (let i = 0; i < n; i += 1) {
      for (let round = 0; round < 20; round += 1) {
        expect(final.split(`<${i}.${round}>`).length - 1).toBe(1);
      }
    }
    await Promise.all(clients.map((c) => c.destroy()));
  });

  it('keeps documents apart: a client with two pages open sees no cross-talk', async () => {
    const { owner, workspaceId, pageId: p1 } = await h.scene();
    const p2 = await h.page(workspaceId, owner);
    const other = await h.user('other');
    await h.member(workspaceId, other, 'EDITOR');
    const a1 = await h.connect(owner, p1);
    const a2 = await h.connect(owner, p2);
    const b1 = await h.connect(other, p1);
    const b2 = await h.connect(other, p2);
    a1.insert('one');
    a2.insert('two');
    await until(() => b1.text === 'one' && b2.text === 'two', 'each page got its own text');
    expect(a1.text).toBe('one');
    expect(a2.text).toBe('two');
    await Promise.all([a1, a2, b1, b2].map((c) => c.destroy()));
  });

  it("a user who may open page A cannot subscribe to page B on A's token", async () => {
    const { owner, pageId: a } = await h.scene();
    const { pageId: b } = await h.scene(); // someone else's workspace
    const token = await h.token(owner, a);
    const c = await h.connect(owner, b, { token, reconnect: false });
    expect(c.authFailures).toEqual(['AUTH_FAILED']);
    await c.destroy();
  });
});

describe('persistence (PERSIST)', () => {
  it('stores edits after the debounce and rebuilds them for the next session', async () => {
    const { users, pageId } = await editors(1);
    const a = await h.connect(users[0]!, pageId);
    a.insert('durable');
    await until(async () => (await storedRows(pageId)) > 0, 'rows written');
    await a.destroy();
    await until(isUnloaded(h, pageId), 'unloaded');
    const b = await h.connect(users[0]!, pageId);
    expect(b.text).toBe('durable');
    await b.destroy();
  });

  it('does not write when nothing changed (connect, idle, disconnect)', async () => {
    const { users, pageId } = await editors(1);
    const a = await h.connect(users[0]!, pageId);
    a.insert('x');
    await until(() => h.hasStoredData(pageId), 'first write');
    await a.destroy();
    await until(isUnloaded(h, pageId), 'unloaded');
    // Compaction on unload is itself a (wanted) write that may land just after the unload:
    // wait until it has settled, then take the baseline.
    await until(async () => (await storedRows(pageId)) === 0, 'unload compaction settled');
    const snapshot = async () =>
      JSON.stringify(await h.prisma.documentState.findUnique({ where: { pageId } }), (_k, v) =>
        typeof v === 'bigint'
          ? v.toString()
          : v instanceof Uint8Array
            ? Buffer.from(v).toString('base64')
            : v,
      );
    const before = await snapshot();
    for (let i = 0; i < 3; i += 1) {
      const c = await h.connect(users[0]!, pageId);
      await sleep(150);
      await c.destroy();
      await until(isUnloaded(h, pageId), 'unloaded');
      await sleep(150); // room for a compaction, which must find nothing to do
    }
    expect(await storedRows(pageId)).toBe(0);
    // The stored state row is byte-for-byte what it was: nothing was written.
    expect(await snapshot()).toBe(before);
  });

  it('batches a burst of keystrokes into few rows', async () => {
    const { users, pageId } = await editors(1);
    const a = await h.connect(users[0]!, pageId);
    for (let i = 0; i < 60; i += 1) {
      a.insert('k');
      await sleep(3);
    }
    await until(async () => (await storedRows(pageId)) > 0, 'rows written');
    await sleep(500);
    expect(await storedRows(pageId)).toBeLessThan(15);
    await a.destroy();
  });

  it('folds rows into the state after the configured count and on unload', async () => {
    const local = await Harness.start({ config: { compactUpdateCount: 3 } });
    try {
      const { owner, pageId } = await local.scene();
      const c = await local.connect(owner, pageId);
      for (let i = 0; i < 8; i += 1) {
        c.insert(`e${i}`);
        await sleep(120); // longer than the debounce, so each edit is its own row
      }
      await until(
        async () =>
          (await local.prisma.documentState.findUnique({ where: { pageId } }))!.foldedSeq > 0n,
        'compacted by count',
      );
      await c.destroy();
      await until(
        async () => (await local.prisma.documentUpdate.count({ where: { pageId } })) === 0,
        'compacted on unload',
      );
      const again = await local.connect(owner, pageId);
      expect(again.text).toBe('e0e1e2e3e4e5e6e7');
      await again.destroy();
    } finally {
      await local.stop();
      await local.cleanup();
    }
  });

  it('keeps a document in memory and retries when PostgreSQL fails to store', async () => {
    const local = await Harness.start({ persistence: { retryDelayMs: () => 80 } });
    try {
      const { owner, pageId } = await local.scene();
      const real = DocumentStore.prototype.appendDiff;
      let failures = 2;
      vi.spyOn(DocumentStore.prototype, 'appendDiff').mockImplementation(async function (
        this: DocumentStore,
        ...args
      ) {
        if (failures > 0) {
          failures -= 1;
          throw new Error('simulated outage');
        }
        return real.apply(this, args);
      });
      const c = await local.connect(owner, pageId);
      c.insert('survives an outage');
      await until(() => local.collab.persistence.failingDocuments === 1, 'store reported failing');
      expect(await local.prisma.documentUpdate.count({ where: { pageId } })).toBe(0);
      await until(
        async () => (await local.prisma.documentUpdate.count({ where: { pageId } })) > 0,
        'stored after retries',
        8000,
      );
      expect(local.collab.persistence.failingDocuments).toBe(0);
      await c.destroy();
      await until(isUnloaded(local, pageId), 'unloaded');
      const again = await local.connect(owner, pageId);
      expect(again.text).toBe('survives an outage');
      await again.destroy();
    } finally {
      await local.stop();
      await local.cleanup();
    }
  });
});

describe('initial content (SEED)', () => {
  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From the interim store' }] }],
  };

  it('seeds a page from page_contents exactly once, even when several clients open it at once', async () => {
    const { users, pageId } = await editors(4);
    await h.prisma.pageContent.create({
      data: { pageId, content, schemaVersion: 1, revision: 1, updatedById: users[0]!.id },
    });
    const clients = await Promise.all(users.map((u) => h.connect(u, pageId)));
    for (const c of clients) {
      expect(JSON.stringify(ydocToContent(c.doc))).toContain('From the interim store');
      expect(JSON.stringify(ydocToContent(c.doc)).split('From the interim store').length - 1).toBe(
        1,
      );
    }
    await Promise.all(clients.map((c) => c.destroy()));
    await until(isUnloaded(h, pageId), 'unloaded');
    const again = await h.connect(users[0]!, pageId);
    expect(
      JSON.stringify(ydocToContent(again.doc)).split('From the interim store').length - 1,
    ).toBe(1);
    await again.destroy();
  });

  it('refuses to open (and does not blank) a page whose interim content is invalid', async () => {
    const { owner, pageId } = await h.scene();
    await h.prisma.pageContent.create({
      data: {
        pageId,
        content: { type: 'doc', content: [{ type: 'nope' }] },
        schemaVersion: 1,
        revision: 1,
        updatedById: owner.id,
      },
    });
    const c = await h.connect(owner, pageId, { reconnect: false });
    expect(c.synced).toBe(false);
    expect(await h.prisma.documentUpdate.count({ where: { pageId } })).toBe(0);
    expect(await h.prisma.pageContent.count({ where: { pageId } })).toBe(1);
    await c.destroy();
  });
});
