import { getSchema } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import type * as Y from 'yjs';
import {
  YJS_FRAGMENT_NAME,
  emptyEditorDocument,
  validateEditorDocument,
  type EditorContentIssue,
  type EditorDocument,
} from '@conote/shared';
import { createDefaultRegistry } from './registry.js';

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
