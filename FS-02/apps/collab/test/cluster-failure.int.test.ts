import { afterEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { DocumentStore } from '@conote/db';
import { requireInfraEnv } from '../../../tests/helpers.js';
import { TEST_ORIGIN, sleep, type Harness } from './harness.js';
import { Cluster, RedisProxy, RoundRobinProxy, eventually, textOf } from './cluster-helpers.js';

/**
 * Phase 9: partial infrastructure failure (AC-9.4, AC-9.6, AC-9.8).
 *
 * Redis outages are produced by a TCP proxy between one instance and Redis, so the instance
 * sees exactly what a network failure looks like (connections drop, new ones are refused),
 * while the data in Redis and PostgreSQL stays untouched.
 */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
});

interface Pair {
  cluster: Cluster;
  a: Harness;
  b: Harness;
  proxy: RedisProxy;
  scene: {
    owner: Awaited<ReturnType<Harness['user']>>;
    peer: Awaited<ReturnType<Harness['user']>>;
    pageId: string;
  };
}

/** Instance `a` talks to Redis directly; instance `b` through a proxy that the test can cut. */
async function pair(
  options: { recovery?: boolean; severBeforeStart?: boolean } = {},
): Promise<Pair> {
  const proxy = RedisProxy.fromUrl(requireInfraEnv().REDIS_URL);
  await proxy.start();
  if (options.severBeforeStart) proxy.sever();
  const cluster = new Cluster();
  const a = await cluster.add();
  const b = await cluster.add({
    redisUrl: proxy.url,
    cluster: { resyncOnReconnect: options.recovery ?? true },
  });
  cleanups.push(async () => {
    await cluster.close();
    await proxy.stop();
  });
  const { owner, workspaceId, pageId } = await a.scene();
  const peer = await a.user('peer');
  await a.member(workspaceId, peer, 'EDITOR');
  return { cluster, a, b, proxy, scene: { owner, peer, pageId } };
}

const storedText = async (h: Harness, pageId: string): Promise<string> => {
  const doc = new Y.Doc();
  await new DocumentStore(h.prisma).load(pageId, doc);
  return textOf(doc);
};

describe('Redis outage and recovery (AC-9.4, U13)', () => {
  it('reconnecting alone does not repair a missed update; the recovery procedure does', async () => {
    const { a, b, proxy, scene } = await pair({ recovery: false });
    const onA = await a.connect(scene.owner, scene.pageId);
    const onB = await b.connect(scene.peer, scene.pageId);
    onA.insert('before');
    await eventually(() => onB.text === 'before', 'synchronized while Redis is up');

    proxy.sever();
    await eventually(() => b.collab.cluster.status === 'degraded', 'b notices the outage');
    onA.insert(' + during the outage');

    // Committed: PostgreSQL has the update although Pub/Sub could not carry it.
    await eventually(
      async () => (await storedText(a, scene.pageId)) === 'before + during the outage',
      'the update is committed to PostgreSQL',
    );
    await sleep(600);
    expect(onB.text).toBe('before'); // the cut-off instance missed it

    proxy.restore();
    await eventually(() => b.collab.cluster.status === 'connected', 'ioredis reconnects');
    await sleep(2_000);
    // Redis is back, but Pub/Sub does not replay: nothing told b about the update.
    expect(onB.text).toBe('before');

    // The recovery procedure: PostgreSQL shows b's document lacks committed content.
    await b.collab.cluster.resyncAll('manual');
    await eventually(() => onB.text === 'before + during the outage', 'b converges after recovery');
    expect(b.collab.cluster.stats().staleDocumentsRepaired).toBeGreaterThanOrEqual(1);
  });

  it('recovers by itself when Redis returns, in both directions', async () => {
    const { a, b, proxy, scene } = await pair();
    const onA = await a.connect(scene.owner, scene.pageId);
    const onB = await b.connect(scene.peer, scene.pageId);
    onA.insert('start;');
    await eventually(() => onB.text === 'start;', 'synchronized');

    proxy.sever();
    await eventually(() => b.collab.cluster.status === 'degraded', 'outage noticed');
    // Both sides keep editing; both commit to PostgreSQL; neither sees the other.
    onA.insert('A-edit;');
    onB.insert('B-edit;');
    await eventually(
      async () => (await storedText(a, scene.pageId)).includes('A-edit;'),
      'A committed',
    );
    await eventually(
      async () => (await storedText(a, scene.pageId)).includes('B-edit;'),
      'B committed',
    );
    expect(onA.text).not.toContain('B-edit;');
    expect(onB.text).not.toContain('A-edit;');

    proxy.restore();
    await eventually(
      () => onA.text === onB.text && onA.text.includes('A-edit;') && onA.text.includes('B-edit;'),
      'both instances converge to the union without any manual action',
      15_000,
    );
    const stats = b.collab.cluster.stats();
    expect(stats.outages).toBe(1);
    expect(stats.recoveries).toBe(1);
    // After convergence the two instances keep working together.
    onA.insert('after;');
    await eventually(() => onB.text.includes('after;'), 'live sync resumed');
    // Nothing was lost or doubled.
    await eventually(
      async () => (await storedText(a, scene.pageId)) === onA.text,
      'PostgreSQL agrees',
    );
    for (const token of ['start;', 'A-edit;', 'B-edit;', 'after;']) {
      expect(onA.text.split(token).length - 1).toBe(1);
    }
  });

  it('serves a document that is opened during an outage, then joins the cluster', async () => {
    const { a, b, proxy, scene } = await pair();
    const seed = await a.connect(scene.owner, scene.pageId);
    seed.insert('from PostgreSQL');
    await eventually(() => a.hasStoredData(scene.pageId), 'stored');
    await seed.destroy();
    await eventually(
      () => !a.collab.server.hocuspocus.documents.has(`page:${scene.pageId}`),
      'document unloaded on a',
    );

    proxy.sever();
    await eventually(() => b.collab.cluster.status === 'degraded', 'outage noticed');
    const startedAt = performance.now();
    const onB = await b.connect(scene.peer, scene.pageId);
    expect(performance.now() - startedAt).toBeLessThan(4_000); // bounded, not hung on Redis
    expect(onB.text).toBe('from PostgreSQL');
    expect(b.collab.cluster.stats().pendingSubscriptions).toBe(1);

    proxy.restore();
    await eventually(
      () => b.collab.cluster.stats().pendingSubscriptions === 0,
      'subscribed after recovery',
    );
    const onA = await a.connect(scene.owner, scene.pageId);
    onA.insert('!');
    await eventually(
      () => onB.text === 'from PostgreSQL!',
      'live sync works after the late subscription',
    );
    onB.insert('?');
    await eventually(() => onA.text === 'from PostgreSQL!?', 'and in the other direction');
  });

  it('starts without Redis, serves from PostgreSQL, and joins the cluster when Redis appears', async () => {
    const { a, b, proxy, scene } = await pair({ severBeforeStart: true });
    expect(b.collab.cluster.status).toBe('degraded');
    const onB = await b.connect(scene.peer, scene.pageId);
    onB.insert('written while alone');
    await eventually(() => b.hasStoredData(scene.pageId), 'stored without Redis');

    proxy.restore();
    await eventually(() => b.collab.cluster.status === 'connected', 'connected');
    const onA = await a.connect(scene.owner, scene.pageId);
    await eventually(() => onA.text === 'written while alone', 'a sees what b wrote alone');
    onA.insert(' <- a');
    await eventually(() => onB.text === 'written while alone <- a', 'b sees a');
  });

  it('shuts down cleanly while Redis is unreachable', async () => {
    const { b, proxy, scene } = await pair();
    const onB = await b.connect(scene.peer, scene.pageId);
    onB.insert('x');
    proxy.sever();
    await eventually(() => b.collab.cluster.status === 'degraded', 'outage noticed');
    const startedAt = performance.now();
    await b.stop();
    expect(performance.now() - startedAt).toBeLessThan(5_000);
    expect(await b.hasStoredData(scene.pageId)).toBe(true);
  });

  it('the periodic check finds missed committed content without any Redis event', async () => {
    // Redis stays connected but one instance never received an update (a lost message, a
    // paused subscriber): no reconnect happens, so only the periodic check can notice.
    const cluster = new Cluster();
    const a = await cluster.add();
    const b = await cluster.add({ cluster: { resyncIntervalMs: 400 } });
    cleanups.push(() => cluster.close());
    const { owner, workspaceId, pageId } = await a.scene();
    const peer = await a.user('peer');
    await a.member(workspaceId, peer, 'EDITOR');
    const onA = await a.connect(owner, pageId);
    const onB = await b.connect(peer, pageId);
    onA.insert('one');
    await eventually(() => onB.text === 'one', 'synchronized');
    // Make b ignore Redis messages for a while.
    const channel = `${cluster.prefix}:page:${pageId}`;
    const sub = (b.collab.cluster as unknown as { inner: { sub: Redis } }).inner.sub;
    await sub.unsubscribe(channel);
    onA.insert(' two');
    await eventually(async () => (await storedText(a, pageId)) === 'one two', 'committed');
    await eventually(() => onB.text === 'one two', 'the periodic check repairs b', 10_000);
    expect(b.collab.cluster.stats().staleDocumentsRepaired).toBeGreaterThanOrEqual(1);
  });

  it('records the loss window: a change only the dead instance held is lost with its client, and recovered if the client lives', async () => {
    const group = new Cluster();
    const proxy = RedisProxy.fromUrl(requireInfraEnv().REDIS_URL);
    await proxy.start();
    cleanups.push(async () => {
      await group.close();
      await proxy.stop();
    });
    const slow = { storeDebounceMs: 60_000, storeMaxDebounceMs: 60_000 };
    const doomed = await group.add({ redisUrl: proxy.url, config: slow });
    const survivor = await group.add();
    const { owner, pageId } = await doomed.scene();

    // 1. The client closes with the instance (a closed tab): the update existed nowhere else.
    const gone = await doomed.connect(owner, pageId);
    proxy.sever(); // the instance is cut off before the client's edit
    await eventually(() => doomed.collab.cluster.status === 'degraded', 'cut off');
    gone.insert('unsaved and unshared');
    await doomed.crash();
    await gone.destroy();
    const fresh = await survivor.connect(owner, pageId);
    expect(fresh.text).toBe(''); // G3: lost, within the debounce window

    // 2. The client stays alive (an open tab): it reconnects and pushes what only it holds.
    const alive = new Y.Doc();
    alive.getText('t').insert(0, 'kept by the client');
    const reconnected = await survivor.connect(owner, pageId, { doc: alive });
    await eventually(() => fresh.text.includes('kept by the client'), 'recovered from the client');
    expect(reconnected.text).toContain('kept by the client');
  });
});

describe('connection lifecycle (AC-9.6)', () => {
  it('limits connections per instance, independently of the other instances', async () => {
    const cluster = new Cluster();
    const a = await cluster.add({ config: { maxConnections: 2 } });
    const b = await cluster.add({ config: { maxConnections: 2 } });
    cleanups.push(() => cluster.close());
    const { owner, workspaceId } = await a.scene();
    const pages = await Promise.all([1, 2, 3, 4, 5].map(() => a.page(workspaceId, owner)));
    const c1 = await a.connect(owner, pages[0]!);
    const c2 = await a.connect(owner, pages[1]!);
    const refused = await a.connect(owner, pages[2]!, { reconnect: false });
    expect(c1.synced && c2.synced).toBe(true);
    expect(refused.synced).toBe(false);
    expect(a.collab.registry.size).toBe(2);
    // The other instance has its own budget.
    const d1 = await b.connect(owner, pages[2]!);
    const d2 = await b.connect(owner, pages[3]!);
    expect(d1.synced && d2.synced).toBe(true);
    // A freed slot is usable again.
    await c1.destroy();
    await eventually(() => a.collab.registry.size === 1, 'slot freed');
    const again = await a.connect(owner, pages[4]!);
    expect(again.synced).toBe(true);
  });

  it('closes a connection that goes silent, and keeps one that answers heartbeats', async () => {
    const cluster = new Cluster();
    const a = await cluster.add({ config: { connectionTimeoutMs: 1_500 } });
    cleanups.push(() => cluster.close());
    const { owner, pageId } = await a.scene();
    const healthy = await a.connect(owner, pageId);
    // A client that opened the socket and then stopped responding altogether.
    const silent = new WebSocket(a.url, { headers: { Origin: TEST_ORIGIN }, autoPong: false });
    const closed = new Promise<number>((resolve) => silent.on('close', (code) => resolve(code)));
    await new Promise<void>((resolve) => silent.on('open', () => resolve()));
    const startedAt = performance.now();
    await closed;
    expect(performance.now() - startedAt).toBeLessThan(6_000);
    await sleep(3_500); // more than twice the timeout
    expect(healthy.online).toBe(true);
  });
});

describe('rolling restart behind a load balancer (AC-9.8)', () => {
  it(
    'keeps documents available and loses no committed edit while instances restart one at a time',
    { timeout: 60_000 },
    async () => {
      const cluster = new Cluster();
      const lb = new RoundRobinProxy();
      await lb.start();
      cleanups.push(async () => {
        await lb.stop();
        await cluster.close();
      });
      const a = await cluster.add();
      const b = await cluster.add();
      lb.setTargets([a.collab.port, b.collab.port]);
      const { owner, workspaceId, pageId } = await a.scene();
      const people = [owner];
      for (let i = 0; i < 3; i += 1) {
        const user = await a.user(`rolling${i}`);
        await a.member(workspaceId, user, 'EDITOR');
        people.push(user);
      }
      const clients = await Promise.all(
        people.map((user) => a.connect(user, pageId, { url: lb.url })),
      );
      let counter = 0;
      const tokens: string[] = [];
      const type = (count: number) => {
        for (let i = 0; i < count; i += 1) {
          const token = `<${counter++}>`;
          tokens.push(token);
          clients[counter % clients.length]!.insert(token);
        }
      };

      type(20);
      await sleep(300);
      // Restart instance a: graceful stop (drain), clients reconnect through the balancer.
      lb.setTargets([b.collab.port]);
      type(10);
      await a.collab.stop();
      type(10);
      await eventually(
        () => clients.every((client) => client.online),
        'all clients back on b',
        15_000,
      );
      const a2 = await cluster.add();
      lb.setTargets([a2.collab.port, b.collab.port]);
      await eventually(
        async () => (await a2.collab.server.hocuspocus.documents.size) >= 0,
        'a2 is up',
      );
      type(10);
      // Restart instance b the same way.
      lb.setTargets([a2.collab.port]);
      await b.collab.stop();
      type(10);
      await eventually(
        () => clients.every((client) => client.online),
        'all clients back on a2',
        15_000,
      );
      type(5);

      await eventually(
        () => clients.every((client) => tokens.every((token) => client.text.includes(token))),
        'every client holds every edit that was typed',
        20_000,
      );
      await eventually(
        async () => {
          const stored = await storedText(a2, pageId);
          return tokens.every((token) => stored.includes(token));
        },
        'PostgreSQL holds every edit',
        10_000,
      );
      const finalText = clients[0]!.text;
      for (const token of tokens) expect(finalText.split(token).length - 1).toBe(1);
      // The restarts really disturbed the clients: they were told to leave and came back.
      const reconnections = clients.reduce(
        (sum, client) => sum + Math.max(0, client.connections - 1),
        0,
      );
      expect(reconnections).toBeGreaterThanOrEqual(2);
      expect(clients.some((client) => client.closes.length > 0)).toBe(true);
      expect(
        clients.some((client) => client.messages.some((m) => m.type === 'server.shutting_down')),
      ).toBe(true);
    },
  );
});
