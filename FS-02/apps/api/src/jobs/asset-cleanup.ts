import type { PrismaClient } from '@conote/db';
import { ASSET_PENDING_GRACE_HOURS } from '@conote/shared';
import type { Clock } from '../config.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';

export const ASSET_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BATCH_SIZE = 200;

/**
 * Remove images nobody can reach: uploads that were never confirmed within the grace period,
 * and page images whose page was purged (`pageId` was set to null). The object goes first,
 * then the row, so a failure leaves a row to retry on the next run instead of an orphaned
 * file. Returns the number of assets removed. Images that were uploaded but later deleted
 * from their document are not detected: that needs a scan of document content (Phase 5+).
 */
export async function cleanupAssets(
  prisma: PrismaClient,
  storage: StorageAdapter,
  now: Date,
  graceHours: number = ASSET_PENDING_GRACE_HOURS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - graceHours * HOUR_MS);
  const stale = await prisma.asset.findMany({
    where: {
      OR: [
        { status: 'PENDING', createdAt: { lt: cutoff } },
        { purpose: 'PAGE_IMAGE', pageId: null },
      ],
    },
    select: { id: true, objectKey: true },
    take: BATCH_SIZE,
  });
  let removed = 0;
  for (const asset of stale) {
    try {
      await storage.delete(asset.objectKey);
      await prisma.asset.delete({ where: { id: asset.id } });
      removed += 1;
    } catch {
      // Leave the row; the next run tries again.
    }
  }
  return removed;
}

interface JobLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/** Run the cleanup now and then on an interval; safe with several API instances (idempotent). */
export function startAssetCleanup(options: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  clock: Clock;
  logger: JobLogger;
  intervalMs?: number;
}): () => void {
  const run = async (): Promise<void> => {
    try {
      const removed = await cleanupAssets(options.prisma, options.storage, options.clock());
      options.logger.info({ removed }, 'asset cleanup finished');
    } catch (err) {
      options.logger.warn({ err: { message: (err as Error).message } }, 'asset cleanup failed');
    }
  };
  void run();
  const timer = setInterval(() => void run(), options.intervalMs ?? ASSET_CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
