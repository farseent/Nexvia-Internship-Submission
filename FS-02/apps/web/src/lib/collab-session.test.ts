import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeServerMessage, type CollabTokenResponse } from '@conote/shared';
import { ApiError } from './api-client';
import { CollabSession } from './collab-session';

interface FakeConfig {
  websocketProvider: { config: { url: string; WebSocketPolyfill?: unknown } };
  name: string;
  document: unknown;
  token: () => Promise<string>;
  onStatus: (e: { status: string }) => void;
  onSynced: () => void;
  onUnsyncedChanges: () => void;
  onAuthenticationFailed: (e: { reason: string }) => void;
  onStateless: (e: { payload: string }) => void;
}
const { providers, FakeProvider, FakeSocket } = vi.hoisted(() => {
  const providers: InstanceType<typeof FakeProvider>[] = [];
  class FakeProvider {
    hasUnsyncedChanges = false;
    destroyed = false;
    forceSync = vi.fn();
    attach = vi.fn();
    configuration: { websocketProvider: { destroy: () => void } };
    constructor(readonly config: FakeConfig) {
      this.configuration = { websocketProvider: config.websocketProvider as never };
      providers.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class FakeSocket {
    destroy = vi.fn();
    constructor(readonly config: { url: string; WebSocketPolyfill?: unknown }) {}
  }
  return { providers, FakeProvider, FakeSocket };
});
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: FakeProvider,
  HocuspocusProviderWebsocket: FakeSocket,
}));

const PAGE = '0b1b6a8e-3a52-4c1d-8a49-2b8a4f3d1e01';
const info = (over: Partial<CollabTokenResponse> = {}): CollabTokenResponse => ({
  token: 'tok-1',
  expiresAt: '2026-11-17T10:00:00.000Z',
  collabUrl: 'ws://collab.test:4100',
  documentName: `page:${PAGE}`,
  role: 'EDITOR',
  readOnly: false,
  ...over,
});
const apiError = (status: number) =>
  new ApiError({ status, code: status === 404 ? 'NOT_FOUND' : 'UNKNOWN', message: 'x' });
const latest = () => providers[providers.length - 1]!;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let sessions: CollabSession[] = [];
function make(fetchToken: () => Promise<CollabTokenResponse>) {
  const session = new CollabSession({ pageId: PAGE, fetchToken, retryDelaysMs: [10, 20] });
  sessions.push(session);
  return session;
}
beforeEach(() => {
  providers.length = 0;
});
afterEach(() => {
  for (const s of sessions) s.destroy();
  sessions = [];
});

describe('opening', () => {
  it('connects to the URL and document name from the token response', async () => {
    const session = make(async () => info());
    session.start();
    await flush();
    expect(latest().config.websocketProvider.config.url).toBe('ws://collab.test:4100');
    expect(latest().config.name).toBe(`page:${PAGE}`);
    expect(session.getState()).toMatchObject({
      phase: 'connecting',
      everSynced: false,
      role: 'EDITOR',
      readOnly: false,
      generation: 1,
    });
    latest().config.onSynced();
    expect(session.getState()).toMatchObject({ phase: 'live', everSynced: true });
  });

  it('uses the first token once, then fetches a fresh one for every reconnection', async () => {
    const fetchToken = vi.fn(async () => info({ token: `tok-${fetchToken.mock.calls.length}` }));
    const session = make(fetchToken);
    session.start();
    await flush();
    expect(await latest().config.token()).toBe('tok-1');
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(await latest().config.token()).toBe('tok-2');
    expect(await latest().config.token()).toBe('tok-3');
  });

  it('mirrors a read-only role from the token response', async () => {
    const session = make(async () => info({ role: 'VIEWER', readOnly: true }));
    session.start();
    await flush();
    expect(session.getState()).toMatchObject({ readOnly: true, role: 'VIEWER' });
  });

  it.each([404, 403])(
    'a %i from the token endpoint means denied, and no connection is made',
    async (status) => {
      const session = make(async () => Promise.reject(apiError(status)));
      session.start();
      await flush();
      expect(session.getState().phase).toBe('denied');
      expect(providers).toHaveLength(0);
    },
  );

  it('a 503 or a network failure leaves it unavailable and retries by itself', async () => {
    let calls = 0;
    const session = make(async () => {
      calls += 1;
      if (calls < 3) throw apiError(503);
      return info();
    });
    session.start();
    await flush();
    expect(session.getState().phase).toBe('unavailable');
    await vi.waitFor(() => expect(providers).toHaveLength(1), { timeout: 1000 });
    expect(calls).toBe(3);
  });
});

describe('connection changes', () => {
  async function live() {
    const session = make(async () => info());
    session.start();
    await flush();
    latest().config.onSynced();
    return session;
  }

  it('is offline after a disconnect and live again after the next sync', async () => {
    const session = await live();
    latest().config.onStatus({ status: 'disconnected' });
    expect(session.getState().phase).toBe('offline');
    expect(session.doc).not.toBeNull(); // local edits are kept
    latest().config.onSynced();
    expect(session.getState().phase).toBe('live');
  });

  it('tracks unconfirmed local changes', async () => {
    const session = await live();
    latest().hasUnsyncedChanges = true;
    latest().config.onUnsyncedChanges();
    expect(session.getState().unsyncedChanges).toBe(true);
    latest().hasUnsyncedChanges = false;
    latest().config.onUnsyncedChanges();
    expect(session.getState().unsyncedChanges).toBe(false);
  });

  it('a refusal that says "try again later" keeps the document and reconnects with a new provider', async () => {
    const session = await live();
    const doc = session.doc;
    const first = latest();
    first.config.onAuthenticationFailed({ reason: 'TRY_AGAIN_LATER' });
    expect(first.destroyed).toBe(true);
    expect(session.getState().phase).toBe('offline');
    await vi.waitFor(() => expect(providers).toHaveLength(2), { timeout: 1000 });
    expect(session.doc).toBe(doc);
  });

  it('a failed token fetch during reconnection is treated as transient', async () => {
    const session = await live();
    latest().config.onAuthenticationFailed({
      reason: 'Failed to get token during sendToken(): TypeError',
    });
    expect(session.getState().phase).toBe('offline');
    await vi.waitFor(() => expect(providers).toHaveLength(2), { timeout: 1000 });
  });

  it('AUTH_FAILED is tried once more with a fresh token, then the page is denied', async () => {
    const fetchToken = vi.fn(async () => info());
    const session = make(fetchToken);
    session.start();
    await flush();
    latest().config.onAuthenticationFailed({ reason: 'AUTH_FAILED' });
    await flush();
    expect(providers).toHaveLength(2);
    latest().config.onAuthenticationFailed({ reason: 'AUTH_FAILED' });
    expect(session.getState()).toMatchObject({ phase: 'denied' });
    expect(session.doc).toBeNull();
  });

  it.each(['ACCESS_DENIED', 'PAGE_NOT_FOUND', 'PROTOCOL_VIOLATION'])(
    '%s denies the page immediately',
    async (reason) => {
      const session = await live();
      latest().config.onAuthenticationFailed({ reason });
      expect(session.getState().phase).toBe('denied');
      expect(latest().destroyed).toBe(true);
    },
  );

  it('server.shutting_down shows offline until the provider reconnects', async () => {
    const session = await live();
    latest().config.onStateless({
      payload: encodeServerMessage({ v: 1, type: 'server.shutting_down', payload: {} }),
    });
    expect(session.getState().phase).toBe('offline');
    latest().config.onSynced();
    expect(session.getState().phase).toBe('live');
  });
});

describe('access changes announced by the server', () => {
  async function live() {
    const session = make(async () => info());
    session.start();
    await flush();
    latest().config.onSynced();
    return session;
  }
  const send = (payload: Parameters<typeof encodeServerMessage>[0]) =>
    latest().config.onStateless({ payload: encodeServerMessage(payload) });

  it('access.revoked ends the session for good and drops the document', async () => {
    const session = await live();
    const provider = latest();
    send({ v: 1, type: 'access.revoked', payload: { reason: 'MEMBER_REMOVED' } });
    expect(session.getState()).toMatchObject({ phase: 'revoked', readOnly: true });
    expect(session.doc).toBeNull();
    expect(provider.destroyed).toBe(true);
    // Nothing reconnects afterwards.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(providers).toHaveLength(1);
  });

  it('a downgrade to read-only starts over on a fresh document', async () => {
    let downgraded = false;
    const session = make(async () =>
      downgraded ? info({ role: 'VIEWER', readOnly: true }) : info(),
    );
    session.start();
    await flush();
    latest().config.onSynced();
    downgraded = true; // from now on the API reports the new role, as it would
    const before = session.doc;
    const generation = session.getState().generation;
    send({ v: 1, type: 'access.changed', payload: { readOnly: true, role: 'VIEWER' } });
    await vi.waitFor(() => expect(providers).toHaveLength(2));
    expect(session.doc).not.toBe(before);
    expect(session.getState()).toMatchObject({ readOnly: true, role: 'VIEWER' });
    expect(session.getState().generation).toBeGreaterThan(generation);
  });

  it('an upgrade to editable resynchronizes the same connection', async () => {
    const session = make(async () => info({ role: 'VIEWER', readOnly: true }));
    session.start();
    await flush();
    latest().config.onSynced();
    const provider = latest();
    send({ v: 1, type: 'access.changed', payload: { readOnly: false, role: 'EDITOR' } });
    expect(provider.forceSync).toHaveBeenCalledOnce();
    expect(providers).toHaveLength(1);
    expect(session.getState()).toMatchObject({ readOnly: false, role: 'EDITOR' });
  });

  it('ignores messages that are not valid server messages', async () => {
    const session = await live();
    latest().config.onStateless({ payload: 'not json' });
    latest().config.onStateless({
      payload: JSON.stringify({ v: 1, type: 'access.revoked', payload: { reason: 'MADE_UP' } }),
    });
    expect(session.getState().phase).toBe('live');
  });
});

describe('subscription', () => {
  it('notifies listeners of changes and stops after destroy', async () => {
    const session = make(async () => info());
    const seen: string[] = [];
    session.subscribe((state) => seen.push(state.phase));
    session.start();
    await flush();
    latest().config.onSynced();
    expect(seen).toContain('live');
    session.destroy();
    expect(latest().destroyed).toBe(true);
    const count = seen.length;
    latest().config.onSynced();
    expect(seen).toHaveLength(count);
  });
});
