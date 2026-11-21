import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import * as Y from 'yjs';
import { DocumentStore } from '@conote/db';
import { parseRelayedAwareness } from '@conote/shared';
import { requireInfraEnv } from '../../../tests/helpers.js';
import { sleep, type Harness, type TestClient } from './harness.js';
import { Cluster, RedisProxy, eventually, seededRandom, textOf } from './cluster-helpers.js';

/**
 * Phase 9: several collab instances serving one document (AC-9.1, AC-9.2, AC-9.3, AC-9.9).
 * Every instance is a real collab server against the real PostgreSQL and Redis; they share one
 * Redis channel prefix, as instances of one deployment do.
 */

let cluster: Cluster;
let a: Harness;
let b: Harness;
let c: Harness;
beforeAll(async () => {
  cluster = new Cluster();
  a = await cluster.add();
  b = await cluster.add();
  c = await cluster.add();
});
afterAll(async () => {
  await cluster.close();
});

async function editors(count: number) {
  const { owner, workspaceId, pageId } = await a.scene();
  const users = [owner];
  for (let i = 1; i < count; i += 1) {
    const user = await a.user(`ed${i}`);
    await a.member(workspaceId, user, 'EDITOR');
    users.push(user);
  }
  return { users, workspaceId, pageId };
}

const storedText = async (pageId: string): Promise<string> => {
  const doc = new Y.Doc();
  await new DocumentStore(a.prisma).load(pageId, doc);
  return textOf(doc);
};

describe('updates propagate across instances (AC-9.1)', () => {
  it('two clients on different instances see each other in both directions', async () => {
    const { users, pageId } = await editors(2);
    const x = await a.connect(users[0]!, pageId);
    const y = await b.connect(users[1]!, pageId);
    x.insert('hello');
    await eventually(() => y.text === 'hello', 'y sees x');
    y.insert(' world');
    await eventually(() => x.text === 'hello world', 'x sees y');
    expect(x.text).toBe(y.text);
  });

  it('a client that joins another instance later receives the current state', async () => {
    const { users, pageId } = await editors(2);
    const x = await a.connect(users[0]!, pageId);
    x.insert('already here');
    const y = await c.connect(users[1]!, pageId);
    await eventually(() => y.text === 'already here', 'late joiner on instance c');
  });

  it('a document opened on a second instance gets changes the first has not stored yet', async () => {
    // A long debounce keeps the change out of PostgreSQL; only the peer handshake can deliver it.
    const slow = new Cluster();
    const s1 = await slow.add({ config: { storeDebounceMs: 30_000, storeMaxDebounceMs: 30_000 } });
    const s2 = await slow.add({ config: { storeDebounceMs: 30_000, storeMaxDebounceMs: 30_000 } });
    try {
      const { owner, pageId } = await s1.scene();
      const x = await s1.connect(owner, pageId);
      x.insert('only in memory');
      expect(await s1.hasStoredData(pageId)).toBe(false);
      const y = await s2.connect(owner, pageId);
      expect(y.text).toBe('only in memory');
    } finally {
      await slow.close();
    }
  });

  it('three instances converge under seeded random concurrent edits, and PostgreSQL agrees', async () => {
    const seed = 20261121;
    const random = seededRandom(seed);
    const { users, pageId } = await editors(6);
    const instances = [a, b, c];
    const clients: TestClient[] = [];
    for (const [i, user] of users.entries()) {
      clients.push(await instances[i % 3]!.connect(user, pageId));
    }
    for (let step = 0; step < 150; step += 1) {
      const client = clients[Math.floor(random() * clients.length)]!;
      const text = client.doc.getText('t');
      if (text.length > 20 && random() < 0.25) {
        text.delete(Math.floor(random() * (text.length - 3)), 1 + Math.floor(random() * 3));
      } else {
        const letters = 'abcdefghij'.repeat(1);
        client.insert(
          letters[Math.floor(random() * letters.length)]!.repeat(1 + Math.floor(random() * 4)),
          Math.floor(random() * (text.length + 1)),
        );
      }
      if (step % 10 === 0) await sleep(Math.floor(random() * 20));
    }
    await eventually(
      () =>
        clients.every((client) => client.text === clients[0]!.text) && clients[0]!.text.length > 0,
      `all six clients converge (seed ${seed})`,
      15_000,
    );
    const expected = clients[0]!.text;
    await eventually(
      async () => (await storedText(pageId)) === expected,
      'PostgreSQL holds the converged text',
    );
    // Every client's Yjs state vector is identical, not only its text.
    const vectors = clients.map((client) =>
      Buffer.from(Y.encodeStateVector(client.doc)).toString('hex'),
    );
    expect(new Set(vectors).size).toBe(1);
  });
});

describe('presence across instances (AC-9.2)', () => {
  it('shows the identity and cursor of a person on another instance, and removes it on leaving', async () => {
    const { users, pageId } = await editors(2);
    const x = await a.connect(users[0]!, pageId);
    const y = await b.connect(users[1]!, pageId);
    x.provider.setAwarenessField('cursor', { anchor: null, head: null });
    const seenBy = (observer: TestClient, subject: TestClient) =>
      observer.provider.awareness?.getStates().get(subject.doc.clientID);
    await eventually(() => seenBy(y, x) !== undefined, 'y sees x presence');
    const relayed = parseRelayedAwareness(seenBy(y, x));
    expect(relayed?.user.id).toBe(users[0]!.id);
    expect(relayed?.user.name).toBe(users[0]!.name);
    await x.destroy();
    await eventually(() => seenBy(y, x) === undefined, 'y no longer sees x after x left', 10_000);
  });

  it('a client on a new instance sees the people who were already there', async () => {
    const { users, pageId } = await editors(3);
    const x = await a.connect(users[0]!, pageId);
    const y = await b.connect(users[1]!, pageId);
    const z = await c.connect(users[2]!, pageId);
    await eventually(
      () => [x, y].every((peer) => z.provider.awareness?.getStates().has(peer.doc.clientID)),
      'z sees x and y',
    );
  });

  it('a forged identity is still rejected on the instance that relays it', async () => {
    const { users, pageId } = await editors(2);
    const x = await a.connect(users[0]!, pageId);
    const mallory = await b.connect(users[1]!, pageId);
    mallory.provider.setAwarenessField('user', {
      id: users[0]!.id,
      name: 'Forged',
      color: '#000000',
    });
    await sleep(300);
    const state = x.provider.awareness?.getStates().get(mallory.doc.clientID);
    const relayed = parseRelayedAwareness(state);
    expect(relayed === null || relayed?.user.id === users[1]!.id).toBe(true);
    expect(relayed?.user.name).not.toBe('Forged');
  });

  it('presence of a crashed instance expires on the survivors', { timeout: 70_000 }, async () => {
    const crashy = new Cluster();
    const proxy = RedisProxy.fromUrl(requireInfraEnv().REDIS_URL);
    await proxy.start();
    const c1 = await crashy.add({ redisUrl: proxy.url });
    const c2 = await crashy.add();
    try {
      const { owner, workspaceId, pageId } = await c1.scene();
      const other = await c1.user('other');
      await c1.member(workspaceId, other, 'EDITOR');
      const onFirst = await c1.connect(owner, pageId);
      const onSecond = await c2.connect(other, pageId);
      await eventually(
        () => onSecond.provider.awareness?.getStates().has(onFirst.doc.clientID) === true,
        'survivor sees the person on the instance that will crash',
      );
      // kill -9: the process vanishes, so it cannot tell Redis that its people left.
      proxy.sever();
      await c1.crash();
      // y-protocols drops a remote state that was not renewed for 30 s.
      const waited = await eventually(
        () => onSecond.provider.awareness?.getStates().has(onFirst.doc.clientID) !== true,
        'the survivor forgets the crashed instance’s presence',
        45_000,
        250,
      );
      expect(waited).toBeGreaterThan(20_000);
      expect(waited).toBeLessThan(45_000);
    } finally {
      await crashy.close();
      await proxy.stop();
    }
  });
});

describe('no message loops and no duplicate processing (AC-9.9)', () => {
  it('one edit produces a bounded number of Redis messages that stops once the instances agree', async () => {
    // Own cluster: its channel prefix is unique, so the counter sees only this test's traffic
    // and not the presence renewals of documents that earlier tests left open.
    const group = new Cluster();
    const first = await group.add();
    const second = await group.add();
    const third = await group.add();
    const counter = new Redis(requireInfraEnv().REDIS_URL);
    try {
      const { owner, workspaceId, pageId } = await first.scene();
      const users = [owner];
      for (const name of ['ed1', 'ed2']) {
        const user = await first.user(name);
        await first.member(workspaceId, user, 'EDITOR');
        users.push(user);
      }
      const clients = [
        await first.connect(users[0]!, pageId),
        await second.connect(users[1]!, pageId),
        await third.connect(users[2]!, pageId),
      ];
      await sleep(300);
      let messages = 0;
      // Document channels (`<prefix>:<name>`) and the per-instance reply channels (`<prefix>#reply:<id>`).
      await counter.psubscribe(`${group.prefix}:*`, `${group.prefix}#reply:*`);
      counter.on('pmessageBuffer', () => (messages += 1));

      clients[0]!.insert('x');
      await eventually(() => clients.every((client) => client.text === 'x'), 'all instances agree');
      await sleep(500);
      const afterSettling = messages;
      await sleep(1_000);
      // Nothing keeps circulating once everyone has the update (a loop would keep counting).
      expect(messages).toBe(afterSettling);
      // Three instances: the handshake costs a handful of messages per instance, not dozens.
      expect(afterSettling).toBeGreaterThan(0);
      expect(afterSettling).toBeLessThan(40);
    } finally {
      await counter.quit();
      await group.close();
    }
  });

  it('each instance applies an update exactly once: the text has no duplicated content', async () => {
    const { users, pageId } = await editors(3);
    const clients = [
      await a.connect(users[0]!, pageId),
      await b.connect(users[1]!, pageId),
      await c.connect(users[2]!, pageId),
    ];
    for (let i = 0; i < 20; i += 1) clients[i % 3]!.insert(`<${i}>`);
    await eventually(
      () =>
        clients.every((client) => client.text === clients[0]!.text) &&
        clients[0]!.text.length >= 60,
      'converged',
    );
    const text = clients[0]!.text;
    for (let i = 0; i < 20; i += 1) expect(text.split(`<${i}>`).length - 1).toBe(1);
    // The server-side documents of the three instances hold the same single copy.
    for (const instance of [a, b, c]) {
      const document = instance.collab.server.hocuspocus.documents.get(`page:${pageId}`);
      expect(document && textOf(document)).toBe(text);
    }
  });

  it('replicated changes are stored by one write: the other instance finds them already stored', async () => {
    // Own cluster: the shared instances' counters also include stores of other tests' documents.
    const group = new Cluster();
    const first = await group.add();
    const second = await group.add();
    try {
      const { owner, workspaceId, pageId } = await first.scene();
      const peer = await first.user('peer');
      await first.member(workspaceId, peer, 'EDITOR');
      const x = await first.connect(owner, pageId);
      const y = await second.connect(peer, pageId);
      const before = [first, second].map((i) => i.collab.persistence.stats);

      x.insert('stored once');
      await eventually(() => y.text === 'stored once', 'second instance has the change');
      await eventually(
        async () => (await storedText(pageId)) === 'stored once',
        'the text is in PostgreSQL',
      );
      // Both instances run a store: the origin's own and the replicated one.
      await eventually(
        () =>
          [first, second].every((i, n) => i.collab.persistence.stats.stores > before[n]!.stores),
        'both instances ran their store',
      );
      await sleep(400);

      const after = [first, second].map((i) => i.collab.persistence.stats);
      const delta = (key: 'rowsWritten' | 'noopStores' | 'skippedWithoutLock') =>
        after.reduce((sum, s, n) => sum + s[key] - before[n]![key], 0);

      // Exactly one row, written by exactly one instance. Which one wins the page lock is a race.
      expect(await first.prisma.documentUpdate.count({ where: { pageId } })).toBe(1);
      expect(delta('rowsWritten')).toBe(1);
      // The other instance found the change already stored: it skipped or took the lock for nothing.
      expect(delta('noopStores') + delta('skippedWithoutLock')).toBeGreaterThanOrEqual(1);
    } finally {
      await group.close();
    }
  });
});

describe('document durability when an instance fails (AC-9.3)', () => {
  it('a change that only lives on a crashed instance and its peer still reaches PostgreSQL', async () => {
    const group = new Cluster();
    const slowConfig = { storeDebounceMs: 400, storeMaxDebounceMs: 400 };
    const crashing = await group.add({
      config: { ...slowConfig, storeDebounceMs: 60_000, storeMaxDebounceMs: 60_000 },
    });
    const survivor = await group.add({ config: slowConfig });
    try {
      const { owner, workspaceId, pageId } = await crashing.scene();
      const peer = await crashing.user('peer');
      await crashing.member(workspaceId, peer, 'EDITOR');
      const onCrashing = await crashing.connect(owner, pageId);
      const onSurvivor = await survivor.connect(peer, pageId);
      onCrashing.insert('edited on the instance that dies');
      await eventually(() => onSurvivor.text === onCrashing.text, 'survivor has the change');
      expect(await crashing.hasStoredData(pageId)).toBe(false);
      await crashing.crash();
      // Nobody edits on the survivor, yet its replicated store writes the change.
      await eventually(
        async () => (await storedText(pageId)) === 'edited on the instance that dies',
        'the survivor stores the change the dead instance never stored',
        10_000,
      );
    } finally {
      await group.close();
    }
  });

  it('without replicated stores the same crash leaves the change out of PostgreSQL (the gap D65 closes)', async () => {
    const group = new Cluster();
    const crashing = await group.add({
      config: { storeDebounceMs: 60_000, storeMaxDebounceMs: 60_000 },
    });
    const survivor = await group.add({
      config: { storeDebounceMs: 300, storeMaxDebounceMs: 300 },
      cluster: { storeReplicated: false },
    });
    try {
      const { owner, workspaceId, pageId } = await crashing.scene();
      const peer = await crashing.user('peer');
      await crashing.member(workspaceId, peer, 'EDITOR');
      const onCrashing = await crashing.connect(owner, pageId);
      const onSurvivor = await survivor.connect(peer, pageId);
      onCrashing.insert('lost until someone edits');
      await eventually(() => onSurvivor.text === onCrashing.text, 'survivor has the change');
      await crashing.crash();
      await sleep(1_500);
      expect(await survivor.hasStoredData(pageId)).toBe(false);
      // Once a client on the survivor edits, its diff includes the relayed change.
      onSurvivor.insert('!');
      await eventually(
        async () => (await storedText(pageId)).includes('lost until someone edits'),
        'the next local edit stores everything',
      );
    } finally {
      await group.close();
    }
  });

  it('a document rebuilds from PostgreSQL alone after every instance restarted', async () => {
    const group = new Cluster();
    const first = await group.add();
    const second = await group.add();
    const { owner, workspaceId, pageId } = await first.scene();
    const peer = await first.user('peer');
    await first.member(workspaceId, peer, 'EDITOR');
    const x = await first.connect(owner, pageId);
    const y = await second.connect(peer, pageId);
    for (let i = 0; i < 25; i += 1) (i % 2 === 0 ? x : y).insert(`[${i}]`);
    await eventually(() => x.text === y.text && x.text.length >= 75, 'converged');
    const expected = x.text;
    await first.stop();
    await second.stop();
    const fresh = await group.add();
    try {
      const z = await fresh.connect(owner, pageId);
      expect(z.text).toBe(expected);
    } finally {
      await group.close();
    }
  });
});
