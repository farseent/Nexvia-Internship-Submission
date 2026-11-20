import * as Y from 'yjs';
import type { Logger } from 'pino';
import { type DocumentStore, type PrismaClient } from '@conote/db';
import { InvalidEditorContentError, contentToYDoc } from '@conote/editor/collaboration';
import { pageIdFromDocumentName } from '@conote/shared';

export class DocumentNameError extends Error {
  constructor() {
    super('The document name is not page:<uuid>.');
    this.name = 'DocumentNameError';
  }
}

/** Seconds between attempts to store a document that could not be stored, capped. */
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface PersistenceOptions {
  compactUpdateCount: number;
  /** Test hook: replaces the delay before a failed store is tried again. */
  retryDelayMs?: (attempt: number) => number;
}

/**
 * Loads and stores collaborative documents through `DocumentStore` (docs/ARCHITECTURE.md §8).
 *
 * A change counts as durable only after `store` resolved: nothing here, and nothing sent to
 * clients, claims more. When a store fails the document stays in memory (Hocuspocus) and is
 * tried again with a growing delay, so a database outage costs time, not data, as long as the
 * process stays up (G2).
 */
export class DocumentPersistence {
  private readonly attempts = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly store: DocumentStore,
    private readonly logger: Logger,
    private readonly options: PersistenceOptions,
  ) {}

  /**
   * The document as stored. A page that has no Yjs state yet but has interim editor content
   * (`page_contents`, D54) is seeded once, on the server, through `seedIfEmpty`: clients must
   * never create initial content, or two of them would each add it (WEBSOCKET_PROTOCOL §5a).
   * Returns the full state as one Yjs update.
   */
  async load(documentName: string): Promise<Uint8Array> {
    const pageId = this.pageId(documentName);
    let loaded = await this.store.load(pageId);
    if (!loaded.exists) {
      const row = await this.prisma.pageContent.findUnique({
        where: { pageId },
        select: { content: true },
      });
      if (row !== null) {
        let seed: Y.Doc;
        try {
          seed = contentToYDoc(row.content);
        } catch (err) {
          if (err instanceof InvalidEditorContentError) {
            // Starting blank would hide the old content and invite overwriting it.
            this.logger.error({ pageId }, 'interim page content is invalid; refusing to open');
          }
          throw err;
        }
        try {
          const { seeded } = await this.store.seedIfEmpty(pageId, seed);
          this.logger.info({ pageId, seeded }, 'seeded document from interim page content');
        } finally {
          seed.destroy();
        }
        loaded.doc.destroy();
        loaded = await this.store.load(pageId);
      }
    }
    const state = Y.encodeStateAsUpdate(loaded.doc);
    loaded.doc.destroy();
    this.logger.debug(
      { pageId, existed: loaded.exists, appliedRows: loaded.appliedRows },
      'document loaded',
    );
    return state;
  }

  /**
   * Store what the live document has beyond what is persisted. Throws when PostgreSQL could
   * not commit; the caller (Hocuspocus) keeps the document in memory and `scheduleRetry`
   * tries again.
   */
  async persist(documentName: string, document: Y.Doc): Promise<void> {
    const pageId = this.pageId(documentName);
    let result;
    try {
      result = await this.store.appendDiff(pageId, document);
    } catch (err) {
      // A page that no longer exists (its workspace was deleted) can never be stored again.
      // Retrying for ever would keep the document, and a shutdown, waiting; drop it instead.
      if (await this.pageIsGone(pageId)) {
        this.clearRetry(documentName);
        this.logger.warn({ pageId }, 'page no longer exists; discarding unsaved document state');
        return;
      }
      throw err;
    }
    this.clearRetry(documentName);
    if (result.stored) {
      this.logger.debug(
        { pageId, bytes: result.bytes, pendingRows: result.pendingRows },
        'document stored',
      );
    }
    if (result.pendingRows >= this.options.compactUpdateCount) {
      await this.compact(pageId, this.options.compactUpdateCount);
    }
  }

  /** Fold the stored rows into the state when the last client left (D15). Never throws. */
  async compactOnUnload(documentName: string): Promise<void> {
    const pageId = pageIdFromDocumentName(documentName);
    if (pageId === null) return;
    await this.compact(pageId, 1);
  }

  /** Call after a failed store; `retry` is invoked after a delay until `persist` succeeds. */
  scheduleRetry(documentName: string, retry: () => void): void {
    if (this.stopped) return;
    const pending = this.timers.get(documentName);
    if (pending) clearTimeout(pending);
    const attempt = (this.attempts.get(documentName) ?? 0) + 1;
    this.attempts.set(documentName, attempt);
    const delay =
      this.options.retryDelayMs?.(attempt) ??
      RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ??
      30_000;
    const timer = setTimeout(() => {
      this.timers.delete(documentName);
      retry();
    }, delay);
    timer.unref();
    this.timers.set(documentName, timer);
  }

  /** Number of documents with a store that keeps failing (for logs and tests). */
  get failingDocuments(): number {
    return this.attempts.size;
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.attempts.clear();
  }

  private clearRetry(documentName: string): void {
    const timer = this.timers.get(documentName);
    if (timer) clearTimeout(timer);
    this.timers.delete(documentName);
    this.attempts.delete(documentName);
  }

  private async compact(pageId: string, minPendingRows: number): Promise<void> {
    try {
      const result = await this.store.compact(pageId, { minPendingRows });
      if (result.compacted) {
        this.logger.debug({ pageId, foldedRows: result.foldedRows }, 'document compacted');
      }
    } catch (err) {
      // The transaction rolled back, so the stored data is unchanged and complete (G4).
      this.logger.warn({ pageId, err: { name: (err as Error).name } }, 'compaction failed');
    }
  }

  private async pageIsGone(pageId: string): Promise<boolean> {
    try {
      return (await this.prisma.page.count({ where: { id: pageId } })) === 0;
    } catch {
      return false; // the database itself is failing: not proof that the page is gone
    }
  }

  private pageId(documentName: string): string {
    const pageId = pageIdFromDocumentName(documentName);
    if (pageId === null) throw new DocumentNameError();
    return pageId;
  }
}
