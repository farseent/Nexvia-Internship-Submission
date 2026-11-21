import { Redis } from 'ioredis';
import type { DependencyStatus } from '@conote/shared';

/**
 * Create a Redis client. Redis is never permanent storage (D14): the client is
 * configured so that an outage does not crash the process or hang requests.
 */
export function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });
}

/**
 * A connection that only subscribes. Unlike the request/response client it queues commands
 * while connecting and retries for ever, so the subscription is restored after an outage
 * (ioredis resubscribes automatically).
 */
export function createSubscriberClient(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });
}

/** Redis health check: PING with a timeout. Never throws. */
export async function checkRedis(redis: Redis, timeoutMs = 1000): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<DependencyStatus>((resolve) => {
    timer = setTimeout(() => resolve('unavailable'), timeoutMs);
  });
  const ping = (async (): Promise<DependencyStatus> => {
    if (redis.status === 'wait') await redis.connect();
    const reply = await redis.ping();
    return reply === 'PONG' ? 'healthy' : 'unavailable';
  })().catch((): DependencyStatus => 'unavailable');
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Subscribe a subscriber connection without letting startup wait for Redis (Phase 9). The
 * connection queues the command while Redis is down and applies it, and every later
 * resubscription, when Redis is back; this only bounds how long the caller waits.
 * Returns false when the subscription was not confirmed in time.
 */
export async function subscribeWithin(
  subscriber: Redis,
  channel: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const subscribed = subscriber.subscribe(channel).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([subscribed, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
