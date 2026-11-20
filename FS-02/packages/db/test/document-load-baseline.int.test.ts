import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentStore, createPrismaClient, type PrismaClient } from '../src/index.js';
import { requireInfraEnv } from '../../../tests/helpers.js';
import {
  addParagraph,
  cleanupDocumentTestData,
  contentOf,
  createTestPage,
  textAt,
} from './document-test-support.js';

/**
 * PERF-06 baseline (docs/TESTING.md): how long `load` takes as the number of pending update rows
 * grows. It asserts only correctness; the timings are printed with the environment so they can
 * be recorded in docs/TESTING.md. No target exists yet and none is asserted.
 */
const { DATABASE_URL } = requireInfraEnv();
const ROW_COUNTS = [10, 100, 400];
const RUNS = 5;

let prisma: PrismaClient;
let store: DocumentStore;

beforeAll(() => {
  prisma = createPrismaClient(DATABASE_URL);
  store = new DocumentStore(prisma);
});

afterAll(async () => {
  await cleanupDocumentTestData(prisma);
  await prisma.$disconnect();
});

describe('PERF-06 baseline: document load time against pending update count', () => {
  it('measures load() for increasing numbers of unfolded rows', { timeout: 300_000 }, async () => {
    const results: Record<string, unknown>[] = [];
    for (const rows of ROW_COUNTS) {
      const pageId = await createTestPage(prisma);
      const doc = new Y.Doc();
      addParagraph(doc, 'baseline');
      await store.appendDiff(pageId, doc);
      for (let i = 1; i < rows; i += 1) {
        textAt(doc, 0).insert(textAt(doc, 0).length, 'x');
        await store.appendDiff(pageId, doc);
      }

      const timings: number[] = [];
      for (let run = 0; run < RUNS; run += 1) {
        const started = performance.now();
        const loaded = await store.load(pageId);
        timings.push(performance.now() - started);
        expect(loaded.appliedRows).toBe(rows);
        expect(contentOf(loaded.doc)).toBe(contentOf(doc));
      }
      const sorted = [...timings].sort((a, b) => a - b);
      const stored = await prisma.documentUpdate.findMany({
        where: { pageId },
        select: { update: true },
      });
      results.push({
        pendingRows: rows,
        runs: RUNS,
        loadMsMedian: Number((sorted[Math.floor(RUNS / 2)] as number).toFixed(1)),
        loadMsMin: Number((sorted[0] as number).toFixed(1)),
        loadMsMax: Number((sorted[RUNS - 1] as number).toFixed(1)),
        totalUpdateBytes: stored.reduce((sum, row) => sum + row.update.length, 0),
      });
    }
    process.stdout.write(
      `\nPERF-06 baseline ${JSON.stringify({
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        results,
      })}\n`,
    );
    expect(results).toHaveLength(ROW_COUNTS.length);
  });
});
