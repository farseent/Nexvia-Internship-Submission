import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import {
  STORE_ORIGIN,
  encodeDocumentCoverage,
  isEmptyYjsUpdate,
  mergeStateVectors,
} from '@conote/shared';
import type { PrismaClient } from './client.js';
import type { Prisma } from './generated/prisma/client.js';

/**
 * The only code that reads or writes collaborative document data (CLAUDE.md §7,
 * docs/DATABASE_SCHEMA.md §7, docs/ARCHITECTURE.md §8).
 *
 * Model: `DocumentUpdate` rows are append-only *diffs*; `DocumentState` holds the compacted
 * state, the persisted state vector and doubles as the per-page lock row. Every write of a page
 * runs in one transaction that first locks that row (`SELECT … FOR UPDATE`), so stores and
 * compactions of the same page, from any number of processes, are serialized and `seq` order
 * equals commit order. PostgreSQL is the only durable store (D14); a change is durable exactly
 * when the transaction that stores it has committed (G2).
 */

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** A copy backed by a plain `ArrayBuffer`, the type Prisma accepts for `Bytes` columns. */
function toBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

function digestOf(coverage: Uint8Array): Uint8Array<ArrayBuffer> {
  return toBytes(createHash('sha256').update(coverage).digest());
}

export class DocumentPageNotFoundError extends Error {
  constructor(readonly pageId: string) {
    super(`Page ${pageId} does not exist.`);
    this.name = 'DocumentPageNotFoundError';
  }
}

export interface AppendResult {
  /** False when nothing needed to be written. */
  stored: boolean;
  /** Sequence number of the inserted row, `null` when nothing was stored. */
  seq: bigint | null;
  /** Size of the stored diff in bytes (0 when nothing was stored). */
  bytes: number;
  /** Update rows not yet folded into the state, after this call. */
  pendingRows: number;
}

export interface LoadResult {
  doc: Y.Doc;
  /** False when the page has no stored document data at all (a new, empty document). */
  exists: boolean;
  foldedSeq: bigint;
  /** Update rows applied on top of the folded state. */
  appliedRows: number;
}

export interface CompactOptions {
  /** Do nothing unless at least this many rows are pending (default 1). */
  minPendingRows?: number;
  /**
   * Called after all writes and before the commit. Throwing here rolls the whole compaction
   * back; it exists so tests can inject a failure at the worst possible moment (AC-5.7).
   */
  beforeCommit?: () => void | Promise<void>;
}

export interface CompactResult {
  compacted: boolean;
  foldedRows: number;
  foldedSeq: bigint;
}

export interface SeedResult {
  seeded: boolean;
}

interface LockedState {
  foldedState: Uint8Array;
  persistedStateVector: Uint8Array;
  persistedDigest: Uint8Array;
  foldedSeq: bigint;
}

export class DocumentStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Store what `doc` has beyond what is already persisted, as one `DocumentUpdate` row.
   *
   * The diff is `Y.encodeStateAsUpdate(doc, persistedStateVector)`: only operations the store
   * lacks, never the whole document. The persisted vector becomes the per-client **maximum** of
   * itself and the live vector, because another process may have stored operations this `doc`
   * has not received yet; it can therefore only grow. Nothing is written when the document is
   * unchanged. Deletions change the delete set but not the state vector, so "unchanged" is
   * decided on the document's full coverage (`encodeDocumentCoverage`), not on the vector.
   */
  async appendDiff(pageId: string, doc: Y.Doc): Promise<AppendResult> {
    return this.prisma.$transaction(async (tx) => {
      const state = await this.lockState(tx, pageId, true);
      return this.storeDiff(tx, pageId, state, doc);
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Store the initial content of a page whose document has never been stored. Under the page
   * lock, so when several processes seed the same page at once exactly one wins and the others
   * get `seeded: false`; seeding twice from separately created documents would otherwise
   * duplicate the content (each `Y.Doc` has its own client id). Only ever call this on the
   * server (docs/WEBSOCKET_PROTOCOL.md §4).
   */
  async seedIfEmpty(pageId: string, seed: Y.Doc): Promise<SeedResult> {
    return this.prisma.$transaction(async (tx) => {
      const state = await this.lockState(tx, pageId, true);
      const rows = await tx.documentUpdate.count({ where: { pageId } });
      const hasData =
        rows > 0 ||
        state.foldedSeq > 0n ||
        Y.decodeStateVector(state.persistedStateVector).size > 0;
      if (hasData) return { seeded: false };
      const result = await this.storeDiff(tx, pageId, state, seed);
      return { seeded: result.stored };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Rebuild a document: the folded state plus every stored row after `foldedSeq`, applied in
   * order. Hydrates `target` when given (applying is idempotent and commutative, so an existing
   * newer state in `target` is never lost or replaced).
   *
   * Rows are read before the state on purpose, without a lock. A compaction that commits
   * in between leaves rows that are already folded into the state we then read (applying them
   * twice is harmless and they are skipped by `seq`); reading the state first could instead miss
   * rows that the compaction folded and deleted in between.
   */
  async load(pageId: string, target: Y.Doc = new Y.Doc()): Promise<LoadResult> {
    const rows = await this.prisma.documentUpdate.findMany({
      where: { pageId },
      orderBy: { seq: 'asc' },
      select: { seq: true, update: true },
    });
    const state = await this.prisma.documentState.findUnique({
      where: { pageId },
      select: { foldedState: true, foldedSeq: true },
    });
    const foldedSeq = state?.foldedSeq ?? 0n;
    if (state) Y.applyUpdate(target, state.foldedState, STORE_ORIGIN);
    let appliedRows = 0;
    for (const row of rows) {
      if (row.seq <= foldedSeq) continue;
      Y.applyUpdate(target, row.update, STORE_ORIGIN);
      appliedRows += 1;
    }
    return { doc: target, exists: state !== null || rows.length > 0, foldedSeq, appliedRows };
  }

  /**
   * Merge the pending rows into the folded state and delete them, in one transaction under the
   * page lock. If anything fails, including `beforeCommit`, the previous state and rows are
   * unchanged (G4). The folded sequence only ever moves forward.
   */
  async compact(pageId: string, options: CompactOptions = {}): Promise<CompactResult> {
    return this.prisma.$transaction(async (tx) => {
      const state = await this.lockState(tx, pageId, false);
      if (!state) return { compacted: false, foldedRows: 0, foldedSeq: 0n };
      const rows = await tx.documentUpdate.findMany({
        where: { pageId, seq: { gt: state.foldedSeq } },
        orderBy: { seq: 'asc' },
        select: { seq: true, update: true },
      });
      const last = rows[rows.length - 1];
      if (!last || rows.length < (options.minPendingRows ?? 1)) {
        return { compacted: false, foldedRows: 0, foldedSeq: state.foldedSeq };
      }
      const merged = Y.mergeUpdates([state.foldedState, ...rows.map((row) => row.update)]);
      await tx.documentState.update({
        where: { pageId },
        data: { foldedState: toBytes(merged), foldedSeq: last.seq },
      });
      await tx.documentUpdate.deleteMany({ where: { pageId, seq: { lte: last.seq } } });
      await options.beforeCommit?.();
      return { compacted: true, foldedRows: rows.length, foldedSeq: last.seq };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Lock the page's `DocumentState` row and return it. With `create`, the row is created first
   * when missing (`ON CONFLICT DO NOTHING`, safe against a concurrent creator); without it a
   * missing row yields `null`.
   */
  private async lockState(
    tx: Prisma.TransactionClient,
    pageId: string,
    create: true,
  ): Promise<LockedState>;
  private async lockState(
    tx: Prisma.TransactionClient,
    pageId: string,
    create: false,
  ): Promise<LockedState | null>;
  private async lockState(
    tx: Prisma.TransactionClient,
    pageId: string,
    create: boolean,
  ): Promise<LockedState | null> {
    if (create) {
      const existing = await tx.documentState.findUnique({
        where: { pageId },
        select: { pageId: true },
      });
      if (!existing) {
        const page = await tx.page.findUnique({ where: { id: pageId }, select: { id: true } });
        if (!page) throw new DocumentPageNotFoundError(pageId);
        const empty = new Y.Doc();
        await tx.documentState.createMany({
          data: [
            {
              pageId,
              foldedState: toBytes(Y.encodeStateAsUpdate(empty)),
              persistedStateVector: toBytes(Y.encodeStateVector(empty)),
              persistedDigest: new Uint8Array(0),
              foldedSeq: 0n,
            },
          ],
          skipDuplicates: true,
        });
        empty.destroy();
      }
    }
    const locked = await tx.$queryRaw<{ locked: number }[]>`
      SELECT 1 AS locked FROM document_states WHERE "pageId" = ${pageId}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    // Read after the lock: this is the state every concurrent writer has committed so far.
    return tx.documentState.findUniqueOrThrow({
      where: { pageId },
      select: {
        foldedState: true,
        persistedStateVector: true,
        persistedDigest: true,
        foldedSeq: true,
      },
    });
  }

  /** The shared write step of `appendDiff` and `seedIfEmpty`; the page lock is held. */
  private async storeDiff(
    tx: Prisma.TransactionClient,
    pageId: string,
    state: LockedState,
    doc: Y.Doc,
  ): Promise<AppendResult> {
    // One synchronous block: the diff, the vector and the digest describe the same moment even
    // if the document keeps changing while the queries below are awaited. Recording less than
    // was stored is harmless (a redundant row later); recording more would lose data.
    const liveVector = Y.encodeStateVector(doc);
    const digest = digestOf(encodeDocumentCoverage(doc));
    const diff = Y.encodeStateAsUpdate(doc, state.persistedStateVector);

    const unchanged =
      state.persistedDigest.length > 0 && Buffer.compare(digest, state.persistedDigest) === 0;
    if (unchanged || isEmptyYjsUpdate(diff)) {
      return {
        stored: false,
        seq: null,
        bytes: 0,
        pendingRows: await this.countPending(tx, pageId, state.foldedSeq),
      };
    }

    const row = await tx.documentUpdate.create({
      data: { pageId, update: toBytes(diff) },
      select: { seq: true },
    });
    await tx.documentState.update({
      where: { pageId },
      data: {
        persistedStateVector: toBytes(mergeStateVectors(state.persistedStateVector, liveVector)),
        persistedDigest: digest,
      },
    });
    return {
      stored: true,
      seq: row.seq,
      bytes: diff.length,
      pendingRows: await this.countPending(tx, pageId, state.foldedSeq),
    };
  }

  private countPending(
    tx: Prisma.TransactionClient,
    pageId: string,
    foldedSeq: bigint,
  ): Promise<number> {
    return tx.documentUpdate.count({ where: { pageId, seq: { gt: foldedSeq } } });
  }
}
