import { describe, expect, it } from 'vitest';
import {
  COMPACTION_UPDATE_THRESHOLD,
  DOCUMENT_NAME_PREFIX,
  YJS_FRAGMENT_NAME,
  documentNameForPage,
  pageIdFromDocumentName,
} from './collab.js';

const PAGE_ID = '0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('document names', () => {
  it('builds page:<pageId> and parses it back', () => {
    expect(documentNameForPage(PAGE_ID)).toBe(`page:${PAGE_ID}`);
    expect(pageIdFromDocumentName(`page:${PAGE_ID}`)).toBe(PAGE_ID);
    expect(DOCUMENT_NAME_PREFIX).toBe('page:');
  });

  it('normalizes the case of the id', () => {
    expect(documentNameForPage(PAGE_ID.toUpperCase())).toBe(`page:${PAGE_ID}`);
    expect(pageIdFromDocumentName(`page:${PAGE_ID.toUpperCase()}`)).toBe(PAGE_ID);
  });

  it('refuses anything that is not a page UUID', () => {
    expect(() => documentNameForPage('not-a-uuid')).toThrow();
    expect(() => documentNameForPage('')).toThrow();
    for (const name of ['', 'page:', 'page:123', `doc:${PAGE_ID}`, `page:${PAGE_ID}/x`, PAGE_ID]) {
      expect(pageIdFromDocumentName(name)).toBeNull();
    }
  });

  it('keeps the constants other code depends on', () => {
    expect(YJS_FRAGMENT_NAME).toBe('default');
    expect(COMPACTION_UPDATE_THRESHOLD).toBe(200);
  });
});
