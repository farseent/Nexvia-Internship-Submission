import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDatabase, createPrismaClient, listExpectedMigrations } from '../src/index.js';
import { UNREACHABLE_DATABASE_URL, requireInfraEnv } from '../../../tests/helpers.js';

const { DATABASE_URL } = requireInfraEnv();

describe('checkDatabase (real PostgreSQL)', () => {
  it('is healthy on a migrated database', async () => {
    const prisma = createPrismaClient(DATABASE_URL);
    try {
      expect(await checkDatabase(prisma)).toBe('healthy');
    } finally {
      await prisma.$disconnect();
    }
  });

  it('is unavailable when PostgreSQL cannot be reached', async () => {
    const prisma = createPrismaClient(UNREACHABLE_DATABASE_URL);
    try {
      expect(await checkDatabase(prisma, { timeoutMs: 1500 })).toBe('unavailable');
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  });

  describe('schema compatibility', () => {
    const dbName = `conote_it_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: DATABASE_URL });
    const scratchUrl = (() => {
      const u = new URL(DATABASE_URL);
      u.pathname = `/${dbName}`;
      return u.toString();
    })();

    beforeAll(async () => {
      await admin.connect();
      await admin.query(`CREATE DATABASE ${dbName}`);
    });

    afterAll(async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    });

    it('is unavailable when the migration history table does not exist', async () => {
      const prisma = createPrismaClient(scratchUrl);
      try {
        expect(await checkDatabase(prisma)).toBe('unavailable');
      } finally {
        await prisma.$disconnect();
      }
    });

    it('is unavailable when a migration failed (started, not finished)', async () => {
      const scratch = new pg.Client({ connectionString: scratchUrl });
      await scratch.connect();
      await scratch.query(`CREATE TABLE "_prisma_migrations" (
        id VARCHAR(36) PRIMARY KEY NOT NULL, checksum VARCHAR(64) NOT NULL,
        finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT,
        rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
      await scratch.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ('1', 'x', 'broken')`,
      );
      await scratch.end();

      const prisma = createPrismaClient(scratchUrl);
      try {
        expect(await checkDatabase(prisma)).toBe('unavailable');
      } finally {
        await prisma.$disconnect();
      }
    });

    const migrationsTable = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        id VARCHAR(36) PRIMARY KEY NOT NULL, checksum VARCHAR(64) NOT NULL,
        finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT,
        rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_steps_count INTEGER NOT NULL DEFAULT 0)`;

    async function resetScratch(applied: string[]): Promise<void> {
      const scratch = new pg.Client({ connectionString: scratchUrl });
      await scratch.connect();
      await scratch.query(migrationsTable);
      await scratch.query('DELETE FROM "_prisma_migrations"');
      for (const [i, name] of applied.entries()) {
        await scratch.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at)
           VALUES ($1, 'x', $2, now())`,
          [String(i), name],
        );
      }
      await scratch.end();
    }

    async function statusOf(expected?: readonly string[]) {
      const prisma = createPrismaClient(scratchUrl);
      try {
        return await checkDatabase(prisma, expected ? { expectedMigrations: expected } : {});
      } finally {
        await prisma.$disconnect();
      }
    }

    it('is unavailable when a migration shipped with this build has not been applied', async () => {
      const [first, ...rest] = listExpectedMigrations();
      expect(rest.length).toBeGreaterThan(0); // baseline + at least the Phase 2 migration
      await resetScratch([first!]);
      expect(await statusOf()).toBe('unavailable');
    });

    it('is healthy when every shipped migration is applied, and tolerates newer extras', async () => {
      await resetScratch(listExpectedMigrations());
      expect(await statusOf()).toBe('healthy');
      await resetScratch([...listExpectedMigrations(), '29990101000000_from_a_newer_build']);
      expect(await statusOf()).toBe('healthy');
    });

    it('ignores rolled-back history rows when deciding what is applied', async () => {
      await resetScratch(listExpectedMigrations());
      const scratch = new pg.Client({ connectionString: scratchUrl });
      await scratch.connect();
      await scratch.query(`UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE id = '1'`);
      await scratch.end();
      expect(await statusOf()).toBe('unavailable');
    });
  });

  it('lists the migrations shipped with the package in order', () => {
    const names = listExpectedMigrations();
    expect(names[0]).toBe('20261111000000_baseline');
    expect(names).toContain('20261112120000_auth_users_sessions');
    expect([...names].sort()).toEqual(names);
  });
});
