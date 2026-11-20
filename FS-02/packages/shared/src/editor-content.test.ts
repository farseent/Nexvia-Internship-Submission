import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_DEPTH,
  MAX_DOCUMENT_NODES,
  editorDocumentSchema,
  emptyEditorDocument,
  isAllowedLinkHref,
  normalizeLinkInput,
  validateEditorDocument,
} from './index.js';

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const issues = (value: unknown) => {
  const result = validateEditorDocument(value);
  return result.ok ? [] : result.issues;
};

describe('validateEditorDocument', () => {
  it('accepts the empty document and plain text', () => {
    expect(validateEditorDocument(emptyEditorDocument()).ok).toBe(true);
    expect(validateEditorDocument(doc(p('hello'))).ok).toBe(true);
  });

  it('rejects non-documents', () => {
    for (const value of [null, 'x', 1, [], {}, { type: 'paragraph' }, { type: 'doc' }, doc()]) {
      expect(validateEditorDocument(value).ok).toBe(false);
    }
  });

  it('reports a path for each problem and never echoes content', () => {
    const [issue] = issues(
      doc(p('secret text'), { type: 'heading', attrs: { level: 9 }, content: [] }),
    );
    expect(issue).toEqual({
      path: ['content', 1, 'attrs', 'level'],
      message: 'Invalid attribute value.',
    });
    expect(JSON.stringify(issues(doc({ type: 'mystery', text: 'secret text' })))).not.toContain(
      'secret',
    );
  });

  it('rejects unknown node fields, attributes and marks, and marks on blocks', () => {
    expect(issues(doc({ ...p('x'), extra: 1 }))[0]?.message).toBe('Unknown node field.');
    expect(issues(doc({ type: 'paragraph', attrs: { style: 'x' } }))[0]?.message).toBe(
      'Unknown attribute.',
    );
    expect(issues(doc({ type: 'paragraph', marks: [{ type: 'bold' }] }))[0]?.message).toBe(
      'Marks are only allowed on inline content.',
    );
    expect(
      issues(
        doc({
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }],
        }),
      )[0]?.message,
    ).toBe('Duplicate mark.');
  });

  it('rejects empty text nodes and text on non-text nodes', () => {
    expect(
      issues(doc({ type: 'paragraph', content: [{ type: 'text', text: '' }] })).length,
    ).toBeGreaterThan(0);
    expect(issues(doc({ type: 'paragraph', text: 'x' }))[0]?.message).toBe(
      'Only text nodes have text.',
    );
  });

  it('does not trust prototype-looking keys', () => {
    const hostile = JSON.parse(
      '{"type":"doc","content":[{"type":"paragraph","attrs":{"__proto__":{"x":1}}}]}',
    );
    expect(validateEditorDocument(hostile).ok).toBe(false);
    expect(validateEditorDocument(doc({ type: 'constructor' })).ok).toBe(false);
  });

  it('limits size, depth and node count', () => {
    expect(validateEditorDocument(doc(p('x'.repeat(MAX_DOCUMENT_BYTES)))).ok).toBe(false);
    let nested: unknown = p('x');
    for (let i = 0; i < MAX_DOCUMENT_DEPTH; i += 1) {
      nested = {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph' }, nested] }],
      };
    }
    expect(issues(doc(nested))[0]?.message).toBe('The document is nested too deeply.');
    const many = Array.from({ length: MAX_DOCUMENT_NODES }, () => ({ type: 'paragraph' }));
    expect(issues(doc(...many))[0]?.message).toBe('The document has too many nodes.');
  });

  it('stops reporting after a bounded number of issues', () => {
    expect(
      issues(doc(...Array.from({ length: 200 }, () => ({ type: 'nope' })))).length,
    ).toBeLessThanOrEqual(20);
  });

  it('checks link targets and image sources', () => {
    const link = (href: string) =>
      doc({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
      });
    expect(validateEditorDocument(link('https://example.com')).ok).toBe(true);
    expect(validateEditorDocument(link('javascript:alert(1)')).ok).toBe(false);
    expect(validateEditorDocument(link('/relative')).ok).toBe(false);
    const image = (src: string) => doc({ type: 'image', attrs: { src } });
    expect(
      validateEditorDocument(image('/api/v1/assets/0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')).ok,
    ).toBe(true);
    expect(validateEditorDocument(image('/api/v1/assets/../../etc/passwd')).ok).toBe(false);
    expect(validateEditorDocument(image('https://example.com/a.png')).ok).toBe(false);
  });
});

describe('links', () => {
  it('allows http, https and mailto only', () => {
    for (const ok of ['http://a.co', 'https://a.co/x?y=1#z', 'mailto:me@a.co'])
      expect(isAllowedLinkHref(ok)).toBe(true);
    for (const bad of [
      '',
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://a.co',
      'https://',
      'https://a b.co',
      'a.co',
      `https://a.co/${'x'.repeat(2100)}`,
      5,
      null,
    ]) {
      expect(isAllowedLinkHref(bad)).toBe(false);
    }
  });

  it('normalizes what people type', () => {
    expect(normalizeLinkInput(' example.com/page ')).toBe('https://example.com/page');
    expect(normalizeLinkInput('me@example.com')).toBe('mailto:me@example.com');
    expect(normalizeLinkInput('http://example.com')).toBe('http://example.com/');
    expect(normalizeLinkInput('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkInput('   ')).toBeNull();
  });
});

describe('editor document schema', () => {
  it('is usable on its own', () => {
    expect(editorDocumentSchema.safeParse(emptyEditorDocument()).success).toBe(true);
  });
});
