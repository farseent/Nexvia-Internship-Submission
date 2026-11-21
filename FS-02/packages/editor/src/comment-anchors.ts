import { getSchema } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import {
  absolutePositionToRelativePosition,
  prosemirrorToYXmlFragment,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { QUOTED_TEXT_MAX_LENGTH, YJS_FRAGMENT_NAME, encodeDocumentCoverage } from '@conote/shared';
import { InvalidEditorContentError, ydocToContent } from './collaboration-content.js';
import { createDefaultRegistry } from './registry.js';

/*
 * Comment anchors and restore planning (Phase 8; D8, D9; WEBSOCKET_PROTOCOL §8).
 *
 * An anchor is a pair of Yjs Relative Positions, stored as bytes in PostgreSQL. A relative
 * position names an operation of the document, not an offset, so it follows its text through
 * concurrent edits. Nothing here is written into the document: no marks, no nodes (D8).
 *
 *   start: sticks to the character after it (assoc 0)  → typing at the start boundary is outside
 *   end:   sticks to the character before it (assoc -1) → typing after the last character is outside
 *   typing inside the range extends it.
 */

export interface CommentAnchor {
  start: Uint8Array;
  end: Uint8Array;
}

export interface AnchorRange {
  from: number;
  to: number;
}

export interface CreatedAnchor {
  anchor: CommentAnchor;
  quotedText: string;
}

interface SyncContext {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Map<unknown, unknown>;
}

/** The Yjs side of an editor state; `null` while the Yjs binding is not attached yet. */
export function syncContextOf(state: EditorState): SyncContext | null {
  const sync = ySyncPluginKey.getState(state) as
    | { doc?: Y.Doc; type?: Y.XmlFragment; binding?: { mapping: Map<unknown, unknown> } | null }
    | undefined;
  if (!sync?.doc || !sync.type || !sync.binding) return null;
  return { doc: sync.doc, type: sync.type, mapping: sync.binding.mapping };
}

/**
 * Anchor the selection `[from, to)` of a collaborative editor. Returns `null` for an empty range
 * or when the document is not bound to Yjs. The quoted text is the selected text at this moment,
 * kept for display if the anchor is detached later.
 */
export function createCommentAnchor(
  state: EditorState,
  from: number,
  to: number,
): CreatedAnchor | null {
  const sync = syncContextOf(state);
  if (sync === null || from >= to) return null;
  const startRel = absolutePositionToRelativePosition(from, sync.type, sync.mapping as never);
  const endRel = absolutePositionToRelativePosition(to, sync.type, sync.mapping as never);
  // y-tiptap anchors both ends to the character before them; the start must follow the
  // character after it, or text typed right before the range would join the highlight.
  const absStart = Y.createAbsolutePositionFromRelativePosition(startRel, sync.doc);
  // At index 0 y-tiptap's own position (the start of the text node) is kept: it cannot resolve
  // a character-level position there. Typing exactly at the very start of a paragraph therefore
  // joins a range that starts at that paragraph's first character (documented edge, D8).
  const start =
    absStart !== null && absStart.type instanceof Y.XmlText && absStart.index > 0
      ? Y.createRelativePositionFromTypeIndex(absStart.type, absStart.index, 0)
      : startRel;
  return {
    anchor: { start: Y.encodeRelativePosition(start), end: Y.encodeRelativePosition(endRel) },
    quotedText: state.doc.textBetween(from, to, ' ').slice(0, QUOTED_TEXT_MAX_LENGTH),
  };
}

function decode(bytes: Uint8Array): Y.RelativePosition | null {
  try {
    return Y.decodeRelativePosition(bytes);
  } catch {
    return null;
  }
}

/**
 * Where an anchor is now, in ProseMirror positions, or `null` when it is detached: a part
 * cannot be resolved (its content is gone, or the bytes are damaged) or the range has collapsed
 * because everything it covered was deleted. Reads the Yjs document, so it is correct after
 * remote edits too (AC-8.1, AC-8.3).
 */
export function resolveCommentAnchor(
  state: EditorState,
  anchor: CommentAnchor,
): AnchorRange | null {
  const sync = syncContextOf(state);
  if (sync === null) return null;
  const startRel = decode(anchor.start);
  const endRel = decode(anchor.end);
  if (startRel === null || endRel === null) return null;
  const from = relativePositionToAbsolutePosition(
    sync.doc,
    sync.type,
    startRel,
    sync.mapping as never,
  );
  const to = relativePositionToAbsolutePosition(sync.doc, sync.type, endRel, sync.mapping as never);
  if (from === null || to === null) return null;
  const size = state.doc.content.size;
  if (from < 0 || to > size || from >= to) return null;
  return { from, to };
}

/**
 * The same decision on a bare `Y.Doc`, for the collaboration server (no editor there): used after
 * a restore to mark threads whose anchor no longer resolves (U8). Equivalent to
 * `resolveCommentAnchor` except that a range that spans several text nodes counts as alive while
 * a node boundary lies inside it.
 */
export function anchorStatusInDoc(doc: Y.Doc, anchor: CommentAnchor): 'ACTIVE' | 'DETACHED' {
  const startRel = decode(anchor.start);
  const endRel = decode(anchor.end);
  if (startRel === null || endRel === null) return 'DETACHED';
  const root = doc.getXmlFragment(YJS_FRAGMENT_NAME);
  const start = Y.createAbsolutePositionFromRelativePosition(startRel, doc);
  const end = Y.createAbsolutePositionFromRelativePosition(endRel, doc);
  if (start === null || end === null) return 'DETACHED';
  for (const position of [start, end]) {
    if (position.type !== root && !Y.isParentOf(root, position.type._item)) return 'DETACHED';
  }
  if (start.type === end.type && start.index >= end.index) return 'DETACHED';
  return 'ACTIVE';
}

// ───────────── Restore planning (D9) ─────────────

let cachedSchema: ReturnType<typeof getSchema> | undefined;
function schema() {
  cachedSchema ??= getSchema(createDefaultRegistry({ undoRedo: false }).extensions());
  return cachedSchema;
}

/**
 * The update that turns the document described by `liveState` into the content of the snapshot
 * `targetState`, or `null` when they already have the same content. Applied to the live
 * document in one transaction it **is** the restore: history is kept, nothing is rewound (D9).
 *
 * The change is computed on a scratch copy and returned as a delta, so applying it to the live
 * document is a single `Y.applyUpdate`: it cannot half-apply, and a snapshot whose content is not
 * a valid page throws `InvalidEditorContentError` before the live document is touched.
 * ProseMirror's structural diff keeps every paragraph, mark and text run that is unchanged, so
 * comment anchors on unchanged text survive a restore.
 */
export function planRestore(liveState: Uint8Array, targetState: Uint8Array): Uint8Array | null {
  const target = new Y.Doc();
  const working = new Y.Doc();
  try {
    Y.applyUpdate(target, targetState);
    const node = ProseMirrorNode.fromJSON(schema(), ydocToContent(target));
    Y.applyUpdate(working, liveState);
    const before = Buffer.from(encodeDocumentCoverage(working));
    prosemirrorToYXmlFragment(node, working.getXmlFragment(YJS_FRAGMENT_NAME));
    // Same coverage (state vector + delete set) = nothing was inserted or deleted: already equal.
    // (An update always carries the whole delete set, so its size cannot tell.)
    if (before.equals(Buffer.from(encodeDocumentCoverage(working)))) return null;
    return Y.encodeStateAsUpdate(working, Y.encodeStateVectorFromUpdate(liveState));
  } finally {
    target.destroy();
    working.destroy();
  }
}

export { InvalidEditorContentError };
