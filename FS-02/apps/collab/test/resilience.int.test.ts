import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentStore } from '@conote/db';
import { Harness, sleep, until, type TestClient } from './harness.js';

const cleanups: Harness[] = [];
afterEach(async () => {
  // Stop every server before removing any data, so no server stores into deleted rows.
  const all = cleanups.splice(0);
  for (const harness of all) await harness.stop().catch(() => undefined);
  for (const harness of all) await harness.cleanup().catch(() => undefined);
});
async function start(options: Parameters<typeof Harness.start>[0] = {}) {
  const harness = await Harness.start(options);
  cleanups.push(harness);
  return harness;
}

async function pair(h: Harness) {
  const { owner, workspaceId, pageId } = await h.scene();
  const other = await h.user('other');
  await h.member(workspaceId, other, 'EDITOR');
  return { owner, other, pageId };
}

describe('disconnection and reconnection (RECON)', () => {
  it('reconnects after a network drop, fetching a fresh token, and merges offline edits', async () => {
    const h = await start();
    const { owner, other, pageId } = await pair(h);
    let tokenCalls = 0;
    const a = await h.connect(owner, pageId, {
      token: () => {
        tokenCalls += 1;
        return h.token(owner, pageId);
      },
    });
    const b = await h.connect(other, pageId);
    a.insert('A1 ');
    await until(() => b.text === 'A1 ', 'b has A1');

    a.dropNetwork();
    // Edits on both sides while a is disconnected.
    a.insert('A-offline ');
    b.insert('B-while-away ');
    await until(() => a.connections >= 2 && a.online, 'a reconnected', 8000);
    await until(
      () => a.text === b.text && a.text.includes('A-offline') && a.text.includes('B-while-away'),
      'both sides converge',
    );
    expect(tokenCalls).toBeGreaterThanOrEqual(2);
    expect(a.text.split('A-offline').length - 1).toBe(1);
    await Promise.all([a.destroy(), b.destroy()]);
  });

  it('survives repeated network failures (flapping) without losing or duplicating edits', async () => {
    const h = await start();
    const { owner, other, pageId } = await pair(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(other, pageId);
    for (let i = 0; i < 5; i += 1) {
      a.insert(`<a${i}>`);
      a.dropNetwork();
      b.insert(`<b${i}>`);
      await sleep(250);
    }
    await until(() => a.connections >= 2 && a.online, 'a reconnected', 8000);
    const complete = (c: TestClient) =>
      [0, 1, 2, 3, 4].every((i) => c.text.includes(`<a${i}>`) && c.text.includes(`<b${i}>`));
    await until(() => complete(a) && complete(b) && a.text === b.text, 'converged', 8000);
    for (let i = 0; i < 5; i += 1) {
      expect(a.text.split(`<a${i}>`).length - 1).toBe(1);
      expect(a.text.split(`<b${i}>`).length - 1).toBe(1);
    }
    await Promise.all([a.destroy(), b.destroy()]);
  });

  it('a client that was away for a while catches up with what it missed', async () => {
    const h = await start();
    const { owner, other, pageId } = await pair(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(other, pageId);
    a.provider.configuration.websocketProvider.disconnect();
    for (let i = 0; i < 30; i += 1) b.insert(`m${i};`);
    await until(() => h.hasStoredData(pageId), 'stored');
    a.provider.configuration.websocketProvider.connect();
    await until(() => a.text === b.text && a.text.includes('m29;'), 'a caught up', 8000);
    await Promise.all([a.destroy(), b.destroy()]);
  });
});

describe('server restart and recovery (RESTART)', () => {
  it('stores pending changes on graceful shutdown, tells clients, and recovers after restart', async () => {
    // A long debounce: only the shutdown flush can store this edit.
    const first = await start({ config: { storeDebounceMs: 60_000, storeMaxDebounceMs: 60_000 } });
    const { owner, other, pageId } = await pair(first);
    const a = await first.connect(owner, pageId);
    const b = await first.connect(other, pageId);
    a.insert('before restart ');
    await until(() => b.text === 'before restart ', 'b sees it');
    expect(await first.hasStoredData(pageId)).toBe(false);

    const port = first.collab.port;
    await first.collab.stop();
    expect(await first.hasStoredData(pageId)).toBe(true);
    await until(() => a.messageTypes().includes('server.shutting_down'), 'clients were told');
    expect(a.closes.some((c) => c.code === 1012)).toBe(true);

    // The clients keep editing while the server is away.
    a.insert('A-during-outage ');
    b.insert('B-during-outage ');

    const second = await start({ keys: first.keys, config: { port } });
    await until(
      () => a.connections >= 2 && b.connections >= 2 && a.online && b.online,
      'reconnected',
      10_000,
    );
    await until(
      () =>
        a.text === b.text &&
        a.text.includes('before restart') &&
        a.text.includes('A-during-outage') &&
        a.text.includes('B-during-outage'),
      'converged after restart',
      10_000,
    );
    // A brand-new client sees the same state from the database and the restarted server.
    const c = await second.connect(owner, pageId);
    await until(() => c.text === a.text, 'fresh client equals the others');
    await Promise.all([a.destroy(), b.destroy(), c.destroy()]);
  });

  it('after a crash, changes that were not stored yet are restored by the clients that hold them', async () => {
    const first = await start({
      config: { storeDebounceMs: 60_000, storeMaxDebounceMs: 60_000, shutdownTimeoutMs: 600 },
    });
    const { owner, pageId } = await pair(first);
    const a = await first.connect(owner, pageId);
    a.insert('stored? no');
    await sleep(100);
    const port = first.collab.port;
    // The crash: the database is unreachable for the final moments, so nothing can be stored.
    const outage = vi
      .spyOn(DocumentStore.prototype, 'appendDiff')
      .mockRejectedValue(new Error('database gone'));
    await first.collab.stop();
    outage.mockRestore();
    expect(await first.hasStoredData(pageId)).toBe(false); // the server really lost it (G3: only clients hold it)

    const second = await start({ keys: first.keys, config: { port } });
    await until(() => a.connections >= 2 && a.online, 'client reconnected', 10_000);
    const fresh = await second.connect(owner, pageId);
    await until(() => fresh.text === 'stored? no', 'the client re-supplied the change');
    await Promise.all([a.destroy(), fresh.destroy()]);
  });

  it('a stopped server refuses new connections and reports itself as not ready', async () => {
    const h = await start();
    const stopping = h.collab.stop();
    const res = await fetch(`${h.httpUrl}/ready`).catch(() => null);
    await stopping;
    expect(res === null || res.status === 503).toBe(true);
  });
});

describe('health endpoints', () => {
  it('answers /health and /ready', async () => {
    const h = await start();
    expect(await (await fetch(`${h.httpUrl}/health`)).json()).toEqual({
      status: 'ok',
      service: 'collab',
    });
    const ready = await fetch(`${h.httpUrl}/ready`);
    expect(ready.status).toBe(200);
    expect(((await ready.json()) as { dependencies: unknown }).dependencies).toEqual({
      postgres: 'healthy',
      redis: 'healthy',
    });
    expect((await fetch(`${h.httpUrl}/nope`)).status).toBe(404);
  });
});
