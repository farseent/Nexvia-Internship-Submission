import type { Document } from '@hocuspocus/server';
import type { Logger } from 'pino';
import { sanitizeClientAwareness } from '@conote/shared';
import type { Clock } from './config.js';
import type { CollabContext, ConnectionRegistry } from './connection-registry.js';

/** Log every Nth dropped awareness item of one connection, plus the first. */
const DROPPED_LOG_EVERY = 100;

export interface PresenceGuardOptions {
  /** Awareness messages one connection may send per second; the excess is dropped. */
  maxAwarenessPerSecond: number;
}

/**
 * Identity binding for presence (docs/WEBSOCKET_PROTOCOL.md §18, D61).
 *
 * Awareness is client-supplied, so the server never relays it as it came. For every inbound
 * awareness update, from an authenticated connection only:
 *
 *  1. a connection may publish presence for exactly one Yjs client id (the first it uses);
 *     states for any other id, and removals of any other id, are dropped, so it can neither
 *     speak for another client nor erase another person's presence;
 *  2. the relayed state is rebuilt: `user` is the identity the server built for this
 *     connection (from the verified token and PostgreSQL), the cursor is the only client
 *     field kept and only when it is well formed (`sanitizeClientAwareness`);
 *  3. a connection that floods awareness has the excess dropped (the overall message limit
 *     still closes a connection that floods anything at all).
 *
 * Read-only roles (VIEWER, COMMENTER) publish presence like everyone else: it changes no
 * document content, and the plan (U4/V3, AC-7.5) shows them as collaborators.
 */
export class PresenceGuard {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: PresenceGuardOptions,
  ) {}

  /**
   * Rewrite `states` and `removedClients` (the mutable collections Hocuspocus passes to
   * `beforeHandleAwareness`) so that only what this connection may say remains.
   */
  apply(input: {
    context: CollabContext;
    document: Document;
    states: Map<number, Record<string, unknown>>;
    removedClients: Set<number>;
  }): void {
    const { context, document, states, removedClients } = input;

    if (!this.allowMessage(context)) {
      this.drop(context, states.size + removedClients.size, 'awareness rate exceeded');
      states.clear();
      removedClients.clear();
      return;
    }

    for (const [clientId, raw] of [...states]) {
      const claim = this.registry.claimAwareness(context, clientId);
      if (!claim.ok) {
        states.delete(clientId);
        this.drop(context, 1, 'awareness for a client id this connection does not own');
        continue;
      }
      if (claim.previous?.connection !== undefined && context.connection !== undefined) {
        // A reconnection took the client id over from its stale connection: Hocuspocus
        // removes a connection's ids from the document when it closes, and it must not take
        // the new connection's presence with it.
        document.connections.get(claim.previous.connection)?.clients.delete(clientId);
        document.connections.get(context.connection)?.clients.add(clientId);
      }
      states.set(clientId, { ...sanitizeClientAwareness(raw, context.identity) });
    }

    for (const clientId of [...removedClients]) {
      if (this.registry.ownsAwareness(context, clientId)) continue;
      removedClients.delete(clientId);
      this.drop(context, 1, 'removal of presence this connection does not own');
    }
  }

  /** A fixed one-second window, like the overall message limit. */
  private allowMessage(context: CollabContext): boolean {
    const now = this.clock().getTime();
    if (now - context.awarenessWindowStartedAt >= 1000) {
      context.awarenessWindowStartedAt = now;
      context.awarenessWindowCount = 0;
    }
    context.awarenessWindowCount += 1;
    return context.awarenessWindowCount <= this.options.maxAwarenessPerSecond;
  }

  private drop(context: CollabContext, count: number, why: string): void {
    context.awarenessDropped += count;
    if (
      context.awarenessDropped - count > 0 &&
      context.awarenessDropped % DROPPED_LOG_EVERY >= count
    )
      return;
    this.logger.warn(
      { userId: context.userId, pageId: context.pageId, dropped: context.awarenessDropped },
      `ignored presence: ${why}`,
    );
  }
}
