import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DependencyStatus } from '@conote/shared';
import { checkDatabase, createPrismaClient, type PrismaClient } from '@conote/db';
import { checkRedis, createRedisClient, createSubscriberClient } from './redis.js';

/** Runtime dependencies of the collab server. Tests can substitute their own. */
export interface Dependencies {
  prisma: PrismaClient;
  /** A new connection for subscribing to Redis channels (a subscribing connection can do nothing else). */
  createSubscriber(): Redis;
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
    createSubscriber: () => {
      const subscriber = createSubscriberClient(env.REDIS_URL);
      subscriber.on('error', (err: Error) => {
        logger.warn({ err: { name: err.name, message: err.message } }, 'redis subscriber error');
      });
      return subscriber;
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
