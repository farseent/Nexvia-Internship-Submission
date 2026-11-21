import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { parseServerMessage, type CollabTokenResponse, type ServerMessage } from '@conote/shared';
import { ApiError } from './api-client';

/**
 * What the person should see of the live connection (docs/WEBSOCKET_PROTOCOL.md §6, §10).
 *
 *  connecting   – no document yet (first open); the editor is not shown
 *  live         – connected and in sync with the server
 *  offline      – the connection dropped; edits are kept and sent after reconnecting
 *  unavailable  – no token could be obtained (live collaboration is off, or the API is down)
 *  denied       – this person may not open the page
 *  revoked      – access ended while the page was open
 */
export type CollabPhase = 'connecting' | 'live' | 'offline' | 'unavailable' | 'denied' | 'revoked';

export interface CollabState {
  phase: CollabPhase;
  /** True once the document has synced at least once; before that there is nothing to show. */
  everSynced: boolean;
  /** The server enforces this; the client only mirrors it so the editor is not offered. */
  readOnly: boolean;
  role: CollabTokenResponse['role'] | null;
  /** Local changes the server has not confirmed yet. */
  unsyncedChanges: boolean;
  /** Changes when the Y.Doc is replaced, so the editor can be rebuilt on the new document. */
  generation: number;
  /** A reason for `denied` / `revoked`, for display. */
  reason: string | null;
  /** A version restore is running on this page: the editor is held read-only meanwhile (D62). */
  restoring: boolean;
  /** Why the last restore failed, until the next one starts. */
  restoreError: string | null;
  /** Bumped when the page's threads may have changed (event or reconnect): refetch them (D14). */
  commentsTick: number;
  /** Bumped when a version was created or restored: refetch the version list. */
  versionsTick: number;
}

export type CommandResult =
  { ok: true; result: Record<string, unknown> } | { ok: false; code: string; message: string };

const COMMAND_TIMEOUT_MS = 30_000;

export interface CollabSessionOptions {
  pageId: string;
  /** `PAGE-10`. Called for the first connection and again for every reconnection. */
  fetchToken: () => Promise<CollabTokenResponse>;
  /** Test hook: a WebSocket implementation other than the browser's. */
  WebSocketPolyfill?: unknown;
  /** Delays before retrying after a refusal that says "try again later" or a token failure. */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
const TRANSIENT_REASONS = new Set(['TRY_AGAIN_LATER', 'RATE_LIMITED']);

type Listener = (state: CollabState) => void;

/**
 * The awareness of one document, kept across provider rebuilds. `HocuspocusProvider.destroy()`
 * destroys the awareness it was given, but the editor's cursor plugin holds on to it for as
 * long as the document lives, so destruction is deferred to `dispose()`, called with the
 * document. The server stamps identity on what this publishes (D61); only the cursor matters.
 */
class SessionAwareness extends Awareness {
  override destroy(): void {
    // Kept alive: the provider that used this awareness is being replaced, not the document.
  }
  dispose(): void {
    super.destroy();
  }
}

/**
 * One page's live connection. Framework-free so it can be tested without React.
 *
 * It owns the `Y.Doc` and the Hocuspocus provider, fetches a fresh collaboration token for every
 * connection (a token lives one minute), and follows what the server says about access:
 *  - `access.revoked`  → stop for good, drop the document;
 *  - `access.changed` to read-only → start over on a fresh document, so edits the server refused
 *    are not left behind in the local copy;
 *  - `access.changed` to editable → resynchronize, because updates the server dropped while the
 *    connection was read-only leave a gap that later updates would wait on.
 * The server decides what is allowed; nothing here grants anything.
 */
export class CollabSession {
  private state: CollabState = {
    phase: 'connecting',
    everSynced: false,
    readOnly: true,
    role: null,
    unsyncedChanges: false,
    generation: 0,
    reason: null,
    restoring: false,
    restoreError: null,
    commentsTick: 0,
    versionsTick: 0,
  };
  private pending = new Map<
    string,
    { resolve: (result: CommandResult) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private listeners = new Set<Listener>();
  private currentDoc: Y.Doc | null = null;
  private currentAwareness: SessionAwareness | null = null;
  private currentProvider: HocuspocusProvider | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private authAttemptsWithoutSync = 0;
  private destroyed = false;
  private readonly retryDelays: readonly number[];

  constructor(private readonly options: CollabSessionOptions) {
    this.retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  get doc(): Y.Doc | null {
    return this.currentDoc;
  }
  /** The awareness of the current document: the editor's cursor and collaborators' states. */
  get awareness(): Awareness | null {
    return this.currentAwareness;
  }
  get provider(): HocuspocusProvider | null {
    return this.currentProvider;
  }
  getState(): CollabState {
    return this.state;
  }
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  hasUnsyncedChanges(): boolean {
    return this.currentProvider?.hasUnsyncedChanges ?? false;
  }

  /** Open the first connection. */
  start(): void {
    void this.open({ keepDocument: false });
  }

  /** The person asked to try again after `unavailable`. */
  retry(): void {
    if (this.destroyed || (this.state.phase !== 'unavailable' && this.state.phase !== 'offline'))
      return;
    void this.open({ keepDocument: this.currentDoc !== null });
  }

  destroy(): void {
    this.destroyed = true;
    this.failPending('The connection was closed.');
    clearTimeout(this.retryTimer);
    this.teardownProvider();
    this.discardDocument();
    this.listeners.clear();
  }

  // ───────────── connecting ─────────────

  private async open(opts: { keepDocument: boolean }): Promise<void> {
    clearTimeout(this.retryTimer);
    this.teardownProvider();
    if (!opts.keepDocument) this.discardDocument();
    this.update({
      phase: this.state.everSynced && opts.keepDocument ? 'offline' : 'connecting',
      unsyncedChanges: false,
    });

    let info: CollabTokenResponse;
    try {
      info = await this.options.fetchToken();
    } catch (error) {
      if (this.destroyed) return;
      this.handleTokenFailure(error, opts.keepDocument);
      return;
    }
    if (this.destroyed) return;

    if (!opts.keepDocument || this.currentDoc === null) {
      this.currentDoc = new Y.Doc();
      this.currentAwareness = new SessionAwareness(this.currentDoc);
      this.update({ generation: this.state.generation + 1, everSynced: false });
    }
    const doc = this.currentDoc;
    const awareness = this.currentAwareness;
    // A previous provider removed this client's state when it was destroyed; publish again.
    if (awareness && awareness.getLocalState() === null) awareness.setLocalState({});
    this.update({ readOnly: info.readOnly, role: info.role });

    // The token just fetched is used for the first connection; every reconnection fetches anew.
    let firstToken: string | null = info.token;
    // One socket per document: closing it on revocation can never affect another page.
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: info.collabUrl,
      ...(this.options.WebSocketPolyfill === undefined
        ? {}
        : { WebSocketPolyfill: this.options.WebSocketPolyfill as typeof WebSocket }),
    });
    const provider = new HocuspocusProvider({
      websocketProvider,
      name: info.documentName,
      document: doc,
      ...(awareness ? { awareness } : {}),
      token: async () => {
        if (firstToken !== null) {
          const token = firstToken;
          firstToken = null;
          return token;
        }
        const fresh = await this.options.fetchToken();
        if (!this.destroyed && this.currentProvider === provider) {
          this.update({ readOnly: fresh.readOnly, role: fresh.role });
        }
        return fresh.token;
      },
      onStatus: ({ status }: { status: string }) => {
        if (this.currentProvider !== provider || this.isTerminal()) return;
        if (status === 'disconnected')
          this.update({ phase: this.state.everSynced ? 'offline' : 'connecting' });
      },
      onSynced: () => {
        if (this.currentProvider !== provider || this.isTerminal()) return;
        this.attempts = 0;
        this.authAttemptsWithoutSync = 0;
        // Page events are at-most-once: after (re)connecting, threads are fetched again (D14).
        this.update({ commentsTick: this.state.commentsTick + 1 });
        // Publish presence again now that the server knows this connection. y-protocols
        // ignores an awareness update whose clock it has not seen advance, and a client's first
        // update has clock 0, so without this a person who has not moved a cursor yet (or who
        // just reconnected under the same client id) would not show up until the next renewal.
        awareness?.setLocalState(awareness.getLocalState() ?? {});
        this.update({ phase: 'live', everSynced: true });
      },
      onUnsyncedChanges: () => {
        if (this.currentProvider !== provider) return;
        this.update({ unsyncedChanges: provider.hasUnsyncedChanges });
      },
      onAuthenticationFailed: ({ reason }: { reason: string }) => {
        if (this.currentProvider !== provider) return;
        this.handleAuthenticationFailed(reason);
      },
      onStateless: ({ payload }: { payload: string }) => {
        if (this.currentProvider !== provider) return;
        const message = parseServerMessage(payload);
        if (message) this.handleServerMessage(message);
      },
    });
    // The provider did not create the socket, so it must be attached to it explicitly.
    provider.attach();
    this.currentProvider = provider;
  }

  private handleTokenFailure(error: unknown, keepDocument: boolean): void {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      this.finish('denied', 'You do not have access to this page.');
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      // The shell signs the person out and shows the sign-in page; nothing to show here.
      this.finish('denied', 'Your session has ended.');
      return;
    }
    // 503 (collaboration is off), the API is unreachable, or anything else: try again later.
    this.update({ phase: keepDocument && this.state.everSynced ? 'offline' : 'unavailable' });
    this.scheduleRetry(keepDocument);
  }

  private handleAuthenticationFailed(reason: string): void {
    if (TRANSIENT_REASONS.has(reason) || reason.startsWith('Failed to get token')) {
      this.update({ phase: this.state.everSynced ? 'offline' : 'connecting' });
      this.teardownProvider();
      this.scheduleRetry(true);
      return;
    }
    if (reason === 'AUTH_FAILED' && this.authAttemptsWithoutSync < 1) {
      // The token may simply have expired on a slow connection: one more try with a new one.
      this.authAttemptsWithoutSync += 1;
      void this.open({ keepDocument: true });
      return;
    }
    this.finish(
      'denied',
      reason === 'PAGE_NOT_FOUND'
        ? 'This page no longer exists.'
        : 'You do not have access to this page.',
    );
  }

  private scheduleRetry(keepDocument: boolean): void {
    clearTimeout(this.retryTimer);
    const delay = this.retryDelays[Math.min(this.attempts, this.retryDelays.length - 1)] ?? 30_000;
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      if (!this.destroyed)
        void this.open({ keepDocument: keepDocument && this.currentDoc !== null });
    }, delay);
  }

  // ───────────── messages from the server ─────────────

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'access.revoked':
        this.finish('revoked', 'Your access to this page has ended.');
        return;
      case 'access.changed': {
        const { readOnly, role } = message.payload;
        const wasReadOnly = this.state.readOnly;
        if (readOnly && !wasReadOnly) {
          // Start over on a fresh document: what was typed after the server stopped accepting
          // edits is in the local copy only, and must not look like part of the page.
          this.update({ readOnly, role });
          void this.open({ keepDocument: false });
        } else if (!readOnly && wasReadOnly) {
          this.update({ readOnly, role });
          this.currentProvider?.forceSync();
        } else {
          this.update({ readOnly, role });
        }
        return;
      }
      case 'server.shutting_down':
        // The socket closes next and the provider reconnects by itself.
        if (!this.isTerminal()) this.update({ phase: 'offline' });
        return;
      case 'response': {
        if (message.replyTo !== undefined) {
          this.settle(message.replyTo, { ok: true, result: message.payload.result ?? {} });
        }
        return;
      }
      case 'error':
        if (message.replyTo !== undefined) {
          this.settle(message.replyTo, {
            ok: false,
            code: message.payload.code,
            message: message.payload.message,
          });
        }
        return;
      case 'comments.changed':
        this.update({ commentsTick: this.state.commentsTick + 1 });
        return;
      case 'version.created':
        this.update({ versionsTick: this.state.versionsTick + 1 });
        return;
      case 'version.restore.started':
        this.update({ restoring: true, restoreError: null });
        return;
      case 'version.restored':
        // The restore arrived as an ordinary update. Anything this client typed while the server
        // held writes back was refused; syncing sends it again, and it merges (D62).
        this.update({
          restoring: false,
          versionsTick: this.state.versionsTick + 1,
          commentsTick: this.state.commentsTick + 1,
        });
        this.currentProvider?.forceSync();
        return;
      case 'version.restore.failed':
        this.update({ restoring: false, restoreError: message.payload.reason });
        this.currentProvider?.forceSync();
        return;
    }
  }

  // ───────────── commands (WEBSOCKET_PROTOCOL §7) ─────────────

  /** Save a named version of the page as it is now. Needs the Editor role; the server decides. */
  createVersion(label?: string): Promise<CommandResult> {
    return this.command('version.create', label === undefined ? {} : { label });
  }

  /** Restore a version. The result arrives as an update to the live document, like any edit. */
  restoreVersion(versionId: string): Promise<CommandResult> {
    return this.command('version.restore', { versionId });
  }

  private command(type: string, payload: Record<string, unknown>): Promise<CommandResult> {
    const provider = this.currentProvider;
    if (provider === null || this.state.phase !== 'live') {
      return Promise.resolve({
        ok: false,
        code: 'NOT_CONNECTED',
        message: 'Reconnect to the page and try again.',
      });
    }
    const id = crypto.randomUUID();
    return new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, code: 'TIMEOUT', message: 'The server did not answer in time.' });
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      provider.sendStateless(JSON.stringify({ v: 1, type, id, payload }));
    });
  }

  private settle(id: string, result: CommandResult): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(result);
  }

  private failPending(message: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, code: 'NOT_CONNECTED', message });
      this.pending.delete(id);
    }
  }

  // ───────────── helpers ─────────────

  private isTerminal(): boolean {
    return this.state.phase === 'denied' || this.state.phase === 'revoked';
  }

  /** End for good: stop reconnecting and drop the local document. */
  private finish(phase: 'denied' | 'revoked', reason: string): void {
    clearTimeout(this.retryTimer);
    this.teardownProvider();
    this.discardDocument();
    this.update({
      phase,
      reason,
      readOnly: true,
      unsyncedChanges: false,
      generation: this.state.generation + 1,
    });
  }

  private discardDocument(): void {
    this.currentAwareness?.dispose();
    this.currentAwareness = null;
    this.currentDoc?.destroy();
    this.currentDoc = null;
  }

  private teardownProvider(): void {
    const provider = this.currentProvider;
    this.currentProvider = null;
    if (!provider) return;
    try {
      provider.destroy();
      provider.configuration.websocketProvider.destroy();
    } catch {
      // Already closed.
    }
  }

  private update(patch: Partial<CollabState>): void {
    if (this.destroyed) return;
    const next = { ...this.state, ...patch };
    const changed = (Object.keys(next) as (keyof CollabState)[]).some(
      (k) => next[k] !== this.state[k],
    );
    if (!changed) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
