/**
 * Names and tuning constants of collaborative documents (docs/ARCHITECTURE.md §7, §8).
 * Pure: no Yjs import, so anything may use it.
 */

/** A page's collaborative document is named `page:<pageId>` (WEBSOCKET_PROTOCOL §3). */
export const DOCUMENT_NAME_PREFIX = 'page:';

/**
 * Name of the `Y.XmlFragment` that holds the rich text. `default` is the field Tiptap's
 * Collaboration extension uses unless told otherwise; changing it would orphan stored content.
 */
export const YJS_FRAGMENT_NAME = 'default';

/** Initial compaction trigger: fold the stored updates into the state after this many rows (D15). */
export const COMPACTION_UPDATE_THRESHOLD = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function documentNameForPage(pageId: string): string {
  if (!UUID_PATTERN.test(pageId)) {
    throw new Error('A page id must be a UUID.');
  }
  return `${DOCUMENT_NAME_PREFIX}${pageId.toLowerCase()}`;
}

/** The page id of a document name, or `null` when the name is not `page:<uuid>`. */
export function pageIdFromDocumentName(documentName: string): string | null {
  if (!documentName.startsWith(DOCUMENT_NAME_PREFIX)) return null;
  const id = documentName.slice(DOCUMENT_NAME_PREFIX.length);
  return UUID_PATTERN.test(id) ? id.toLowerCase() : null;
}
