import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { ACCESS_EVENTS_CHANNEL, type AccessEvent, type AccessEventType } from '@conote/shared';

type WarnLogger = Logger | { warn: (obj: object, msg: string) => void };

/**
 * Publish workspace/page access events (docs/WEBSOCKET_PROTOCOL.md §10, D22). Same contract
 * as `publishSessionRevoked`: best effort, at-most-once, never fails the request, because
 * correctness never depends on Redis (D14) and collaboration servers revalidate on an interval.
 * Call only AFTER the database transaction has committed.
 */
export async function publishAccessEvents(
  redis: Redis,
  logger: WarnLogger,
  events: readonly {
    type: Exclude<AccessEventType, 'session.revoked'>;
    workspaceId: string;
    userId?: string;
    pageId?: string;
    at: Date;
  }[],
): Promise<void> {
  for (const event of events) {
    const payload: AccessEvent = {
      v: 1,
      type: event.type,
      workspaceId: event.workspaceId,
      ...(event.userId === undefined ? {} : { userId: event.userId }),
      ...(event.pageId === undefined ? {} : { pageId: event.pageId }),
      at: event.at.toISOString(),
    };
    try {
      await redis.publish(ACCESS_EVENTS_CHANNEL, JSON.stringify(payload));
    } catch (err) {
      logger.warn(
        { err: { name: (err as Error).name, message: (err as Error).message } },
        `failed to publish ${event.type} access event`,
      );
    }
  }
}
