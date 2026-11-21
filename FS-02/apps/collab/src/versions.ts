import { randomUUID } from 'node:crypto';
import type { Document, Hocuspocus } from '@hocuspocus/server';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import {
  PAGE_EDITED_ACTION,
  SnapshotStore,
  type DocumentStore,
  type PrismaClient,
  type SnapshotMeta,
} from '@conote/db';
import {
  anchorStatusInDoc,
  InvalidEditorContentError,
  planRestore,
} from '@conote/editor/collaboration';
import {
  PAGE_EVENTS_CHANNEL,
  documentNameForPage,
  pageIdFromDocumentName,
  type ClientCommand,
  type PageEvent,
} from '@conote/shared';
import type { AccessController } from './access-control.js';
import type { Clock, CollabConfig } from './config.js';
import type { CollabContext, ConnectionRegistry } from './connection-registry.js';
import type { DocumentPersistence } from './persistence.js';

/*
 * Version history on the collaboration server (Phase 8; D9, D62, D63; WEBSOCKET_PROTOCOL §7, §8).
 *
 * Snapshots and restores are serialized with live editing, which is why they are collaboration-
 * server commands and not REST calls: only this process holds the live document.
 *
 * A restore is one Yjs transaction on the live document, applied through Hocuspocus so every
 * collaborator receives it like any other update. Around it:
 *   1. a durable barrier in PostgreSQL (D62) — stores by anyone but the holder are refused, on
 *      every instance — and an in-process gate that stops this instance applying client writes;
 *   2. a PRE_RESTORE snapshot of the current state, committed before anything is changed;
 *   3. the restore delta, computed on a scratch copy (see `planRestore`), so a failure leaves the
 *      live document untouched;
 *   4. persistence of the result under the barrier, comment-anchor re-evaluation, the barrier
 *      released in a `finally`, and every client told the outcome.
 */

export type CommandErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR';

export type CommandOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: CommandErrorCode; message: string };

/** Test hooks for fault injection; never set in production. */
export interface VersionHooks {
  beforePreRestoreCommit?: () => void | Promise<void>;
  /** After the PRE_RESTORE snapshot is committed, before the live document is changed. */
  afterPreRestoreSnapshot?: () => void | Promise<void>;
  /** Replace the restore delta computation (e.g. to throw). */
  planRestore?: typeof planRestore;
  /** Inside the barrier, after the live document was changed and stored. */
  afterApply?: () => void | Promise<void>;
}

interface ActiveRestore {
  token: string;
  startedBy: string;
}

/** The context Hocuspocus gets for changes this server makes itself. */
export const SYSTEM_CONTEXT = Object.freeze({ system: true as const });

export function isCollabContext(value: unknown): value is CollabContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'userId' in value &&
    typeof (value as { userId: unknown }).userId === 'string' &&
    'pageId' in value
  );
}

export class VersionService {
  private readonly restoring = new Map<string, ActiveRestore>();
  private readonly lastEditLogged = new Map<string, number>();
  private readonly dirtySince = new Map<string, number>();
  private readonly snapshots: SnapshotStore;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly store: DocumentStore,
    private readonly persistence: DocumentPersistence,
    private readonly registry: ConnectionRegistry,
    private readonly access: AccessController,
    private readonly config: CollabConfig,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly hocuspocus: () => Hocuspocus,
    private readonly publish: (channel: string, message: string) => Promise<void>,
    private readonly hooks: VersionHooks = {},
  ) {
    this.snapshots = new SnapshotStore(prisma);
    persistence.setRestoreTokenProvider((pageId) => this.restoring.get(pageId)?.token);
  }

  // ───────────── the gate ─────────────

  /** True while this instance is restoring the page. */
  isRestoring(pageId: string): boolean {
    return this.restoring.has(pageId);
  }

  // ───────────── contributors and automatic snapshots ─────────────

  /** An accepted edit by `context`: log it for contributors (throttled) and mark the page dirty. */
  recordEdit(context: CollabContext): void {
    const now = this.clock().getTime();
    if (!this.dirtySince.has(context.pageId)) this.dirtySince.set(context.pageId, now);
    const key = `${context.pageId}\0${context.userId}`;
    const last = this.lastEditLogged.get(key);
    if (last !== undefined && now - last < this.config.editActivityIntervalMs) return;
    this.lastEditLogged.set(key, now);
    void this.prisma.activityLog
      .create({
        data: {
          workspaceId: context.workspaceId,
          pageId: context.pageId,
          actorId: context.userId,
          action: PAGE_EDITED_ACTION,
          createdAt: this.clock(),
        },
      })
      .catch((err: unknown) => {
        this.lastEditLogged.delete(key); // try again with the next edit
        this.logger.warn({ err: { name: (err as Error).name } }, 'could not log page.edited');
      });
  }

  /** After a store: take an automatic snapshot when the page changed and the interval has passed. */
  async autoSnapshotIfDue(documentName: string, document: Document): Promise<void> {
    const pageId = pageIdFromDocumentName(documentName);
    if (pageId === null || this.restoring.has(pageId)) return;
    const since = this.dirtySince.get(pageId);
    if (since === undefined) return;
    if (this.clock().getTime() - since < this.config.autoSnapshotIntervalMs) return;
    await this.autoSnapshot(pageId, document);
  }

  /** When the last client leaves: a final automatic snapshot if the page changed since the last one. */
  async autoSnapshotOnUnload(documentName: string, document: Document): Promise<void> {
    const pageId = pageIdFromDocumentName(documentName);
    if (pageId === null || this.restoring.has(pageId)) return;
    if (this.dirtySince.has(pageId)) await this.autoSnapshot(pageId, document);
  }

  private async autoSnapshot(pageId: string, document: Document): Promise<void> {
    try {
      const result = await this.snapshots.create(pageId, {
        kind: 'AUTO',
        doc: document,
        skipIfUnchanged: true,
        keepAuto: this.config.autoSnapshotKeep,
        now: this.clock(),
      });
      this.dirtySince.delete(pageId);
      this.resetEditThrottle(pageId);
      if (result.created) this.announceCreated(result.snapshot);
    } catch (err) {
      // Not fatal: the document is stored; the next store tries again.
      this.logger.warn({ pageId, err: { name: (err as Error).name } }, 'automatic snapshot failed');
    }
  }

  private resetEditThrottle(pageId: string): void {
    for (const key of this.lastEditLogged.keys()) {
      if (key.startsWith(`${pageId}\0`)) this.lastEditLogged.delete(key);
    }
  }

  private announceCreated(snapshot: SnapshotMeta): void {
    this.broadcast(snapshot.pageId, {
      v: 1,
      type: 'version.created',
      payload: {
        versionId: snapshot.id,
        kind: snapshot.kind,
        label: snapshot.label,
        createdBy: snapshot.createdById,
      },
    });
  }

  // ───────────── commands ─────────────

  /** `version.create`: a manual, labelled snapshot of the live document (FR-VH-01). */
  async create(
    context: CollabContext,
    document: Document,
    command: Extract<ClientCommand, { type: 'version.create' }>,
  ): Promise<CommandOutcome> {
    const denied = await this.authorize(context);
    if (denied) return denied;
    if (this.restoring.has(context.pageId)) {
      return { ok: false, code: 'CONFLICT', message: 'The page is being restored.' };
    }
    try {
      const result = await this.snapshots.create(context.pageId, {
        kind: 'MANUAL',
        doc: document,
        label: command.payload.label ?? null,
        createdById: context.userId,
        now: this.clock(),
      });
      if (!result.created) throw new Error('manual snapshots are never skipped');
      this.dirtySince.delete(context.pageId);
      this.resetEditThrottle(context.pageId);
      await this.logActivity(context, 'version.created', { versionId: result.snapshot.id });
      this.announceCreated(result.snapshot);
      return { ok: true, result: { versionId: result.snapshot.id } };
    } catch (err) {
      this.logger.error(
        { pageId: context.pageId, err: { name: (err as Error).name } },
        'version.create failed',
      );
      return { ok: false, code: 'INTERNAL_ERROR', message: 'The version could not be saved.' };
    }
  }

  /** `version.restore` (WEBSOCKET_PROTOCOL §8). */
  async restore(
    context: CollabContext,
    document: Document,
    command: Extract<ClientCommand, { type: 'version.restore' }>,
  ): Promise<CommandOutcome> {
    const { pageId } = context;
    const denied = await this.authorize(context);
    if (denied) return denied;

    // In-process gate first and synchronously: two restores of one page on this instance cannot interleave.
    if (this.restoring.has(pageId)) {
      return { ok: false, code: 'CONFLICT', message: 'The page is already being restored.' };
    }
    const token = randomUUID();
    this.restoring.set(pageId, { token, startedBy: context.userId });

    let barrierHeld = false;
    let released = false;
    /** Lift the barrier and the gate. Always before the outcome is announced, so a client that
     *  reacts to the announcement by syncing is not turned away by the gate. */
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      if (barrierHeld) {
        await this.store.releaseRestoreBarrier(pageId, token).catch((err: unknown) => {
          // The barrier expires by itself (COLLAB_RESTORE_BARRIER_TTL_MS).
          this.logger.error(
            { pageId, err: { name: (err as Error).name } },
            'could not release the restore barrier',
          );
        });
      }
      this.restoring.delete(pageId);
      this.reopenWrites(pageId);
    };

    try {
      const target = await this.snapshots.loadState(pageId, command.payload.versionId);
      if (target === null) {
        return { ok: false, code: 'NOT_FOUND', message: 'That version does not exist.' };
      }
      barrierHeld = await this.store.acquireRestoreBarrier(pageId, {
        token,
        ownerId: context.userId,
        ttlMs: this.config.restoreBarrierTtlMs,
        now: this.clock(),
      });
      if (!barrierHeld) {
        return { ok: false, code: 'CONFLICT', message: 'The page is being restored elsewhere.' };
      }
      return await this.restoreUnderBarrier(
        context,
        document,
        command.payload.versionId,
        target,
        release,
      );
    } catch (err) {
      this.logger.error(
        { pageId, err: { name: (err as Error).name, message: (err as Error).message } },
        'restore failed; the document was not changed',
      );
      const reason =
        err instanceof InvalidEditorContentError
          ? 'That version cannot be restored: its content is not valid.'
          : 'The version could not be restored. The page was not changed.';
      await release();
      this.broadcast(pageId, { v: 1, type: 'version.restore.failed', payload: { reason } });
      return { ok: false, code: 'INTERNAL_ERROR', message: reason };
    } finally {
      await release();
    }
  }

  private async restoreUnderBarrier(
    context: CollabContext,
    document: Document,
    versionId: string,
    target: Uint8Array,
    release: () => Promise<void>,
  ): Promise<CommandOutcome> {
    const { pageId } = context;
    const documentName = documentNameForPage(pageId);
    this.broadcast(pageId, {
      v: 1,
      type: 'version.restore.started',
      payload: { restoredBy: context.userId },
    });

    // Drain: everything this instance accepted before the barrier is stored, then anything
    // other instances stored (until Redis document sync exists, Phase 9) is merged in.
    await this.persistence.persist(documentName, document);
    const stored = await this.store.load(pageId);
    let missing: Uint8Array;
    let liveState: Uint8Array;
    try {
      missing = Y.encodeStateAsUpdate(stored.doc, Y.encodeStateVector(document));
      liveState = Y.mergeUpdates([
        Y.encodeStateAsUpdate(document),
        Y.encodeStateAsUpdate(stored.doc),
      ]);
    } finally {
      stored.doc.destroy();
    }

    // The restore delta is computed before anything is committed: an invalid snapshot fails here.
    const plan = this.hooks.planRestore ?? planRestore;
    const delta = plan(liveState, target);

    // PRE_RESTORE snapshot of what is about to be replaced (AC-8.5): committed, or nothing happens.
    const before = new Y.Doc();
    let preRestore: SnapshotMeta;
    try {
      Y.applyUpdate(before, liveState);
      const created = await this.snapshots.create(pageId, {
        kind: 'PRE_RESTORE',
        doc: before,
        createdById: context.userId,
        now: this.clock(),
        ...(this.hooks.beforePreRestoreCommit
          ? { beforeCommit: this.hooks.beforePreRestoreCommit }
          : {}),
      });
      if (!created.created) throw new Error('pre-restore snapshots are never skipped');
      preRestore = created.snapshot;
    } finally {
      before.destroy();
    }
    await this.hooks.afterPreRestoreSnapshot?.();

    // Apply: one transaction, through Hocuspocus, so every collaborator receives it.
    const direct = await this.hocuspocus().openDirectConnection(documentName, SYSTEM_CONTEXT);
    try {
      await direct.transact((doc) => {
        if (missing.length > 2) Y.applyUpdate(doc, missing);
        if (delta !== null) Y.applyUpdate(doc, delta);
      });
    } finally {
      await direct.disconnect({ unloadImmediately: false }).catch(() => undefined);
    }

    let durable = true;
    try {
      await this.persistence.persist(documentName, document);
    } catch (err) {
      // The live document is restored for everyone; the store is retried like any failed store (G2).
      durable = false;
      this.logger.error(
        { pageId, err: { name: (err as Error).name } },
        'restored document could not be stored yet',
      );
      this.persistence.scheduleRetry(documentName, () => {
        void this.persistence.persist(documentName, document).catch(() => undefined);
      });
    }
    await this.hooks.afterApply?.();

    await this.reevaluateAnchors(pageId, document);
    this.dirtySince.delete(pageId);
    this.resetEditThrottle(pageId);
    await this.logActivity(context, 'version.restored', {
      versionId,
      preRestoreVersionId: preRestore.id,
    });
    await release();
    this.announceCreated(preRestore);
    this.broadcast(pageId, {
      v: 1,
      type: 'version.restored',
      payload: { versionId, preRestoreVersionId: preRestore.id, restoredBy: context.userId },
    });
    this.broadcast(pageId, { v: 1, type: 'comments.changed', payload: { pageId } });
    void this.publish(
      PAGE_EVENTS_CHANNEL,
      JSON.stringify({
        v: 1,
        type: 'document.restored',
        pageId,
        at: this.clock().toISOString(),
      } satisfies PageEvent),
    );
    this.logger.info(
      {
        pageId,
        userId: context.userId,
        versionId,
        preRestoreVersionId: preRestore.id,
        durable,
        changed: delta !== null,
      },
      'version restored',
    );
    return { ok: true, result: { versionId, preRestoreVersionId: preRestore.id, durable } };
  }

  /** Mark threads whose anchor no longer resolves DETACHED, and re-attach the ones that do (U8). */
  async reevaluateAnchors(pageId: string, document: Y.Doc): Promise<number> {
    const threads = await this.prisma.commentThread.findMany({
      where: { pageId },
      select: { id: true, anchorStart: true, anchorEnd: true, anchorStatus: true },
    });
    let changed = 0;
    for (const thread of threads) {
      const status = anchorStatusInDoc(document, {
        start: new Uint8Array(thread.anchorStart),
        end: new Uint8Array(thread.anchorEnd),
      });
      if (status !== thread.anchorStatus) {
        await this.prisma.commentThread.update({
          where: { id: thread.id },
          data: { anchorStatus: status },
        });
        changed += 1;
      }
    }
    return changed;
  }

  // ───────────── events from other instances ─────────────

  /**
   * Another instance restored this page (`document.restored`): bring the live document here up to
   * what PostgreSQL holds, which includes the restore. Idempotent; a missed event costs only a
   * delay until the next reconnect.
   */
  async catchUp(pageId: string): Promise<void> {
    const documentName = documentNameForPage(pageId);
    const document = this.hocuspocus().documents.get(documentName);
    if (document === undefined || this.restoring.has(pageId)) return;
    const stored = await this.store.load(pageId);
    try {
      const missing = Y.encodeStateAsUpdate(stored.doc, Y.encodeStateVector(document));
      if (missing.length <= 2) return;
      const direct = await this.hocuspocus().openDirectConnection(documentName, SYSTEM_CONTEXT);
      try {
        await direct.transact((doc) => Y.applyUpdate(doc, missing));
      } finally {
        await direct.disconnect({ unloadImmediately: false }).catch(() => undefined);
      }
      this.broadcast(pageId, { v: 1, type: 'comments.changed', payload: { pageId } });
    } finally {
      stored.doc.destroy();
    }
  }

  /** Forward a message to every connection of the page on this instance. */
  broadcast(pageId: string, message: Parameters<AccessController['send']>[1]): void {
    for (const context of this.registry.matching((c) => c.pageId === pageId && !c.revoked)) {
      this.access.send(context, message);
    }
  }

  // ───────────── helpers ─────────────

  /** Fresh authorization for a document-changing command: the role is read again, not trusted from connect time. */
  private async authorize(context: CollabContext): Promise<CommandOutcome | null> {
    if (context.revoked)
      return { ok: false, code: 'FORBIDDEN', message: 'You no longer have access.' };
    await this.access.revalidate([context]);
    if (context.revoked || context.readOnly) {
      return { ok: false, code: 'FORBIDDEN', message: 'You do not have permission to do this.' };
    }
    return null;
  }

  /** After a restore, connections go back to what their role allows. */
  private reopenWrites(pageId: string): void {
    for (const context of this.registry.matching((c) => c.pageId === pageId)) {
      if (context.connection) context.connection.readOnly = context.readOnly;
    }
  }

  private async logActivity(
    context: CollabContext,
    action: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          workspaceId: context.workspaceId,
          pageId: context.pageId,
          actorId: context.userId,
          action,
          metadata,
          createdAt: this.clock(),
        },
      });
    } catch (err) {
      this.logger.warn({ action, err: { name: (err as Error).name } }, 'could not write activity');
    }
  }
}
