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
 * Resolve once the client is ready. With `enableOfflineQueue: false` a command issued
 * while the client is still connecting is rejected, so callers wait first.
 */
export async function waitUntilReady(redis: Redis, timeoutMs: number): Promise<void> {
  if (redis.status === 'wait') await redis.connect();
  const deadline = Date.now() + timeoutMs;
  while (redis.status !== 'ready') {
    if (redis.status === 'end' || Date.now() >= deadline) throw new Error('redis is not ready');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Redis health check: PING with a timeout. Never throws. */
export async function checkRedis(redis: Redis, timeoutMs = 1000): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<DependencyStatus>((resolve) => {
    timer = setTimeout(() => resolve('unavailable'), timeoutMs);
  });
  const ping = (async (): Promise<DependencyStatus> => {
    await waitUntilReady(redis, timeoutMs);
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
 * True for errors raised because Redis cannot be reached (connection refused, closed
 * stream, offline-queue rejection, command timeout). Security-sensitive features that
 * need Redis (rate limiting) fail closed with 503 on these (docs/ARCHITECTURE.md §10.4).
 */
export function isRedisUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'MaxRetriesPerRequestError') return true;
  const code = (err as { code?: unknown }).code;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') return true;
  return /Connection is closed|Stream isn't writeable|Command timed out|connect ETIMEDOUT/i.test(
    err.message,
  );
}

/** Begin connecting in the background; failures are retried by the client's retry strategy. */
export function connectInBackground(redis: Redis): void {
  if (redis.status === 'wait') redis.connect().catch(() => undefined);
}
