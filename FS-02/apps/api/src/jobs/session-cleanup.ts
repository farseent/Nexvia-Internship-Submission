import type { PrismaClient } from '@conote/db';
import type { Clock } from '../config.js';

/** Sessions stay this long after revocation/expiry before deletion (audit and debugging window). */
export const SESSION_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Delete sessions revoked or expired more than `graceMs` ago. Returns the number deleted. */
export async function cleanupSessions(
  prisma: PrismaClient,
  now: Date,
  graceMs: number = SESSION_CLEANUP_GRACE_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - graceMs);
  const result = await prisma.session.deleteMany({
    where: {
      OR: [
        { revokedAt: { lt: cutoff } },
        { expiresAt: { lt: cutoff } },
        { absoluteExpiresAt: { lt: cutoff } },
      ],
    },
  });
  return result.count;
}

interface JobLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * Run the cleanup now and then on an interval. Safe with several API instances:
 * deleting already-deleted rows is a no-op. Returns a function that stops the job.
 */
export function startSessionCleanup(options: {
  prisma: PrismaClient;
  clock: Clock;
  logger: JobLogger;
  intervalMs?: number;
}): () => void {
  const run = async (): Promise<void> => {
    try {
      const deleted = await cleanupSessions(options.prisma, options.clock());
      options.logger.info({ deleted }, 'session cleanup finished');
    } catch (err) {
      options.logger.warn({ err: { message: (err as Error).message } }, 'session cleanup failed');
    }
  };
  void run();
  const timer = setInterval(() => void run(), options.intervalMs ?? SESSION_CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
