import * as Y from 'yjs';
import type { PrismaClient } from './client.js';
import { coverageDigestOf } from './document-store.js';
import type { SnapshotKind } from './generated/prisma/client.js';

/**
 * Version history storage (D9, docs/DATABASE_SCHEMA.md §4.4). Snapshots are immutable: this
 * class has no update path and the database refuses UPDATE (trigger). A snapshot holds the full
 * Yjs state, so it can be loaded into a stand-alone `Y.Doc` (VER-03) or applied by a restore.
 */

export const SNAPSHOT_LABEL_MAX_LENGTH = 120;
/** The activity action that marks an edit; contributors are derived from it (AC-8.9). */
export const PAGE_EDITED_ACTION = 'page.edited';

export interface SnapshotMeta {
  id: string;
  pageId: string;
  kind: SnapshotKind;
  label: string | null;
  sizeBytes: number;
  createdById: string | null;
  contributorIds: string[];
  createdAt: Date;
}

export interface CreateSnapshotInput {
  kind: SnapshotKind;
  /** The document to capture. Its full state is encoded once; nothing else is copied. */
  doc: Y.Doc;
  label?: string | null;
  createdById?: string | null;
  now?: Date;
  /** `AUTO` snapshots are skipped when the latest snapshot already has this exact content. */
  skipIfUnchanged?: boolean;
  /** After an `AUTO` snapshot, delete the page's older `AUTO` snapshots beyond this many (U11). */
  keepAuto?: number;
  /** Test hook: throwing here rolls the snapshot back (fault injection, AC-8.5). */
  beforeCommit?: () => void | Promise<void>;
}

export type CreateSnapshotResult =
  { created: true; snapshot: SnapshotMeta } | { created: false; reason: 'UNCHANGED' };

const META_SELECT = {
  id: true,
  pageId: true,
  kind: true,
  label: true,
  sizeBytes: true,
  createdById: true,
  contributorIds: true,
  createdAt: true,
} as const;

export class SnapshotStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Store a snapshot of `doc`. Contributors are the distinct users with a `page.edited` activity
   * row since the previous snapshot of the page (any kind). Runs in one transaction, so a failure
   * (including `beforeCommit`) leaves no partial snapshot.
   */
  async create(pageId: string, input: CreateSnapshotInput): Promise<CreateSnapshotResult> {
    const state = Y.encodeStateAsUpdate(input.doc);
    const digest = coverageDigestOf(input.doc);
    const now = input.now ?? new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const previous = await tx.documentSnapshot.findFirst({
          where: { pageId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { createdAt: true, coverageDigest: true },
        });
        if (
          input.skipIfUnchanged === true &&
          previous !== null &&
          Buffer.compare(Buffer.from(previous.coverageDigest), Buffer.from(digest)) === 0
        ) {
          return { created: false, reason: 'UNCHANGED' } as const;
        }
        const editors = await tx.activityLog.findMany({
          where: {
            pageId,
            action: PAGE_EDITED_ACTION,
            actorId: { not: null },
            ...(previous === null ? {} : { createdAt: { gt: previous.createdAt } }),
          },
          distinct: ['actorId'],
          select: { actorId: true },
        });
        const row = await tx.documentSnapshot.create({
          data: {
            pageId,
            kind: input.kind,
            label: input.label ?? null,
            state: new Uint8Array(state),
            sizeBytes: state.length,
            coverageDigest: digest,
            createdById: input.createdById ?? null,
            contributorIds: editors.flatMap((e) => (e.actorId === null ? [] : [e.actorId])),
            createdAt: now,
          },
          select: META_SELECT,
        });
        await input.beforeCommit?.();
        if (input.kind === 'AUTO' && input.keepAuto !== undefined) {
          // Retention (U11): only automatic snapshots are ever pruned.
          const stale = await tx.documentSnapshot.findMany({
            where: { pageId, kind: 'AUTO' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: input.keepAuto,
            select: { id: true },
          });
          if (stale.length > 0) {
            await tx.documentSnapshot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
          }
        }
        return { created: true, snapshot: row } as const;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  /** The stored state of a snapshot of `pageId`, or `null` (also when it belongs to another page). */
  async loadState(pageId: string, snapshotId: string): Promise<Uint8Array | null> {
    const row = await this.prisma.documentSnapshot.findFirst({
      where: { id: snapshotId, pageId },
      select: { state: true },
    });
    return row === null ? null : new Uint8Array(row.state);
  }

  async get(pageId: string, snapshotId: string): Promise<SnapshotMeta | null> {
    return this.prisma.documentSnapshot.findFirst({
      where: { id: snapshotId, pageId },
      select: META_SELECT,
    });
  }
}
