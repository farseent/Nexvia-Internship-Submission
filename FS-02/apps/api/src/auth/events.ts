import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import { ACCESS_EVENTS_CHANNEL, type AccessEvent } from '@conote/shared';

/**
 * Publish a `session.revoked` access event (docs/WEBSOCKET_PROTOCOL.md §10, D22).
 * Best effort: Redis pub/sub is at-most-once and correctness never depends on it
 * (D14); collaboration servers also revalidate on an interval (G6). A Redis outage
 * must not fail a logout or a revocation, so failures are logged and swallowed.
 */
export async function publishSessionRevoked(
  redis: Redis,
  logger: Logger | { warn: (obj: object, msg: string) => void },
  event: { userId: string; sessionId: string; at: Date },
): Promise<void> {
  const payload: AccessEvent = {
    v: 1,
    type: 'session.revoked',
    userId: event.userId,
    sessionId: event.sessionId,
    at: event.at.toISOString(),
  };
  try {
    await redis.publish(ACCESS_EVENTS_CHANNEL, JSON.stringify(payload));
  } catch (err) {
    logger.warn(
      { err: { name: (err as Error).name, message: (err as Error).message } },
      'failed to publish session.revoked access event',
    );
  }
}
