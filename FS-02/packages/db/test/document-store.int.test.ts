import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mergeStateVectors, stateVectorCovers, stateVectorsEqual } from '@conote/shared';
import {
  DocumentPageNotFoundError,
  DocumentStore,
  createPrismaClient,
  type PrismaClient,
} from '../src/index.js';
import { requireInfraEnv } from '../../../tests/helpers.js';
import {
  addParagraph,
  cleanupDocumentTestData,
  contentOf,
  createTestPage,
  expectSameDocument,
  mulberry32,
  randomEdit,
  textAt,
} from './document-test-support.js';

/**
 * The Yjs document store against real PostgreSQL (docs/DATABASE_SCHEMA.md §7, D15).
 * Evidence for G1, G2 and G4 (docs/ARCHITECTURE.md §8.5).
 */
const { DATABASE_URL } = requireInfraEnv();

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

const rowCount = (pageId: string) => prisma.documentUpdate.count({ where: { pageId } });
const stateRow = (pageId: string) => prisma.documentState.findUniqueOrThrow({ where: { pageId } });

// ───────────── initialization ─────────────

describe('initialization of an empty document', () => {
  it('loads a page without stored data as an empty document', async () => {
    const pageId = await createTestPage(prisma);
    const loaded = await store.load(pageId);
    expect(loaded.exists).toBe(false);
    expect(loaded.appliedRows).toBe(0);
    expect(loaded.foldedSeq).toBe(0n);
    expect(Y.decodeStateVector(Y.encodeStateVector(loaded.doc)).size).toBe(0);
  });

  it('storing an empty document writes no update row', async () => {
    const pageId = await createTestPage(prisma);
    const result = await store.appendDiff(pageId, new Y.Doc());
    expect(result).toMatchObject({ stored: false, seq: null, bytes: 0, pendingRows: 0 });
    expect(await rowCount(pageId)).toBe(0);
  });

  it('creates the state row lazily, and only for a page that exists', async () => {
    const pageId = await createTestPage(prisma);
    expect(await prisma.documentState.count({ where: { pageId } })).toBe(0);
    await store.appendDiff(pageId, new Y.Doc());
    expect(await prisma.documentState.count({ where: { pageId } })).toBe(1);

    await expect(
      store.appendDiff('00000000-0000-4000-8000-000000000000', new Y.Doc()),
    ).rejects.toBeInstanceOf(DocumentPageNotFoundError);
  });

  it('seeds a never-stored document once, even when several processes try at the same time', async () => {
    const pageId = await createTestPage(prisma);
    const seeds = Array.from({ length: 5 }, () => {
      const seed = new Y.Doc(); // each has its own client id, as separate processes would
      addParagraph(seed, 'seeded content');
      return seed;
    });
    const results = await Promise.all(seeds.map((seed) => store.seedIfEmpty(pageId, seed)));
    expect(results.filter((r) => r.seeded)).toHaveLength(1);

    const loaded = await store.load(pageId);
    expect(loaded.doc.getXmlFragment('default').length).toBe(1);
    expect(contentOf(loaded.doc).match(/seeded content/g)).toHaveLength(1);
    expect((await store.seedIfEmpty(pageId, seeds[0] as Y.Doc)).seeded).toBe(false);
  });

  it('does not seed a document that was stored and then emptied', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'x');
    await store.appendDiff(pageId, doc);
    doc.getXmlFragment('default').delete(0, 1);
    await store.appendDiff(pageId, doc);

    const seed = new Y.Doc();
    addParagraph(seed, 'should not appear');
    expect((await store.seedIfEmpty(pageId, seed)).seeded).toBe(false);
    expect(contentOf((await store.load(pageId)).doc)).not.toContain('should not appear');
  });
});

// ───────────── diff append ─────────────

describe('appendDiff', () => {
  it('stores only the diff since the persisted vector (AC-5.3)', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'x'.repeat(5000));
    const first = await store.appendDiff(pageId, doc);
    expect(first.stored).toBe(true);
    expect(first.bytes).toBeGreaterThan(5000);

    textAt(doc, 0).insert(10, '!');
    const second = await store.appendDiff(pageId, doc);
    expect(second.stored).toBe(true);
    expect(second.bytes).toBeLessThan(100);
    expect(second.bytes * 20).toBeLessThan(first.bytes);
    expect(second.seq).not.toBeNull();
    expect(second.seq as bigint).toBeGreaterThan(first.seq as bigint);
    expect(await rowCount(pageId)).toBe(2);
  });

  it('storing an unchanged document inserts no row (AC-5.3)', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'unchanged');
    await store.appendDiff(pageId, doc);
    for (let i = 0; i < 3; i += 1) {
      const again = await store.appendDiff(pageId, doc);
      expect(again).toMatchObject({ stored: false, seq: null, bytes: 0 });
    }
    expect(await rowCount(pageId)).toBe(1);
  });

  it('persists deletions, which change no state vector', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'abcdefgh');
    await store.appendDiff(pageId, doc);
    const vectorBefore = (await stateRow(pageId)).persistedStateVector;

    textAt(doc, 0).delete(2, 3);
    const stored = await store.appendDiff(pageId, doc);
    expect(stored.stored).toBe(true);
    expect(stateVectorsEqual(vectorBefore, (await stateRow(pageId)).persistedStateVector)).toBe(
      true,
    );

    const loaded = await store.load(pageId);
    expectSameDocument(loaded.doc, doc);
    expect(contentOf(loaded.doc)).toContain('abfgh');
    expect((await store.appendDiff(pageId, doc)).stored).toBe(false);
  });

  it('a document reloaded from storage is not stored again', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'hello world');
    textAt(doc, 0).delete(0, 6);
    await store.appendDiff(pageId, doc);
    const rows = await rowCount(pageId);

    const reloaded = (await store.load(pageId)).doc;
    expect((await store.appendDiff(pageId, reloaded)).stored).toBe(false);
    expect(await rowCount(pageId)).toBe(rows);
  });

  it('never loses a newer in-memory state when an older stored state is loaded into it', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'stored');
    await store.appendDiff(pageId, doc);
    textAt(doc, 0).insert(6, ' + newer, not stored yet');

    await store.load(pageId, doc); // the older stored state is applied onto the live document
    expect(contentOf(doc)).toContain('stored + newer, not stored yet');
  });
});

// ───────────── persisted vector (AC-5.5) ─────────────

describe('persisted state vector with several instances', () => {
  it('is the per-client maximum of what both instances stored', async () => {
    const pageId = await createTestPage(prisma);
    const base = new Y.Doc();
    addParagraph(base, 'shared');
    await store.appendDiff(pageId, base);

    // Two server instances load the document and edit it independently.
    const a = (await store.load(pageId)).doc;
    const b = (await store.load(pageId)).doc;
    textAt(a, 0).insert(0, 'A:');
    textAt(b, 0).insert(6, ':B');

    await store.appendDiff(pageId, a);
    const afterA = (await stateRow(pageId)).persistedStateVector;
    await store.appendDiff(pageId, b); // b has not received a's operations
    const afterB = (await stateRow(pageId)).persistedStateVector;

    const svA = Y.encodeStateVector(a);
    const svB = Y.encodeStateVector(b);
    expect(stateVectorCovers(afterB, svA)).toBe(true);
    expect(stateVectorCovers(afterB, svB)).toBe(true);
    expect(stateVectorsEqual(afterB, mergeStateVectors(svA, svB))).toBe(true);
    expect(stateVectorCovers(afterB, afterA)).toBe(true); // it never moved backwards

    // Neither instance's store overwrote the other's: the stored document has both edits.
    const loaded = (await store.load(pageId)).doc;
    expect(contentOf(loaded)).toContain('A:shared:B');
    // b's diff did not contain a's operations.
    const rows = await prisma.documentUpdate.findMany({
      where: { pageId },
      orderBy: { seq: 'asc' },
    });
    expect(rows).toHaveLength(3);
  });

  it('keeps growing across interleaved stores', async () => {
    const pageId = await createTestPage(prisma);
    const a = new Y.Doc();
    const b = new Y.Doc();
    addParagraph(a, 'a');
    addParagraph(b, 'b');
    let previous = new Uint8Array([0]);
    for (const doc of [a, b, a, b, a]) {
      textAt(doc, 0).insert(0, '.');
      await store.appendDiff(pageId, doc);
      const current = (await stateRow(pageId)).persistedStateVector;
      expect(stateVectorCovers(current, previous)).toBe(true);
      previous = current;
    }
    const loaded = (await store.load(pageId)).doc;
    // Applying b's and a's operations to each other gives what was stored.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expectSameDocument(loaded, a);
  });
});

// ───────────── concurrency (AC-5.4) ─────────────

describe('concurrent stores of one page', () => {
  it('serialize on the row lock and persist every edit', async () => {
    const pageId = await createTestPage(prisma);
    const base = new Y.Doc();
    for (let i = 0; i < 8; i += 1) addParagraph(base, `section ${i}:`);
    await store.appendDiff(pageId, base);

    const editors = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const doc = (await store.load(pageId)).doc;
        textAt(doc, i).insert(textAt(doc, i).length, ` edit-${i}`);
        return doc;
      }),
    );
    const results = await Promise.all(editors.map((doc) => store.appendDiff(pageId, doc)));

    expect(results.every((r) => r.stored)).toBe(true);
    expect(new Set(results.map((r) => r.seq)).size).toBe(8);
    const loaded = (await store.load(pageId)).doc;
    for (let i = 0; i < 8; i += 1) expect(contentOf(loaded)).toContain(`edit-${i}`);
    const persisted = (await stateRow(pageId)).persistedStateVector;
    for (const doc of editors)
      expect(stateVectorCovers(persisted, Y.encodeStateVector(doc))).toBe(true);
  });

  it('serialize with compaction and lose nothing', async () => {
    const pageId = await createTestPage(prisma);
    const base = new Y.Doc();
    for (let i = 0; i < 6; i += 1) addParagraph(base, `s${i}:`);
    await store.appendDiff(pageId, base);
    const editors = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const doc = (await store.load(pageId)).doc;
        textAt(doc, i).insert(textAt(doc, i).length, `e${i}`);
        return doc;
      }),
    );

    await Promise.all([
      ...editors.map((doc) => store.appendDiff(pageId, doc)),
      store.compact(pageId),
      store.compact(pageId),
      store.compact(pageId),
    ]);

    const loaded = (await store.load(pageId)).doc;
    for (let i = 0; i < 6; i += 1) expect(contentOf(loaded)).toContain(`s${i}:e${i}`);
  });
});

// ───────────── compaction (AC-5.7) ─────────────

describe('compaction', () => {
  async function pageWithRows(rows: number) {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'start');
    await store.appendDiff(pageId, doc);
    for (let i = 0; i < rows - 1; i += 1) {
      textAt(doc, 0).insert(textAt(doc, 0).length, String(i % 10));
      await store.appendDiff(pageId, doc);
    }
    return { pageId, doc };
  }

  it('folds the rows into the state and deletes them; load gives the same document', async () => {
    const { pageId, doc } = await pageWithRows(12);
    expect(await rowCount(pageId)).toBe(12);
    const lastSeq = (
      await prisma.documentUpdate.findFirstOrThrow({ where: { pageId }, orderBy: { seq: 'desc' } })
    ).seq;

    const result = await store.compact(pageId);
    expect(result).toEqual({ compacted: true, foldedRows: 12, foldedSeq: lastSeq });
    expect(await rowCount(pageId)).toBe(0);
    expect((await stateRow(pageId)).foldedSeq).toBe(lastSeq);

    const loaded = await store.load(pageId);
    expect(loaded.appliedRows).toBe(0);
    expectSameDocument(loaded.doc, doc);
  });

  it('does nothing below the threshold and for a page without rows', async () => {
    const { pageId } = await pageWithRows(3);
    expect((await store.compact(pageId, { minPendingRows: 10 })).compacted).toBe(false);
    expect(await rowCount(pageId)).toBe(3);
    await store.compact(pageId);
    expect((await store.compact(pageId)).compacted).toBe(false);
    expect((await store.compact('00000000-0000-4000-8000-000000000001')).compacted).toBe(false);
  });

  it('is atomic: a failure before the commit leaves the previous state and rows unchanged', async () => {
    const { pageId, doc } = await pageWithRows(6);
    const stateBefore = await stateRow(pageId);
    const rowsBefore = await prisma.documentUpdate.findMany({
      where: { pageId },
      orderBy: { seq: 'asc' },
    });

    await expect(
      store.compact(pageId, {
        beforeCommit: () => {
          throw new Error('injected failure');
        },
      }),
    ).rejects.toThrow('injected failure');

    const stateAfter = await stateRow(pageId);
    const rowsAfter = await prisma.documentUpdate.findMany({
      where: { pageId },
      orderBy: { seq: 'asc' },
    });
    expect(stateAfter.foldedSeq).toBe(stateBefore.foldedSeq);
    expect(Buffer.from(stateAfter.foldedState).equals(Buffer.from(stateBefore.foldedState))).toBe(
      true,
    );
    expect(rowsAfter.map((r) => r.seq)).toEqual(rowsBefore.map((r) => r.seq));
    expectSameDocument((await store.load(pageId)).doc, doc);

    expect((await store.compact(pageId)).compacted).toBe(true); // and it works afterwards
    expectSameDocument((await store.load(pageId)).doc, doc);
  });

  it('continues normally after a compaction', async () => {
    const { pageId, doc } = await pageWithRows(5);
    await store.compact(pageId);
    textAt(doc, 0).insert(0, 'after:');
    textAt(doc, 0).delete(8, 2);
    const stored = await store.appendDiff(pageId, doc);
    expect(stored.pendingRows).toBe(1);
    const loaded = await store.load(pageId);
    expect(loaded.appliedRows).toBe(1);
    expectSameDocument(loaded.doc, doc);
  });
});

// ───────────── repeated and out-of-order updates in storage ─────────────

describe('rows stored out of order or more than once', () => {
  it('rebuild the same document (Yjs updates are idempotent and commutative)', async () => {
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on('update', (update: Uint8Array) => updates.push(update));
    addParagraph(source, 'abcdef');
    textAt(source, 0).insert(3, 'XYZ');
    textAt(source, 0).delete(0, 2);
    textAt(source, 0).format(0, 3, { bold: {} });
    expect(updates).toHaveLength(4);

    const pageId = await createTestPage(prisma);
    await store.appendDiff(pageId, new Y.Doc()); // creates the state row
    const order = [3, 1, 2, 0, 2, 3, 0]; // reversed-ish, with repeats
    for (const index of order) {
      await prisma.documentUpdate.create({
        data: { pageId, update: new Uint8Array(updates[index] as Uint8Array) },
      });
    }
    expectSameDocument((await store.load(pageId)).doc, source);

    await store.compact(pageId); // folding the disordered rows keeps the document
    expectSameDocument((await store.load(pageId)).doc, source);
  });
});

// ───────────── recovery after restart (AC-5.6, G4) ─────────────

describe('recovery after an application restart', () => {
  it('a new process (new client, new store, no memory) rebuilds the stored document', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'before restart');
    await store.appendDiff(pageId, doc);
    textAt(doc, 0).insert(0, '1:');
    await store.appendDiff(pageId, doc);
    await store.compact(pageId);
    textAt(doc, 0).insert(0, '2:');
    textAt(doc, 0).delete(4, 2);
    await store.appendDiff(pageId, doc);

    // "Restart": everything in memory is gone; only PostgreSQL remains.
    const restartedPrisma = createPrismaClient(DATABASE_URL);
    try {
      const loaded = await new DocumentStore(restartedPrisma).load(pageId);
      expect(loaded.exists).toBe(true);
      expect(loaded.appliedRows).toBe(1);
      expectSameDocument(loaded.doc, doc);

      // The restarted process keeps editing and storing on top of the recovered document.
      textAt(loaded.doc, 0).insert(0, '3:');
      await new DocumentStore(restartedPrisma).appendDiff(pageId, loaded.doc);
    } finally {
      await restartedPrisma.$disconnect();
    }
    expect(contentOf((await store.load(pageId)).doc)).toContain('3:2:1:');
  });

  it('content that was never stored is gone after a crash, stored content is not (G2)', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'committed');
    await store.appendDiff(pageId, doc);
    textAt(doc, 0).insert(9, ' but this was only in memory');

    // Crash: the live document is lost without a store.
    const afterCrash = await store.load(pageId);
    expect(contentOf(afterCrash.doc)).toContain('committed');
    expect(contentOf(afterCrash.doc)).not.toContain('only in memory');

    // A store that commits makes it durable.
    await store.appendDiff(pageId, doc);
    expect(contentOf((await store.load(pageId)).doc)).toContain('only in memory');
  });

  it.each(Array.from({ length: 12 }, (_, i) => i + 1))(
    'seed %i: random history with stores, compactions and restarts always recovers exactly',
    async (seed) => {
      const random = mulberry32(seed);
      const pageId = await createTestPage(prisma);
      let doc = new Y.Doc();
      for (let step = 0; step < 60; step += 1) {
        randomEdit(doc, random);
        const roll = random();
        if (roll < 0.3) await store.appendDiff(pageId, doc);
        else if (roll < 0.4) await store.compact(pageId);
        else if (roll < 0.5) {
          await store.appendDiff(pageId, doc);
          const recovered = (await store.load(pageId)).doc;
          expectSameDocument(recovered, doc, `seed ${seed} step ${step}`);
          doc = recovered; // the process restarted and continues from storage
        }
      }
      await store.appendDiff(pageId, doc);
      expectSameDocument((await store.load(pageId)).doc, doc, `seed ${seed} final`);
      await store.compact(pageId);
      expectSameDocument((await store.load(pageId)).doc, doc, `seed ${seed} after compaction`);
    },
  );
});

// ───────────── constraints ─────────────

describe('database constraints', () => {
  it('rejects an empty update row and a negative folded sequence', async () => {
    const pageId = await createTestPage(prisma);
    await store.appendDiff(pageId, new Y.Doc());
    await expect(
      prisma.documentUpdate.create({ data: { pageId, update: new Uint8Array(0) } }),
    ).rejects.toThrow();
    await expect(
      prisma.documentState.update({ where: { pageId }, data: { foldedSeq: -1n } }),
    ).rejects.toThrow();
  });

  it('deleting a page deletes its document state and updates', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'gone soon');
    await store.appendDiff(pageId, doc);
    await prisma.page.delete({ where: { id: pageId } });
    expect(await prisma.documentState.count({ where: { pageId } })).toBe(0);
    expect(await rowCount(pageId)).toBe(0);
  });
});

// ───────────── Phase 9: multi-instance reads (D64, D65) ─────────────

describe('stale-document detection and replicated stores (Phase 9)', () => {
  it('persistedVectors returns one vector per stored page and leaves out unknown pages', async () => {
    const stored = await createTestPage(prisma);
    const untouched = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'stored');
    await store.appendDiff(stored, doc);
    const vectors = await store.persistedVectors([
      stored,
      untouched,
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(vectors.has(stored)).toBe(true);
    expect(stateVectorsEqual(vectors.get(stored)!, Y.encodeStateVector(doc))).toBe(true);
    expect(vectors.has('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect((await store.persistedVectors([])).size).toBe(0);
  });

  it('skipIfUnchanged answers without a transaction when the data is already stored', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'one');
    const first = await store.appendDiff(pageId, doc);
    expect(first.stored).toBe(true);
    const again = await store.appendDiff(pageId, doc, { skipIfUnchanged: true });
    expect(again).toEqual({
      stored: false,
      seq: null,
      bytes: 0,
      pendingRows: 0,
      skippedWithoutLock: true,
    });
    expect(await rowCount(pageId)).toBe(1);
  });

  it('skipIfUnchanged still stores a document that has something new, and a page never stored', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'one');
    // Never stored: there is no digest, so the fast path must not claim "already stored".
    const first = await store.appendDiff(pageId, doc, { skipIfUnchanged: true });
    expect(first.stored).toBe(true);
    addParagraph(doc, 'two');
    const second = await store.appendDiff(pageId, doc, { skipIfUnchanged: true });
    expect(second.stored).toBe(true);
    expect(await rowCount(pageId)).toBe(2);
    const rebuilt = await store.load(pageId);
    expectSameDocument(rebuilt.doc, doc);
  });

  it('skipIfUnchanged notices a deletion, which moves the delete set but no clock', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'to be shortened');
    await store.appendDiff(pageId, doc);
    textAt(doc, 0).delete(0, 3);
    const result = await store.appendDiff(pageId, doc, { skipIfUnchanged: true });
    expect(result.stored).toBe(true);
    expectSameDocument((await store.load(pageId)).doc, doc);
  });

  it('two instances storing the same changes at the same moment write them once', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'concurrent');
    const results = await Promise.all([
      store.appendDiff(pageId, doc),
      store.appendDiff(pageId, doc, { skipIfUnchanged: true }),
      store.appendDiff(pageId, doc, { skipIfUnchanged: true }),
      store.appendDiff(pageId, doc),
    ]);
    expect(results.filter((result) => result.stored)).toHaveLength(1);
    expect(await rowCount(pageId)).toBe(1);
    expectSameDocument((await store.load(pageId)).doc, doc);
  });
});
