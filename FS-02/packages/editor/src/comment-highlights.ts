import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Transaction } from 'yjs';
import {
  resolveCommentAnchor,
  syncContextOf,
  type AnchorRange,
  type CommentAnchor,
} from './comment-anchors.js';

/*
 * Comment highlights (Phase 8, FR-CM-03, D8). Decorations only: they are drawn over the text and
 * are not part of the document, the Yjs fragment, `editor.getJSON()` or anything stored.
 *
 * Where a thread is drawn is always computed from its relative positions in the *Yjs* document,
 * which is what makes highlights follow the text through other people's edits. Between two
 * recomputations the decorations are mapped through ProseMirror transactions, so typing is never
 * drawn at a stale offset. A recomputation runs after every Yjs transaction, once the binding has
 * brought the editor up to date (a local edit reaches Yjs only after the editor update).
 */

export interface CommentHighlightThread {
  id: string;
  anchor: CommentAnchor;
  /** Resolved threads are not drawn, but their position is still tracked. */
  resolved: boolean;
}

/** Where each thread is now; `null` = detached. */
export type ResolvedRanges = ReadonlyMap<string, AnchorRange | null>;

export interface CommentHighlightOptions {
  /** Called when the position or detached state of any thread changed. */
  onResolved?: (ranges: ResolvedRanges) => void;
  /** False while the document has not synced yet: nothing is judged detached before then. */
  isReady?: () => boolean;
  /** Class of the highlight and of the highlighted active thread. */
  className?: string;
  activeClassName?: string;
}

interface HighlightState {
  threads: readonly CommentHighlightThread[];
  activeId: string | null;
  ranges: Map<string, AnchorRange | null>;
  decorations: DecorationSet;
}

export const COMMENT_HIGHLIGHT_KEY = new PluginKey<HighlightState>('conoteCommentHighlights');

const DEFAULT_CLASS = 'conote-comment-highlight';
const DEFAULT_ACTIVE_CLASS = 'conote-comment-highlight-active';

type Meta =
  | { type: 'threads'; threads: readonly CommentHighlightThread[] }
  | { type: 'active'; id: string | null }
  | { type: 'recompute' };

function sameRanges(a: ResolvedRanges, b: ResolvedRanges): boolean {
  if (a.size !== b.size) return false;
  for (const [id, range] of a) {
    if (!b.has(id)) return false;
    const other = b.get(id) ?? null;
    if (range === null || other === null) {
      if (range !== other) return false;
    } else if (range.from !== other.from || range.to !== other.to) return false;
  }
  return true;
}

function build(
  state: EditorState,
  threads: readonly CommentHighlightThread[],
  activeId: string | null,
  options: CommentHighlightOptions,
): { ranges: Map<string, AnchorRange | null>; decorations: DecorationSet } {
  const ranges = new Map<string, AnchorRange | null>();
  const decorations: Decoration[] = [];
  for (const thread of threads) {
    const range = resolveCommentAnchor(state, thread.anchor);
    ranges.set(thread.id, range);
    if (range === null || thread.resolved) continue;
    const className =
      thread.id === activeId
        ? `${options.className ?? DEFAULT_CLASS} ${options.activeClassName ?? DEFAULT_ACTIVE_CLASS}`
        : (options.className ?? DEFAULT_CLASS);
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: className,
        'data-comment-thread': thread.id,
      }),
    );
  }
  return { ranges, decorations: DecorationSet.create(state.doc, decorations) };
}

export function createCommentHighlights(options: CommentHighlightOptions = {}): Extension {
  const ready = () => options.isReady?.() ?? true;
  return Extension.create({
    name: 'conoteCommentHighlights',
    addProseMirrorPlugins() {
      return [
        new Plugin<HighlightState>({
          key: COMMENT_HIGHLIGHT_KEY,
          state: {
            init: () => ({
              threads: [],
              activeId: null,
              ranges: new Map(),
              decorations: DecorationSet.empty,
            }),
            apply(tr, value, _old, next) {
              const meta = tr.getMeta(COMMENT_HIGHLIGHT_KEY) as Meta | undefined;
              let { threads, activeId } = value;
              let rebuild = false;
              if (meta?.type === 'threads') {
                threads = meta.threads;
                rebuild = true;
              } else if (meta?.type === 'active') {
                activeId = meta.id;
                rebuild = true;
              } else if (meta?.type === 'recompute') {
                rebuild = true;
              }
              if (rebuild && syncContextOf(next) !== null && ready()) {
                return { threads, activeId, ...build(next, threads, activeId, options) };
              }
              if (tr.docChanged) {
                return {
                  ...value,
                  threads,
                  activeId,
                  decorations: value.decorations.map(tr.mapping, tr.doc),
                };
              }
              return { ...value, threads, activeId };
            },
          },
          props: {
            decorations: (state) => COMMENT_HIGHLIGHT_KEY.getState(state)?.decorations,
          },
          view(view) {
            const ydoc = syncContextOf(view.state)?.doc ?? null;
            let scheduled = false;
            let reported: ResolvedRanges = new Map();
            const report = () => {
              const ranges = COMMENT_HIGHLIGHT_KEY.getState(view.state)?.ranges;
              if (ranges && !sameRanges(ranges, reported)) {
                reported = new Map(ranges);
                options.onResolved?.(reported);
              }
            };
            const schedule = (transaction: Transaction) => {
              // The sync plugin opens an empty Yjs transaction on every editor update; reacting
              // to those would loop. Only a transaction that changed something matters.
              if (transaction.changed.size === 0 && transaction.deleteSet.clients.size === 0)
                return;
              if (scheduled) return;
              scheduled = true;
              queueMicrotask(() => {
                scheduled = false;
                if (view.isDestroyed) return;
                const meta: Meta = { type: 'recompute' };
                view.dispatch(
                  view.state.tr.setMeta(COMMENT_HIGHLIGHT_KEY, meta).setMeta('addToHistory', false),
                );
              });
            };
            ydoc?.on('afterTransaction', schedule);
            return {
              update: report,
              destroy() {
                ydoc?.off('afterTransaction', schedule);
              },
            };
          },
        }),
      ];
    },
  });
}

/** Replace the threads that are drawn and tracked. */
export function setCommentThreads(
  editor: Editor,
  threads: readonly CommentHighlightThread[],
): void {
  if (editor.isDestroyed) return;
  const meta: Meta = { type: 'threads', threads };
  editor.view.dispatch(
    editor.state.tr.setMeta(COMMENT_HIGHLIGHT_KEY, meta).setMeta('addToHistory', false),
  );
}

/** Mark one thread as the active one (drawn stronger); `null` clears it. */
export function setActiveCommentThread(editor: Editor, id: string | null): void {
  if (editor.isDestroyed) return;
  const meta: Meta = { type: 'active', id };
  editor.view.dispatch(
    editor.state.tr.setMeta(COMMENT_HIGHLIGHT_KEY, meta).setMeta('addToHistory', false),
  );
}
