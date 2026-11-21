import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import {
  isTransactionOrigin,
  type Document,
  type Extension,
  type Hocuspocus,
  type afterLoadDocumentPayload,
  type afterUnloadDocumentPayload,
  type beforeBroadcastStatelessPayload,
  type beforeUnloadDocumentPayload,
  type onAwarenessUpdatePayload,
  type onChangePayload,
  type onConfigurePayload,
} from '@hocuspocus/server';
import { Redis as IORedis } from 'ioredis';
import * as Y from 'yjs';
import type { Logger } from 'pino';
import type { DocumentStore } from '@conote/db';
import { pageIdFromDocumentName, storedAheadOfLive } from '@conote/shared';
import type { ClusterConfig } from './config.js';

/**
 * Cross-instance synchronization (D2, D64; docs/ARCHITECTURE.md §9, docs/WEBSOCKET_PROTOCOL.md §20).
 *
 * The official Hocuspocus Redis extension carries Yjs updates and awareness between instances
 * over Redis Pub/Sub. This class wraps it so that Redis can fail without harming what CoNote
 * guarantees (D14, G2, G5):
 *
 *  - Redis is never needed to load a document or to store one. A document that loads while
 *    Redis is unavailable is served from PostgreSQL and marked as not yet subscribed; the
 *    extension's own Redis lock is switched off (`lockTimeout: 0`) because PostgreSQL row locks
 *    already serialize stores.
 *  - Pub/Sub delivers at most once and never replays. After Redis returns (and on a timer), the
 *    instance runs the recovery procedure chosen for U13: compare every open document with
 *    PostgreSQL (committed content missing here is merged in), then announce each document's
 *    state vector so that peers answer with what this instance lacks and receive what they lack
 *    (Yjs sync steps 1 and 2). Reconnecting alone does none of this.
 *  - The 4.8.0 extension does not store changes that arrive from Redis. When the instance that
 *    took an edit dies before its debounced store, nobody would store it, so `storeReplicated`
 *    schedules the store on every instance; a store that finds the data already stored costs one
 *    unlocked read (D65).
 */

export type ClusterStatus = 'disabled' | 'connected' | 'degraded';
export type ResyncReason = 'startup' | 'reconnect' | 'interval' | 'manual';

export interface ClusterStats {
  instanceId: string;
  status: ClusterStatus;
  /** Redis outages seen (transitions from connected to degraded after the first connection). */
  outages: number;
  /** Recovery procedures run because Redis came back. */
  recoveries: number;
  /** Resynchronization passes of any reason. */
  resyncs: number;
  /** Open documents that were missing committed content found in PostgreSQL (missed Pub/Sub messages). */
  staleDocumentsRepaired: number;
  /** Documents loaded while Redis was unavailable and subscribed afterwards. */
  lateSubscriptions: number;
  /** Redis messages published by this instance and how many failed. */
  published: number;
  publishedBytes: number;
  publishFailures: number;
  /** Redis messages received (including this instance's own, which the extension discards). */
  received: number;
  receivedBytes: number;
  /** Documents that still wait for their Redis subscription. */
  pendingSubscriptions: number;
}

export interface ClusterDependencies {
  redisUrl: string;
  store: Pick<DocumentStore, 'persistedVectors'>;
  /** Merge what PostgreSQL holds into the open document of the page (Phase 8). */
  catchUp(pageId: string): Promise<void>;
}

const CLIENT_OPTIONS = {
  // Fail fast while Redis is unreachable: a command must never hold up a document load.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 2_000,
  commandTimeout: 3_000,
  retryStrategy: (attempt: number): number => Math.min(attempt * 200, 2_000),
} as const;

/** How long a document load may wait for the Redis side before it is served without it. */
const LOAD_GRACE_MS = 3_000;
/** Documents re-subscribed at the same time during a recovery. */
const RESUBSCRIBE_CONCURRENCY = 8;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isRedisOrigin(origin: unknown): boolean {
  return isTransactionOrigin(origin) && origin.source === 'redis';
}

export class ClusterSync {
  readonly enabled: boolean;
  /** The extension to register with the Hocuspocus server (undefined when clustering is off). */
  readonly extension: Extension | undefined;

  private readonly inner: RedisExtension | null;
  private readonly clients: IORedis[] = [];
  private readonly ready = new Set<IORedis>();
  private readonly pendingSubscription = new Set<string>();
  /** Channels of documents that unloaded while Redis was down; unsubscribed after recovery. */
  private readonly staleChannels = new Set<string>();
  private hocuspocus: Hocuspocus | undefined;
  private state: ClusterStatus;
  private everConnected = false;
  private resyncing = false;
  private timer: NodeJS.Timeout | undefined;
  private lastErrorLogAt = 0;
  private readonly counters = {
    outages: 0,
    recoveries: 0,
    resyncs: 0,
    staleDocumentsRepaired: 0,
    lateSubscriptions: 0,
    published: 0,
    publishedBytes: 0,
    publishFailures: 0,
    received: 0,
    receivedBytes: 0,
  };

  constructor(
    private readonly config: ClusterConfig,
    private readonly dependencies: ClusterDependencies,
    private readonly logger: Logger,
  ) {
    this.enabled = config.enabled;
    this.state = config.enabled ? 'degraded' : 'disabled';
    if (!config.enabled) {
      this.inner = null;
      this.extension = undefined;
      return;
    }
    this.inner = new RedisExtension({
      identifier: config.instanceId,
      prefix: config.prefix,
      // Stores are serialized by PostgreSQL row locks; Redis must not be a prerequisite (D14).
      lockTimeout: 0,
      disconnectDelay: config.disconnectDelayMs,
      awaitInitialSyncTimeout: config.initialSyncTimeoutMs,
      createClient: () => this.createClient(),
    });
    this.inner.sub.on('messageBuffer', (_channel: Buffer, data: Buffer) => {
      this.counters.received += 1;
      this.counters.receivedBytes += data.length;
    });
    const inner = this.inner;
    this.extension = {
      extensionName: 'conote-cluster',
      // Before CoNote's own hooks, as the extension itself requires.
      priority: 1000,
      onConfigure: async (payload: onConfigurePayload) => {
        this.hocuspocus = payload.instance;
        await inner.onConfigure(payload);
      },
      afterLoadDocument: (payload) => this.afterLoad(payload),
      onChange: (payload) => this.onChange(payload),
      onAwarenessUpdate: (payload: onAwarenessUpdatePayload) => inner.onAwarenessUpdate(payload),
      beforeBroadcastStateless: (payload: beforeBroadcastStatelessPayload) =>
        inner.beforeBroadcastStateless(payload),
      beforeUnloadDocument: (payload: beforeUnloadDocumentPayload) =>
        inner.beforeUnloadDocument(payload),
      afterUnloadDocument: (payload) => this.afterUnload(payload),
      onDestroy: () => this.destroy(),
      // `onStoreDocument` and `afterStoreDocument` of the extension only manage its Redis lock,
      // which is off, so they are deliberately not forwarded.
    };
  }

  get status(): ClusterStatus {
    return this.state;
  }

  get instanceId(): string {
    return this.config.instanceId;
  }

  stats(): ClusterStats {
    return {
      instanceId: this.config.instanceId,
      status: this.state,
      ...this.counters,
      pendingSubscriptions: this.pendingSubscription.size,
    };
  }

  /** Begin the periodic check; waits briefly for the first Redis connection but never fails without it. */
  async start(): Promise<void> {
    if (!this.enabled) return;
    const deadline = Date.now() + 2_000;
    while (this.state !== 'connected' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (this.state !== 'connected') {
      this.logger.warn('redis is not reachable at startup; serving from PostgreSQL until it is');
    }
    this.scheduleResync();
  }

  /**
   * One pass of the recovery / anti-entropy procedure (U13). Safe to run at any time and
   * concurrently with editing: it only applies Yjs updates and asks peers for theirs.
   */
  async resyncAll(reason: ResyncReason): Promise<void> {
    if (!this.enabled || this.resyncing || this.hocuspocus === undefined) return;
    this.resyncing = true;
    this.counters.resyncs += 1;
    try {
      const documents = [...this.hocuspocus.documents.values()];
      await this.repairFromPostgres(documents, reason);
      if (this.state === 'connected') await this.announce(documents, reason);
    } finally {
      this.resyncing = false;
    }
  }

  // ───────────── hooks of the extension ─────────────

  private async afterLoad(payload: afterLoadDocumentPayload): Promise<void> {
    const inner = this.inner;
    if (inner === null) return;
    const { documentName } = payload;
    if (this.state !== 'connected') {
      this.pendingSubscription.add(documentName);
      this.logger.warn(
        { documentName },
        'document loaded without redis; serving it from PostgreSQL',
      );
      return;
    }
    try {
      await withTimeout(
        inner.afterLoadDocument(payload),
        this.config.initialSyncTimeoutMs + LOAD_GRACE_MS,
      );
      this.pendingSubscription.delete(documentName);
    } catch (err) {
      // Never refuse a document because Redis failed (D14): serve it, subscribe later.
      this.pendingSubscription.add(documentName);
      this.logger.warn(
        { documentName, err: { name: (err as Error).name, message: (err as Error).message } },
        'could not subscribe the document to redis; it is served without cross-instance sync',
      );
    }
  }

  private async onChange(payload: onChangePayload): Promise<void> {
    const inner = this.inner;
    if (inner === null) return;
    await inner.onChange(payload);
    if (this.config.storeReplicated && isRedisOrigin(payload.transactionOrigin)) {
      // The extension marks Redis-origin changes as "do not store". Store them here as well, so
      // the data survives the death of the instance that took the edit (D65).
      payload.instance.storeDocumentHooks(payload.document, {
        instance: payload.instance,
        clientsCount: payload.clientsCount,
        document: payload.document,
        lastContext: {},
        lastTransactionOrigin: payload.transactionOrigin,
        documentName: payload.documentName,
      });
    }
  }

  private async afterUnload(payload: afterUnloadDocumentPayload): Promise<void> {
    this.pendingSubscription.delete(payload.documentName);
    await this.inner?.afterUnloadDocument(payload);
  }

  private async destroy(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    try {
      await this.inner?.onDestroy();
    } catch (err) {
      // The extension quits its connections politely, which fails when Redis is unreachable
      // (a shutdown during an outage must still complete).
      this.logger.warn(
        { err: { name: (err as Error).name, message: (err as Error).message } },
        'redis did not close cleanly during shutdown',
      );
    } finally {
      for (const client of this.clients) client.disconnect();
    }
  }

  // ───────────── Redis connections ─────────────

  private createClient(): IORedis {
    const client = new IORedis(this.dependencies.redisUrl, CLIENT_OPTIONS);
    this.clients.push(client);
    client.on('ready', () => {
      this.ready.add(client);
      this.refreshState();
    });
    const lost = () => {
      this.ready.delete(client);
      this.refreshState();
    };
    client.on('close', lost);
    client.on('end', lost);
    client.on('error', (err: Error) => {
      // ioredis reports every failed reconnect; one log line per few seconds is enough.
      const now = Date.now();
      if (now - this.lastErrorLogAt < 5_000) return;
      this.lastErrorLogAt = now;
      this.logger.warn({ err: { name: err.name, message: err.message } }, 'redis connection error');
    });
    this.guardPublish(client);
    this.guardUnsubscribe(client);
    return client;
  }

  /**
   * Publishing must never throw into the extension (it would log and drop a change for every
   * keystroke during an outage). A failed publish is counted and the instance is marked
   * degraded; the recovery procedure repairs what was missed.
   */
  private guardPublish(client: IORedis): void {
    const publish = client.publish.bind(client) as (
      channel: string | Buffer,
      message: string | Buffer,
    ) => Promise<number>;
    Object.defineProperty(client, 'publish', {
      value: async (channel: string | Buffer, message: string | Buffer): Promise<number> => {
        try {
          const receivers = await publish(channel, message);
          this.counters.published += 1;
          this.counters.publishedBytes += message.length;
          if (this.state === 'degraded' && this.ready.size === 2) this.refreshState();
          return receivers;
        } catch {
          this.counters.publishFailures += 1;
          this.setState('degraded', 'a publish failed');
          return 0;
        }
      },
    });
  }

  /**
   * Unloading a document unsubscribes its channel. While Redis is unreachable that cannot
   * happen (and the extension would print an error per document), so the channel is remembered
   * and dropped when Redis is back; until then its messages are ignored (no document is open).
   */
  private guardUnsubscribe(client: IORedis): void {
    const unsubscribe = client.unsubscribe.bind(client) as (...args: unknown[]) => Promise<unknown>;
    Object.defineProperty(client, 'unsubscribe', {
      value: (...args: unknown[]): Promise<unknown> => {
        if (this.ready.has(client)) return unsubscribe(...args);
        for (const arg of args) if (typeof arg === 'string') this.staleChannels.add(arg);
        const callback = args.find((arg) => typeof arg === 'function') as (() => void) | undefined;
        callback?.();
        return Promise.resolve(0);
      },
    });
  }

  private async dropStaleChannels(): Promise<void> {
    const inner = this.inner;
    const hocuspocus = this.hocuspocus;
    if (inner === null || hocuspocus === undefined || this.staleChannels.size === 0) return;
    const prefix = `${this.config.prefix}:`;
    const drop = [...this.staleChannels].filter((channel) => {
      const documentName = channel.startsWith(prefix) ? channel.slice(prefix.length) : channel;
      return !hocuspocus.documents.has(documentName);
    });
    this.staleChannels.clear();
    if (drop.length === 0) return;
    try {
      await inner.sub.unsubscribe(...drop);
    } catch {
      for (const channel of drop) this.staleChannels.add(channel);
    }
  }

  private refreshState(): void {
    this.setState(this.ready.size === 2 ? 'connected' : 'degraded', 'connection change');
  }

  private setState(next: ClusterStatus, why: string): void {
    if (this.state === next || !this.enabled) return;
    const previous = this.state;
    this.state = next;
    if (next === 'degraded') {
      if (this.everConnected) {
        this.counters.outages += 1;
        this.logger.warn(
          { why },
          'redis unavailable: cross-instance sync is paused, documents are served from this instance and PostgreSQL',
        );
      }
      return;
    }
    // Connected.
    const recovered = this.everConnected && previous === 'degraded';
    this.everConnected = true;
    if (recovered) {
      this.counters.recoveries += 1;
      this.logger.info('redis is back: running the recovery procedure');
    }
    if (!recovered || this.config.resyncOnReconnect) {
      void this.resyncAll(recovered ? 'reconnect' : 'startup').catch((err: unknown) => {
        this.logger.error({ err: { name: (err as Error).name } }, 'recovery procedure failed');
      });
    } else {
      this.logger.warn('recovery on reconnect is switched off; open documents may stay stale');
    }
  }

  // ───────────── recovery (U13) ─────────────

  /**
   * Step 1, no Redis needed: any open document that lacks committed content PostgreSQL holds
   * missed Pub/Sub messages. Merge the missing content in (it is published to peers like any
   * local change).
   */
  private async repairFromPostgres(documents: Document[], reason: ResyncReason): Promise<void> {
    const byPage = new Map<string, Document>();
    for (const document of documents) {
      const pageId = pageIdFromDocumentName(document.name);
      if (pageId !== null) byPage.set(pageId, document);
    }
    let vectors: Map<string, Uint8Array>;
    try {
      vectors = await this.dependencies.store.persistedVectors([...byPage.keys()]);
    } catch (err) {
      this.logger.warn(
        { err: { name: (err as Error).name } },
        'could not compare documents with PostgreSQL',
      );
      return;
    }
    for (const [pageId, document] of byPage) {
      const stored = vectors.get(pageId);
      if (stored === undefined || document.isDestroyed) continue;
      if (!storedAheadOfLive(stored, Y.encodeStateVector(document))) continue;
      this.counters.staleDocumentsRepaired += 1;
      this.logger.warn(
        { pageId, reason },
        'open document was missing committed content; merging it from PostgreSQL',
      );
      try {
        await this.dependencies.catchUp(pageId);
      } catch (err) {
        this.logger.error(
          { pageId, err: { name: (err as Error).name } },
          'merge from PostgreSQL failed',
        );
      }
    }
  }

  /**
   * Step 2, through Redis: subscribe documents that loaded during an outage, then announce every
   * open document's state vector. A peer answers with the updates this instance lacks and
   * asks for the ones it lacks itself (the sync handshake of the extension).
   */
  private async announce(documents: Document[], reason: ResyncReason): Promise<void> {
    const inner = this.inner;
    if (inner === null) return;
    await this.dropStaleChannels();
    const late = documents.filter((document) => this.pendingSubscription.has(document.name));
    for (let i = 0; i < late.length; i += RESUBSCRIBE_CONCURRENCY) {
      await Promise.all(
        late.slice(i, i + RESUBSCRIBE_CONCURRENCY).map(async (document) => {
          // The extension's own load hook subscribes and announces; it is reused as it is.
          const payload = {
            documentName: document.name,
            document,
          } as unknown as afterLoadDocumentPayload;
          try {
            await withTimeout(
              inner.afterLoadDocument(payload),
              this.config.initialSyncTimeoutMs + LOAD_GRACE_MS,
            );
            this.pendingSubscription.delete(document.name);
            this.counters.lateSubscriptions += 1;
          } catch (err) {
            this.logger.warn(
              { documentName: document.name, reason, err: { name: (err as Error).name } },
              'could not subscribe the document to redis yet',
            );
          }
        }),
      );
    }
    for (const document of documents) {
      if (document.isDestroyed || this.pendingSubscription.has(document.name)) continue;
      // `onChange` of the extension publishes the document's state vector; a local origin is
      // what makes it do so (changes that came from Redis are not published again).
      const payload = {
        document,
        documentName: document.name,
        transactionOrigin: { source: 'local' },
      } as unknown as onChangePayload;
      await inner.onChange(payload);
    }
  }

  private scheduleResync(): void {
    const interval = this.config.resyncIntervalMs;
    if (interval <= 0 || !this.enabled) return;
    // ±10 % jitter so that instances do not all ask at the same moment.
    const delay = interval * (0.9 + Math.random() * 0.2);
    this.timer = setTimeout(() => {
      void this.resyncAll('interval')
        .catch((err: unknown) => {
          this.logger.error({ err: { name: (err as Error).name } }, 'periodic resync failed');
        })
        .finally(() => this.scheduleResync());
    }, delay);
    this.timer.unref();
  }
}
