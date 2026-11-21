import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { Server, isTransactionOrigin, type Document, type Extension } from '@hocuspocus/server';
import type { Logger } from 'pino';
import { DocumentStore } from '@conote/db';
import {
  COLLAB_CLOSE,
  evaluateCollabReadiness,
  parseClientCommand,
  parseClientEnvelope,
  type Liveness,
  type Readiness,
} from '@conote/shared';
import { AccessController, isRefusal } from './access-control.js';
import { AccessEventListener } from './access-events.js';
import { ClusterSync } from './cluster.js';
import type { Clock, CollabConfig } from './config.js';
import { ConnectionRegistry, type CollabContext } from './connection-registry.js';
import type { Dependencies } from './dependencies.js';
import { DocumentPersistence, type PersistenceOptions } from './persistence.js';
import { PageEventListener } from './page-events.js';
import { PresenceGuard } from './presence.js';
import { PeriodicRevalidation } from './revalidation.js';
import { TokenVerifier } from './token-verifier.js';
import { VersionService, isCollabContext, type VersionHooks } from './versions.js';
import { classifyInbound } from './wire-messages.js';

const SERVICE = 'collab';

/** Invalid application messages tolerated on one connection before it is closed (§11). */
const MAX_APP_VIOLATIONS = 5;
/** Log every Nth dropped write of a read-only connection, plus the first. */
const DROPPED_WRITE_LOG_EVERY = 100;

export interface BuildServerOptions {
  config: CollabConfig;
  logger: Logger;
  dependencies: Dependencies;
  clock?: Clock;
  persistence?: Partial<Pick<PersistenceOptions, 'retryDelayMs'>>;
  /** Test hooks for fault injection (Phase 8). */
  versionHooks?: VersionHooks;
}

export interface CollabServer {
  readonly server: Server<CollabContext>;
  readonly registry: ConnectionRegistry;
  readonly access: AccessController;
  readonly persistence: DocumentPersistence;
  readonly events: AccessEventListener;
  readonly revalidation: PeriodicRevalidation;
  readonly presence: PresenceGuard;
  readonly versions: VersionService;
  readonly pageEvents: PageEventListener;
  /** Cross-instance synchronization through Redis (Phase 9); a no-op object when disabled. */
  readonly cluster: ClusterSync;
  /** Port actually bound (useful with port 0). */
  readonly port: number;
  start(): Promise<void>;
  /** Graceful shutdown: refuse new connections, store everything, tell and close clients. */
  stop(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/**
 * The collaboration server (docs/ARCHITECTURE.md §7, docs/WEBSOCKET_PROTOCOL.md): Hocuspocus
 * with CoNote's hooks.
 *
 *  - every document connection is authenticated with a collaboration token and authorized from
 *    PostgreSQL before the document is even loaded;
 *  - read-only roles are enforced by the server, not by the editor;
 *  - the document is stored through `DocumentStore` (debounced, retried, compacted);
 *  - open connections are revalidated on access events and on a timer.
 * Hocuspocus accepts everything unless a hook refuses, so the refusals live in the hooks below.
 */
export function buildCollabServer(options: BuildServerOptions): CollabServer {
  const { config, logger, dependencies } = options;
  const clock: Clock = options.clock ?? (() => new Date());
  const registry = new ConnectionRegistry();
  const verifier = new TokenVerifier(config.publicKeys, clock);
  const access = new AccessController(
    dependencies.prisma,
    registry,
    verifier,
    config,
    clock,
    logger,
  );
  const persistence = new DocumentPersistence(
    dependencies.prisma,
    new DocumentStore(dependencies.prisma),
    logger,
    { compactUpdateCount: config.compactUpdateCount, ...options.persistence },
  );
  const events = new AccessEventListener(dependencies.createSubscriber(), registry, access, logger);
  const revalidation = new PeriodicRevalidation(
    registry,
    access,
    config.revalidateIntervalMs,
    logger,
  );
  const presence = new PresenceGuard(registry, clock, logger, {
    maxAwarenessPerSecond: config.maxAwarenessPerSecond,
  });
  const allowedOrigins = new Set(config.allowedOrigins);
  let stopping = false;
  // The Hocuspocus instance exists only after the hooks below; the version service reaches it lazily.
  const versions: VersionService = new VersionService(
    dependencies.prisma,
    new DocumentStore(dependencies.prisma),
    persistence,
    registry,
    access,
    config,
    clock,
    logger,
    () => server.hocuspocus,
    (channel, message) => dependencies.publish(channel, message),
    options.versionHooks,
  );
  const pageEvents = new PageEventListener(dependencies.createSubscriber(), versions, logger);
  const cluster: ClusterSync = new ClusterSync(
    config.cluster,
    {
      redisUrl: dependencies.redisUrl,
      store: new DocumentStore(dependencies.prisma),
      catchUp: (pageId) => versions.catchUp(pageId),
    },
    logger.child({ component: 'cluster', instanceId: config.cluster.instanceId }),
  );

  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      const body: Liveness = { status: 'ok', service: SERVICE };
      sendJson(response, 200, body);
      return;
    }
    if (request.method === 'GET' && path === '/ready') {
      const [postgres, redis] = await Promise.all([
        dependencies.checkPostgres(),
        dependencies.checkRedis(),
      ]);
      const status = evaluateCollabReadiness({ postgres, redis });
      const body: Readiness = { status, service: SERVICE, dependencies: { postgres, redis } };
      sendJson(response, status === 'not_ready' || stopping ? 503 : 200, body);
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  }

  const hooks: Extension<CollabContext> = {
    extensionName: 'conote-collab',

    /** `Origin` allow-list (D25). Browsers always send it; a missing header means a non-browser client. */
    async onUpgrade({ request, socket }) {
      const origin = request.headers.origin;
      if (origin !== undefined && !allowedOrigins.has(origin)) {
        logger.warn({ origin }, 'refused: origin not allowed');
        rejectUpgrade(socket, 403, 'Forbidden');
      }
      if (stopping) rejectUpgrade(socket, 503, 'Service Unavailable');
    },

    async onRequest({ request, response }) {
      try {
        await handleHttp(request, response);
      } catch (err) {
        logger.error({ err: { name: (err as Error).name } }, 'http handler failed');
        if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
      }
      // Hocuspocus treats a falsy throw as "response already handled".
      throw null;
    },

    /**
     * Runs for every document the client opens, before anything is loaded. A thrown refusal
     * is sent to the client as the reason and no document connection exists afterwards.
     */
    async onAuthenticate({ token, documentName, socketId, connectionConfig }) {
      if (stopping) throw { reason: 'TRY_AGAIN_LATER' };
      const { context, release } = await access.authenticate(token, documentName, socketId);
      context.release = release;
      connectionConfig.readOnly = context.readOnly;
      return context;
    },

    async connected({ context, connection, documentName, socketId }) {
      context.connection = connection;
      registry.add(context);
      context.release?.();
      context.release = undefined;
      logger.info(
        {
          socketId,
          documentName,
          userId: context.userId,
          role: context.role,
          readOnly: context.readOnly,
          connections: registry.size,
        },
        'connection opened',
      );
    },

    async onLoadDocument({ documentName }) {
      return persistence.load(documentName);
    },

    /**
     * Every inbound message passes here before it is applied. A revoked connection is dropped,
     * a flooding one is closed, and writes by a read-only connection are counted (the library
     * itself refuses to apply them).
     */
    async beforeHandleMessage({ context, update }) {
      if (context.revoked) throw new Error('connection revoked');
      if (!registry.allowMessage(context, clock().getTime(), config.maxMessagesPerSecond)) {
        logger.warn({ userId: context.userId, pageId: context.pageId }, 'message rate exceeded');
        access.close(context, COLLAB_CLOSE.RATE_LIMITED);
        throw new Error('rate limited');
      }
      if (classifyInbound(update) === 'sync-write' && versions.isRestoring(context.pageId)) {
        // A restore is running (D62): Hocuspocus drops writes of a read-only connection and tells
        // the client they were not applied. The restore end puts each connection back to its role.
        if (context.connection) context.connection.readOnly = true;
      }
      if (context.readOnly && classifyInbound(update) === 'sync-write') {
        context.droppedWrites += 1;
        if (context.droppedWrites % DROPPED_WRITE_LOG_EVERY === 1) {
          logger.warn(
            {
              userId: context.userId,
              pageId: context.pageId,
              role: context.role,
              dropped: context.droppedWrites,
            },
            'ignored a document update from a read-only connection',
          );
        }
      }
    },

    /**
     * Presence (Phase 7, WEBSOCKET_PROTOCOL §18). Awareness is client-supplied and untrusted:
     * `PresenceGuard` rebuilds every relayed state from the connection's server-built identity
     * and the validated cursor, and binds each connection to its own awareness client id.
     * Nothing here is stored: awareness never reaches `DocumentStore`.
     */
    async beforeHandleAwareness({ context, document, states, removedClients }) {
      if (context === undefined) return; // not from a client connection
      if (context.revoked) throw new Error('connection revoked');
      presence.apply({ context, document, states, removedClients });
    },

    /**
     * Application messages (WEBSOCKET_PROTOCOL §7). Phase 8 registers `version.create` and
     * `version.restore`; anything else is refused and counted as a violation.
     */
    async onStateless({ connection, document, payload }) {
      const context = connection.context as CollabContext;
      const envelope = parseClientEnvelope(payload);
      const parsed = envelope === null ? null : parseClientCommand(envelope);
      if (envelope === null || parsed === null || !parsed.ok) {
        context.violations += 1;
        logger.warn(
          { userId: context.userId, pageId: context.pageId, valid: envelope !== null },
          'rejected an application message',
        );
        access.send(context, {
          v: 1,
          type: 'error',
          ...(envelope?.id === undefined ? {} : { replyTo: envelope.id }),
          payload: { code: 'INVALID_MESSAGE', message: 'This message is not supported.' },
        });
        if (context.violations >= MAX_APP_VIOLATIONS)
          access.close(context, COLLAB_CLOSE.PROTOCOL_VIOLATION);
        return;
      }
      const command = parsed.command;
      const outcome =
        command.type === 'version.create'
          ? await versions.create(context, document as Document, command)
          : await versions.restore(context, document as Document, command);
      const replyTo = command.id === undefined ? {} : { replyTo: command.id };
      access.send(
        context,
        outcome.ok
          ? { v: 1, type: 'response', ...replyTo, payload: { ok: true, result: outcome.result } }
          : {
              v: 1,
              type: 'error',
              ...replyTo,
              payload: { code: outcome.code, message: outcome.message },
            },
      );
    },

    /** An accepted change by a client: logged for contributors, and the page is marked changed. */
    async onChange({ context, documentName, transactionOrigin }) {
      if (isCollabContext(context)) versions.recordEdit(context);
      // Persistence lag (PERF-05) counts changes this instance took, not those relayed to it.
      if (!isTransactionOrigin(transactionOrigin) || transactionOrigin.source !== 'redis') {
        persistence.noteChange(documentName);
      }
    },

    async onStoreDocument({ documentName, document, instance, ...payload }) {
      // A store scheduled because a change arrived from another instance (D65).
      const replicated =
        isTransactionOrigin(payload.lastTransactionOrigin) &&
        payload.lastTransactionOrigin.source === 'redis';
      try {
        await persistence.persist(documentName, document, { replicated });
        // The instance that took the edit takes the automatic snapshot.
        if (!replicated) await versions.autoSnapshotIfDue(documentName, document);
      } catch (err) {
        logger.error(
          {
            documentName,
            err: { name: (err as Error).name },
            failing: persistence.failingDocuments + 1,
          },
          'storing the document failed; it stays in memory and will be retried',
        );
        persistence.scheduleRetry(documentName, () => {
          if (instance.documents.get(documentName) !== document) return;
          void instance.storeDocumentHooks(document, {
            ...payload,
            documentName,
            document,
            instance,
          });
        });
        throw err;
      }
    },

    async beforeUnloadDocument({ documentName, document }) {
      await versions.autoSnapshotOnUnload(documentName, document);
    },

    async afterUnloadDocument({ documentName }) {
      await persistence.compactOnUnload(documentName);
    },

    async onDisconnect({ context, documentName, socketId, clientsCount }) {
      if (!isCollabContext(context)) return; // a direct (server-side) connection, not a client
      context.release?.();
      context.release = undefined;
      registry.remove(context);
      logger.info(
        {
          socketId,
          documentName,
          userId: context.userId,
          remainingOnDocument: clientsCount,
          connections: registry.size,
        },
        'connection closed',
      );
    },
  };

  const server: Server<CollabContext> = new Server<CollabContext>({
    name: `conote-${SERVICE}`,
    port: config.port,
    address: config.address,
    quiet: true,
    stopOnSignals: false,
    timeout: config.connectionTimeoutMs,
    debounce: config.storeDebounceMs,
    maxDebounce: config.storeMaxDebounceMs,
    unloadImmediately: false,
    websocketOptions: { maxPayload: config.maxPayloadBytes },
    extensions: cluster.extension === undefined ? [hooks] : [cluster.extension, hooks],
  });

  async function waitForStores(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const { hocuspocus } = server;
    for (;;) {
      const busy = [...hocuspocus.documents.values()].some(
        (document) =>
          hocuspocus.debouncer.isDebounced(`onStoreDocument-${document.name}`) ||
          hocuspocus.debouncer.isCurrentlyExecuting(`onStoreDocument-${document.name}`) ||
          document.saveMutex.isLocked(),
      );
      if (!busy) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  return {
    server,
    registry,
    access,
    persistence,
    events,
    revalidation,
    presence,
    versions,
    pageEvents,
    cluster,
    get port() {
      return server.address.port;
    },

    async start() {
      await verifier.assertKeysUsable();
      await server.listen();
      // Each waits a bounded time for Redis; do the waits side by side, not one after another.
      await Promise.all([events.start(), pageEvents.start(), cluster.start()]);
      revalidation.start();
      logger.info(
        {
          port: server.address.port,
          cluster: cluster.status,
          instanceId: config.cluster.instanceId,
        },
        'collab server listening',
      );
    },

    async stop() {
      if (stopping) return;
      stopping = true;
      logger.info({ connections: registry.size }, 'collab server stopping');
      revalidation.stop();
      for (const context of registry.snapshot()) {
        access.send(context, { v: 1, type: 'server.shutting_down', payload: {} });
      }
      // Durability first: store every changed document before any client is disconnected.
      server.hocuspocus.flushPendingStores();
      const stored = await waitForStores(config.shutdownTimeoutMs);
      if (!stored) {
        logger.error(
          { failing: persistence.failingDocuments },
          'some documents could not be stored before shutdown; their latest changes survive only in clients',
        );
      }
      for (const context of registry.snapshot())
        access.close(context, COLLAB_CLOSE.SERVER_RESTARTING);
      await events.stop();
      await pageEvents.stop();
      persistence.stop();
      // Hocuspocus waits for every document to unload; one whose store keeps failing never does.
      // Bound the wait: the process is about to exit, and the error above says what was at risk.
      const destroyed = await Promise.race([
        server.destroy().then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), config.shutdownTimeoutMs).unref(),
        ),
      ]);
      if (!destroyed) logger.error('server did not shut down cleanly within the timeout');
    },
  };
}

/** Refuse a WebSocket upgrade with an HTTP status, then stop Hocuspocus from going on. */
function rejectUpgrade(socket: Duplex, status: number, text: string): never {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
  // Hocuspocus rethrows only truthy errors, so a falsy throw ends the upgrade quietly.
  throw null;
}

export { isRefusal };
