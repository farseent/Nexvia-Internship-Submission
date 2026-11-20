import { getSchema } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import {
  YJS_FRAGMENT_NAME,
  emptyEditorDocument,
  validateEditorDocument,
  type EditorContentIssue,
  type EditorDocument,
} from '@conote/shared';
import type { BaseExtensionOptions } from './extensions.js';
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
  } = {},
): ExtensionRegistry {
  const { awareness, presence, ...base } = options;
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
  return registry;
}

export class InvalidEditorContentError extends Error {
  constructor(readonly issues: EditorContentIssue[]) {
    super(`The content is not a valid editor document: ${issues[0]?.message ?? 'unknown reason'}`);
    this.name = 'InvalidEditorContentError';
  }
}

let cachedSchema: Schema | undefined;

/** The ProseMirror schema of the default editor (the document schema v1, D56). */
function documentSchema(): Schema {
  cachedSchema ??= getSchema(createDefaultRegistry({ undoRedo: false }).extensions());
  return cachedSchema;
}

/**
 * A new `Y.Doc` holding `content` (validated ProseMirror JSON, D56) in the editor's fragment.
 * Used by the server to seed a page that has no Yjs state yet, from the interim
 * `page_contents` (D54). **Never call this in a client:** every call creates new operations
 * under a new client id, so two clients that each seed the same page would both keep the text
 * and show it twice. `DocumentStore.seedIfEmpty` makes the seeding happen exactly once.
 */
export function contentToYDoc(content: unknown): Y.Doc {
  const validation = validateEditorDocument(content);
  if (!validation.ok) throw new InvalidEditorContentError(validation.issues);
  return prosemirrorJSONToYDoc(documentSchema(), validation.document, YJS_FRAGMENT_NAME);
}

/** The document of `doc` as validated editor JSON; an empty fragment is one empty paragraph. */
export function ydocToContent(doc: Y.Doc): EditorDocument {
  if (doc.getXmlFragment(YJS_FRAGMENT_NAME).length === 0) return emptyEditorDocument();
  // The Yjs binding does not store attributes that are `null` (the schema default), so the raw
  // JSON lacks `textAlign: null`, `alt: null` and so on. Reading it through the schema puts the
  // defaults back, which makes the result identical in shape to `editor.getJSON()` (Phase 4).
  const normalized = ProseMirrorNode.fromJSON(
    documentSchema(),
    yDocToProsemirrorJSON(doc, YJS_FRAGMENT_NAME),
  ).toJSON() as unknown;
  const validation = validateEditorDocument(normalized);
  if (!validation.ok) throw new InvalidEditorContentError(validation.issues);
  return validation.document;
}
