import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DependencyStatus } from '@conote/shared';
import { checkDatabase, createPrismaClient, type PrismaClient } from '@conote/db';
import { checkRedis, createRedisClient, createSubscriberClient } from './redis.js';

/** Runtime dependencies of the collab server. Tests can substitute their own. */
export interface Dependencies {
  prisma: PrismaClient;
  /** The Redis URL, for the cross-instance synchronization (it creates its own connections). */
  redisUrl: string;
  /** A new connection for subscribing to Redis channels (a subscribing connection can do nothing else). */
  createSubscriber(): Redis;
  /** Publish on a Redis channel (page events). Best effort: never throws. */
  publish(channel: string, message: string): Promise<void>;
  checkPostgres(): Promise<DependencyStatus>;
  checkRedis(): Promise<DependencyStatus>;
  close(): Promise<void>;
}

export function createDependencies(
  env: { DATABASE_URL: string; REDIS_URL: string },
  logger: Logger,
): Dependencies {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL);
  redis.on('error', (err: Error) => {
    logger.warn({ err: { name: err.name, message: err.message } }, 'redis connection error');
  });

  return {
    prisma,
    redisUrl: env.REDIS_URL,
    createSubscriber: () => {
      const subscriber = createSubscriberClient(env.REDIS_URL);
      subscriber.on('error', (err: Error) => {
        logger.warn({ err: { name: err.name, message: err.message } }, 'redis subscriber error');
      });
      return subscriber;
    },
    publish: async (channel, message) => {
      try {
        // The shared client connects lazily (and never queues offline): connect on first use.
        if (redis.status === 'wait') await redis.connect();
        await redis.publish(channel, message);
      } catch (err) {
        logger.warn({ err: { name: (err as Error).name }, channel }, 'redis publish failed');
      }
    },
    checkPostgres: () => checkDatabase(prisma),
    checkRedis: () => checkRedis(redis),
    close: async () => {
      await Promise.allSettled([
        prisma.$disconnect(),
        redis.quit().catch(() => redis.disconnect()),
      ]);
    },
  };
}
