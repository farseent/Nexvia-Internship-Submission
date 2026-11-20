import * as Y from 'yjs';

/**
 * Yjs helpers shared by the editor binding (client) and the document store (server).
 * Pure computation on `Y.Doc` and byte arrays: no I/O (docs/ARCHITECTURE.md §7.2).
 *
 * Vocabulary:
 *  - *update*: binary set of operations (`Y.encodeStateAsUpdate`).
 *  - *state vector*: per client, how many operations a replica has (`Y.encodeStateVector`).
 *  - *diff*: the update a replica with a given state vector is missing.
 * Applying an update is idempotent and commutative, so duplicate and reordered delivery are
 * safe; an update that depends on one not yet seen is held back by Yjs until it arrives.
 */

/** Transaction origin of updates received from elsewhere; they are never echoed back. */
export const REMOTE_ORIGIN = 'conote:remote';

/** Transaction origin of updates read from durable storage while hydrating a document. */
export const STORE_ORIGIN = 'conote:store';

export class InvalidYjsUpdateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidYjsUpdateError';
  }
}

/** The encoding of "no operations and no deletions" (two zero counts). */
export function isEmptyYjsUpdate(update: Uint8Array): boolean {
  return update.length === 2 && update[0] === 0 && update[1] === 0;
}

/** Per-client maximum of two state vectors: the union of what both cover (ARCHITECTURE §8.2). */
export function mergeStateVectors(a: Uint8Array, b: Uint8Array): Uint8Array {
  const merged = Y.decodeStateVector(a);
  for (const [client, clock] of Y.decodeStateVector(b)) {
    if (clock > (merged.get(client) ?? 0)) merged.set(client, clock);
  }
  return Y.encodeStateVector(merged);
}

/** True when `covering` has at least every clock that `covered` has. */
export function stateVectorCovers(covering: Uint8Array, covered: Uint8Array): boolean {
  const have = Y.decodeStateVector(covering);
  for (const [client, clock] of Y.decodeStateVector(covered)) {
    if (clock > (have.get(client) ?? 0)) return false;
  }
  return true;
}

export function stateVectorsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return stateVectorCovers(a, b) && stateVectorCovers(b, a);
}

/**
 * A deterministic description of everything a document contains: its state vector and its
 * delete set. A deletion changes the delete set but **not** the state vector, so comparing
 * state vectors alone would miss deletions; this encoding does not.
 */
export function encodeDocumentCoverage(doc: Y.Doc): Uint8Array {
  return Y.encodeSnapshot(Y.snapshot(doc));
}

/**
 * One replica of a document: a `Y.Doc` plus the local/remote update handling.
 *
 *  - Local changes (any transaction not marked remote or stored) are reported to `onLocalUpdate`
 *    as incremental updates, which is what a provider sends to the server.
 *  - Remote updates go through `applyRemoteUpdate`, are tagged `REMOTE_ORIGIN` and are therefore
 *    never reported again, so two replicas cannot echo an update back and forth.
 *  - `stateVector` and `diffSince` are the two halves of the sync handshake (step 1 and 2).
 */
export class DocumentReplica {
  readonly doc: Y.Doc;
  private readonly listener: (update: Uint8Array, origin: unknown) => void;

  constructor(options: { doc?: Y.Doc; onLocalUpdate?: (update: Uint8Array) => void } = {}) {
    this.doc = options.doc ?? new Y.Doc();
    const onLocalUpdate = options.onLocalUpdate;
    this.listener = (update, origin) => {
      if (origin === REMOTE_ORIGIN || origin === STORE_ORIGIN) return;
      onLocalUpdate?.(update);
    };
    this.doc.on('update', this.listener);
  }

  /** Sync step 1: what this replica has. */
  stateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  /**
   * Sync step 2: what a replica with `remoteStateVector` is missing; the whole state when no
   * vector is given. The result is never applied to this replica.
   */
  diffSince(remoteStateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
  }

  /**
   * Apply an update received from elsewhere. Safe for duplicates and for any delivery order:
   * an update that depends on operations not seen yet is kept pending and integrated when
   * they arrive. Throws `InvalidYjsUpdateError` for bytes that are not a Yjs update.
   */
  applyRemoteUpdate(update: Uint8Array): void {
    if (update.length === 0) {
      throw new InvalidYjsUpdateError('A Yjs update must not be empty.');
    }
    try {
      Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
    } catch (cause) {
      throw new InvalidYjsUpdateError('The bytes are not a valid Yjs update.', { cause });
    }
  }

  /** True while received operations wait for operations that have not arrived. */
  hasPendingUpdates(): boolean {
    return this.doc.store.pendingStructs !== null || this.doc.store.pendingDs !== null;
  }

  destroy(): void {
    this.doc.off('update', this.listener);
    this.doc.destroy();
  }
}

/**
 * The two-way sync handshake between two replicas without a network: each side sends its state
 * vector, receives the update the other is missing and applies it. Afterwards both replicas hold
 * the same operations.
 */
export function synchronizeReplicas(a: DocumentReplica, b: DocumentReplica): void {
  const missingInB = a.diffSince(b.stateVector());
  const missingInA = b.diffSince(a.stateVector());
  b.applyRemoteUpdate(missingInB);
  a.applyRemoteUpdate(missingInA);
}
