import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { PAGE_EVENTS_CHANNEL, type PageEvent } from '@conote/shared';

type WarnLogger = Logger | { warn: (obj: object, msg: string) => void };

/**
 * Publish a page event (`comments.changed`, docs/WEBSOCKET_PROTOCOL.md §10, D32). Same contract
 * as the access events: best effort, at-most-once, never fails the request, and called only after
 * the database transaction has committed. Clients refetch after a reconnect, so a lost event
 * costs a delay, not correctness (D14).
 */
export async function publishPageEvent(
  redis: Redis,
  logger: WarnLogger,
  event: { type: PageEvent['type']; pageId: string; at: Date },
): Promise<void> {
  const payload: PageEvent = {
    v: 1,
    type: event.type,
    pageId: event.pageId,
    at: event.at.toISOString(),
  };
  try {
    await redis.publish(PAGE_EVENTS_CHANNEL, JSON.stringify(payload));
  } catch (err) {
    logger.warn(
      { err: { name: (err as Error).name } },
      `failed to publish ${event.type} page event`,
    );
  }
}
