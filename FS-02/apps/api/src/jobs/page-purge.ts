import type { PrismaClient } from '@conote/db';
import { PAGE_RETENTION_DAYS } from '@conote/shared';
import type { Clock } from '../config.js';

export const PAGE_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Permanently delete pages that have been in the trash longer than the retention period
 * (D24, 30 days). Deleting a page cascades to its descendants, overrides and (in later
 * phases) its document data. Returns the number of pages removed by the statement.
 */
export async function purgeExpiredPages(
  prisma: PrismaClient,
  now: Date,
  retentionDays: number = PAGE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const result = await prisma.page.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  return result.count;
}

interface JobLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/** Run the purge now and then on an interval; safe with several API instances (idempotent). */
export function startPagePurge(options: {
  prisma: PrismaClient;
  clock: Clock;
  logger: JobLogger;
  intervalMs?: number;
}): () => void {
  const run = async (): Promise<void> => {
    try {
      const purged = await purgeExpiredPages(options.prisma, options.clock());
      options.logger.info({ purged }, 'page purge finished');
    } catch (err) {
      options.logger.warn({ err: { message: (err as Error).message } }, 'page purge failed');
    }
  };
  void run();
  const timer = setInterval(() => void run(), options.intervalMs ?? PAGE_PURGE_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
