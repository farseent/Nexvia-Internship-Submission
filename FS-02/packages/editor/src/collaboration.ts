import { Collaboration } from '@tiptap/extension-collaboration';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { YJS_FRAGMENT_NAME } from '@conote/shared';
import type { BaseExtensionOptions } from './extensions.js';
import { createCommentHighlights, type CommentHighlightOptions } from './comment-highlights.js';
import { createPresenceCaret, type PresenceCaretOptions } from './presence-caret.js';
import { createDefaultRegistry, type ExtensionRegistry } from './registry.js';

/*
 * The Yjs binding of the editor (Phase 5, D20, D57). It lives behind its own entry point,
 * `@conote/editor/collaboration`, so the single-user editor of Phase 4 does not load it until
 * the web app switches over in Phase 6.
 */

export { YJS_FRAGMENT_NAME };

/**
 * The editor's default features bound to `document`: the Collaboration extension keeps the
 * rich text in the `Y.XmlFragment` named `YJS_FRAGMENT_NAME`. Tiptap's own undo/redo is
 * removed because Collaboration brings a history that undoes only the user's own changes;
 * having both would be wrong (D20, AC-4.6). Everything else is the Phase 4 editor, unchanged.
 */
export function createCollaborativeRegistry(
  document: Y.Doc,
  options: BaseExtensionOptions & {
    /**
     * The connection's awareness (Phase 7). When given, collaborators' carets and selections
     * are drawn and this editor's cursor is published through it. Presence is separate from
     * the document: it is never stored (WEBSOCKET_PROTOCOL §18).
     */
    awareness?: Awareness;
    presence?: PresenceCaretOptions;
    /** Comment highlights (Phase 8): drawn from thread data as decorations, never stored in the document. */
    comments?: CommentHighlightOptions;
  } = {},
): ExtensionRegistry {
  const { awareness, presence, comments, ...base } = options;
  const registry = createDefaultRegistry({ ...base, undoRedo: false }).register({
    id: 'collaboration',
    extensions: [Collaboration.configure({ document, field: YJS_FRAGMENT_NAME })],
  });
  // After Collaboration: the cursor plugin reads the Yjs sync plugin's state.
  if (awareness) {
    registry.register({
      id: 'presence-caret',
      extensions: [createPresenceCaret(awareness, presence)],
    });
  }
  if (comments) {
    registry.register({
      id: 'comment-highlights',
      extensions: [createCommentHighlights(comments)],
    });
  }
  return registry;
}

export {
  InvalidEditorContentError,
  contentToYDoc,
  ydocToContent,
} from './collaboration-content.js';
export {
  anchorStatusInDoc,
  createCommentAnchor,
  planRestore,
  resolveCommentAnchor,
  syncContextOf,
  type AnchorRange,
  type CommentAnchor,
  type CreatedAnchor,
} from './comment-anchors.js';
export {
  COMMENT_HIGHLIGHT_KEY,
  createCommentHighlights,
  setActiveCommentThread,
  setCommentThreads,
  type CommentHighlightOptions,
  type CommentHighlightThread,
  type ResolvedRanges,
} from './comment-highlights.js';
