import { subscribeWithin } from './redis.js';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { ACCESS_EVENTS_CHANNEL, accessEventSchema, type AccessEvent } from '@conote/shared';
import type { AccessController } from './access-control.js';
import type { CollabContext, ConnectionRegistry } from './connection-registry.js';

/** The open connections an access event can affect (docs/WEBSOCKET_PROTOCOL.md §10). */
export function connectionsAffectedBy(
  registry: ConnectionRegistry,
  event: AccessEvent,
): CollabContext[] {
  switch (event.type) {
    case 'session.revoked':
      return registry.matching(
        (c) =>
          (event.sessionId !== undefined && c.sessionId === event.sessionId) ||
          (event.sessionId === undefined &&
            event.userId !== undefined &&
            c.userId === event.userId),
      );
    case 'member.role_changed':
    case 'member.removed':
      return registry.matching(
        (c) =>
          c.workspaceId === event.workspaceId &&
          (event.userId === undefined || c.userId === event.userId),
      );
    case 'workspace.deleted':
      return registry.matching((c) => c.workspaceId === event.workspaceId);
    case 'page.access_changed':
      // A permission on a page changes the role on all its descendants, and a move changes
      // the ancestors: the workspace's connections (of the user, when named) are rechecked.
      return registry.matching(
        (c) =>
          c.workspaceId === event.workspaceId &&
          (event.userId === undefined || c.userId === event.userId),
      );
  }
}

/**
 * Subscribes to access events and revalidates the connections they affect. Delivery is
 * at-most-once; the periodic revalidation is the safety net for a lost event (D22, G6).
 */
export class AccessEventListener {
  constructor(
    private readonly subscriber: Redis,
    private readonly registry: ConnectionRegistry,
    private readonly access: AccessController,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel === ACCESS_EVENTS_CHANNEL) void this.handle(raw);
    });
    // Redis may be down at startup: the subscription is queued and applied when it is back.
    if (!(await subscribeWithin(this.subscriber, ACCESS_EVENTS_CHANNEL))) {
      this.logger.warn(
        'could not subscribe to access events yet; periodic revalidation still applies',
      );
    }
  }

  async stop(): Promise<void> {
    this.subscriber.removeAllListeners('message');
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }

  /** Exposed for tests. */
  async handle(raw: string): Promise<void> {
    let event: AccessEvent;
    try {
      const parsed = accessEventSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        this.logger.warn('ignored a malformed access event');
        return;
      }
      event = parsed.data;
    } catch {
      this.logger.warn('ignored an access event that is not JSON');
      return;
    }
    const affected = connectionsAffectedBy(this.registry, event);
    if (affected.length === 0) return;
    try {
      const result = await this.access.revalidate(
        affected,
        event.type === 'workspace.deleted' ? 'WORKSPACE_DELETED' : undefined,
      );
      this.logger.info({ type: event.type, ...result }, 'access event handled');
    } catch (err) {
      this.logger.error(
        { type: event.type, err: { name: (err as Error).name } },
        'access event failed',
      );
    }
  }
}
