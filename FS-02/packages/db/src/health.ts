import type { DependencyStatus } from '@conote/shared';
import type { PrismaClient } from './client.js';
import { listExpectedMigrations } from './migrations.js';

export interface DatabaseCheckOptions {
  /** Upper bound for the whole check, in milliseconds. */
  timeoutMs?: number;
  /** Migrations this build requires. Defaults to the migrations shipped with the package. */
  expectedMigrations?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 2000;

interface MigrationRow {
  migration_name: string;
  failed: boolean;
}

async function runChecks(
  prisma: PrismaClient,
  expectedMigrations: readonly string[],
): Promise<DependencyStatus> {
  await prisma.$queryRaw`SELECT 1`;

  // Schema compatibility: the migration history table must exist, contain no failed
  // (started but unfinished, not rolled back) migration, and include every migration
  // this build ships. Extra applied migrations (a newer schema) are tolerated.
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name,
           (finished_at IS NULL AND rolled_back_at IS NULL) AS failed
    FROM "_prisma_migrations"
    WHERE rolled_back_at IS NULL`;
  if (rows.some((row) => row.failed)) return 'unavailable';
  const applied = new Set(rows.map((row) => row.migration_name));
  return expectedMigrations.every((name) => applied.has(name)) ? 'healthy' : 'unavailable';
}

/**
 * PostgreSQL readiness check: reachable AND schema-compatible.
 * Returns `unavailable` on any error or timeout; never throws, never leaks details.
 *
 * Compatibility (D35, completed in Phase 2): the migration history exists, has no failed
 * migration, and contains every migration shipped with this build.
 */
export async function checkDatabase(
  prisma: PrismaClient,
  options: DatabaseCheckOptions = {},
): Promise<DependencyStatus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<DependencyStatus>((resolve) => {
    timer = setTimeout(() => resolve('unavailable'), timeoutMs);
  });
  try {
    return await Promise.race([
      runChecks(prisma, options.expectedMigrations ?? listExpectedMigrations()),
      timeout,
    ]);
  } catch {
    return 'unavailable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
