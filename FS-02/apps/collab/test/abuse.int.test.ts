import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { documentNameForPage } from '@conote/shared';
import { Harness, TEST_ORIGIN, sleep, until, type TestClient } from './harness.js';

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

// ── minimal wire encoding (lib0 varints) so tests can send frames the library would not ──
const varUint = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  while (v > 127) {
    out.push(128 | (v & 127));
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};
const varString = (s: string): number[] => {
  const bytes = [...Buffer.from(s, 'utf8')];
  return [...varUint(bytes.length), ...bytes];
};
const syncUpdateFrame = (name: string, update: number[]) =>
  Uint8Array.from([
    ...varString(name),
    ...varUint(0),
    ...varUint(2),
    ...varUint(update.length),
    ...update,
  ]);

const rawSocket = (c: TestClient): WebSocket =>
  c.provider.configuration.websocketProvider.webSocket as unknown as WebSocket;

async function pair(h: Harness) {
  const { owner, workspaceId, pageId } = await h.scene();
  const other = await h.user('other');
  await h.member(workspaceId, other, 'EDITOR');
  return { owner, other, workspaceId, pageId };
}

describe('hostile input (ABUSE)', () => {
  it('closes a connection that sends an oversized message, others are unaffected', async () => {
    const h = await start({ config: { maxPayloadBytes: 64 * 1024 } });
    const { owner, other, pageId } = await pair(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(other, pageId);
    const closed = new Promise<number>((resolve) =>
      rawSocket(a).once('close', (code: number) => resolve(code)),
    );
    rawSocket(a).send(syncUpdateFrame(documentNameForPage(pageId), new Array(100 * 1024).fill(1)));
    expect(await closed).toBe(1009);
    b.insert('still fine');
    await sleep(200);
    const c = await h.connect(owner, pageId);
    await until(() => c.text === 'still fine', 'document intact');
    await Promise.all([a, b, c].map((x) => x.destroy()));
  });

  it('survives a malformed Yjs update: drops the sender, keeps the document intact', async () => {
    const h = await start();
    const { owner, other, pageId } = await pair(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(other, pageId);
    a.insert('good text');
    await until(() => b.text === 'good text', 'synced');
    for (const garbage of [[255, 255, 255, 255, 255], [1, 2, 3], [0], new Array(50).fill(200)]) {
      rawSocket(a).send(syncUpdateFrame(documentNameForPage(pageId), garbage));
    }
    await sleep(400);
    expect(b.text).toBe('good text');
    b.insert('!');
    const fresh = await h.connect(owner, pageId);
    await until(() => fresh.text === 'good text!', 'collaboration continues');
    expect((await fetch(`${h.httpUrl}/health`)).status).toBe(200);
    await Promise.all([a, b, fresh].map((x) => x.destroy()));
  });

  it('does nothing for a client that sends document messages without authenticating', async () => {
    const h = await start();
    const { owner, pageId } = await pair(h);
    // Someone else holds the document open and has content in it.
    const holder = await h.connect(owner, pageId);
    holder.insert('secret text');
    await sleep(100);

    const name = documentNameForPage(pageId);
    const received: Buffer[] = [];
    const ws = new WebSocket(h.url, { headers: { Origin: TEST_ORIGIN } });
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.on('message', (data: Buffer) => received.push(Buffer.from(data)));
    // Sync step 1 (asks for the document), a write, and an awareness query, all without a token.
    ws.send(Uint8Array.from([...varString(name), ...varUint(0), ...varUint(0), ...varUint(1), 0]));
    ws.send(syncUpdateFrame(name, [1, 1, 1]));
    ws.send(Uint8Array.from([...varString(name), ...varUint(3)]));
    await sleep(500);
    expect(h.collab.registry.size).toBe(1); // only the holder
    // Nothing that contains the document text came back.
    expect(Buffer.concat(received).toString('utf8')).not.toContain('secret text');
    ws.terminate();
    await holder.destroy();
  });

  it('survives random garbage frames before and after the handshake', async () => {
    const h = await start();
    await pair(h);
    for (let i = 0; i < 20; i += 1) {
      const ws = new WebSocket(h.url, { headers: { Origin: TEST_ORIGIN } });
      await new Promise<void>((resolve) => ws.once('open', () => resolve()));
      ws.send(Uint8Array.from({ length: 1 + ((i * 7) % 60) }, (_, k) => (k * 31 + i * 17) % 256));
      ws.send('text frame, not binary');
      ws.terminate();
    }
    await sleep(300);
    expect((await fetch(`${h.httpUrl}/ready`)).status).toBe(200);
    expect(h.collab.registry.size).toBe(0);
  });
});

describe('application messages and limits (LIMITS)', () => {
  it('answers invalid application messages with INVALID_MESSAGE and closes repeat offenders', async () => {
    const h = await start();
    const { owner, pageId } = await pair(h);
    const a = await h.connect(owner, pageId);
    a.provider.sendStateless('not json');
    a.provider.sendStateless(
      JSON.stringify({ v: 1, type: 'version.restore', id: 'req-1', payload: { versionId: 'x' } }),
    );
    await until(
      () => a.messages.filter((m) => m.type === 'error').length === 2,
      'two error replies',
    );
    const [first, second] = a.messages as Extract<(typeof a.messages)[number], { type: 'error' }>[];
    expect(first!.payload.code).toBe('INVALID_MESSAGE');
    expect(second!.payload.code).toBe('INVALID_MESSAGE');
    expect(second!.replyTo).toBe('req-1');
    a.provider.sendStateless('x'.repeat(20_000)); // over the application message limit
    a.provider.sendStateless('{}');
    a.provider.sendStateless('[]');
    await until(
      () => a.closes.some((c) => c.code === 4400),
      'closed with PROTOCOL_VIOLATION',
      4000,
    );
    await a.destroy();
  });

  it('closes a connection that floods the server with messages', async () => {
    const h = await start({ config: { maxMessagesPerSecond: 20 } });
    const { owner, other, pageId } = await pair(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(other, pageId);
    // Valid document updates, one message each (invalid application messages would trip the
    // protocol-violation limit first).
    for (let i = 0; i < 300; i += 1) a.insert('x');
    await until(() => a.closes.some((c) => c.code === 4429), 'closed with RATE_LIMITED', 4000);
    b.insert('unaffected');
    const fresh = await h.connect(owner, pageId);
    await until(
      // The flooder's last accepted updates may still be arriving, so only equality is expected.
      () => b.text.includes('unaffected') && fresh.text === b.text,
      'others keep working',
    );
    expect(b.closes).toEqual([]);
    await Promise.all([a, b, fresh].map((x) => x.destroy()));
  });

  it('limits the connections of one user and frees the slot when one closes', async () => {
    const h = await start({ config: { maxConnectionsPerUser: 2 } });
    const { owner, workspaceId } = await pair(h);
    const pages = await Promise.all([1, 2, 3].map(() => h.page(workspaceId, owner)));
    const c1 = await h.connect(owner, pages[0]!);
    const c2 = await h.connect(owner, pages[1]!);
    const c3 = await h.connect(owner, pages[2]!, { reconnect: false });
    expect(c3.authFailures).toEqual(['RATE_LIMITED']);
    await c1.destroy();
    await until(() => h.collab.registry.size === 1, 'slot freed');
    const c4 = await h.connect(owner, pages[2]!);
    expect(c4.synced).toBe(true);
    await Promise.all([c2, c3, c4].map((x) => x.destroy()));
  });

  it('many simultaneous connection attempts cannot overshoot the per-user limit', async () => {
    const h = await start({ config: { maxConnectionsPerUser: 3 } });
    const { owner, workspaceId } = await pair(h);
    const pages = await Promise.all(Array.from({ length: 10 }, () => h.page(workspaceId, owner)));
    const clients = await Promise.all(pages.map((p) => h.connect(owner, p, { reconnect: false })));
    expect(clients.filter((c) => c.synced).length).toBe(3);
    expect(clients.filter((c) => c.authFailures[0] === 'RATE_LIMITED').length).toBe(7);
    await Promise.all(clients.map((c) => c.destroy()));
  });

  it('relays only the server-built identity of a connection, never client-supplied presence', async () => {
    const h = await start();
    const { owner, other, pageId } = await pair(h);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(other, pageId);
    a.provider.setAwarenessField('user', { name: 'Impersonated Admin', blob: 'x'.repeat(5000) });
    await sleep(400);
    const states = [...b.provider.awareness!.getStates().entries()].filter(
      ([id]) => id !== b.doc.clientID,
    );
    expect(states).toHaveLength(1);
    expect(JSON.stringify(states)).not.toContain('Impersonated');
    expect(JSON.stringify(states)).not.toContain('xxxxx');
    await Promise.all([a, b].map((x) => x.destroy()));
  });
});
