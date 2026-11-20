import { getSchema } from '@tiptap/core';
import { Node as PmNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { describeEditorSchema, validateEditorDocument } from '@conote/shared';
import { createDefaultRegistry } from './registry.js';

const schema = getSchema(createDefaultRegistry().extensions());
const norm = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim();
const ID = '0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const p = (text?: string) =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
const doc = (...content: unknown[]) => ({ type: 'doc', content });

function pmAccepts(json: unknown): boolean {
  try {
    PmNode.fromJSON(schema, json).check();
    return true;
  } catch {
    return false;
  }
}

describe('shared schema model vs the real ProseMirror schema', () => {
  const described = describeEditorSchema();

  it('has exactly the same node and mark names', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(Object.keys(described.nodes).sort());
    expect(Object.keys(schema.marks).sort()).toEqual(Object.keys(described.marks).sort());
  });

  it.each(Object.entries(described.nodes))(
    'node %s: content rule, group and attributes match',
    (name, model) => {
      const type = schema.nodes[name]!;
      expect(norm(type.spec.content)).toBe(norm(model.content));
      expect(norm(type.spec.group)).toBe(norm(model.group));
      expect(Object.keys(type.spec.attrs ?? {}).sort()).toEqual([...model.attrs].sort());
    },
  );

  it.each(Object.entries(described.marks))('mark %s: attributes match', (name, attrs) => {
    expect(Object.keys(schema.marks[name]!.spec.attrs ?? {}).sort()).toEqual([...attrs].sort());
  });
});

describe('validator and ProseMirror agree on structure', () => {
  const cases: [string, unknown, boolean][] = [
    ['empty paragraph', doc(p()), true],
    [
      'text with all marks',
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }],
          },
        ],
      }),
      true,
    ],
    [
      'heading level 2 aligned',
      doc({
        type: 'heading',
        attrs: { level: 2, textAlign: 'center' },
        content: [{ type: 'text', text: 'h' }],
      }),
      true,
    ],
    [
      'nested lists',
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              p('a'),
              { type: 'orderedList', content: [{ type: 'listItem', content: [p('b')] }] },
            ],
          },
        ],
      }),
      true,
    ],
    [
      'checklist',
      doc({
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('t')] }],
      }),
      true,
    ],
    [
      'table',
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [p('h')] },
              { type: 'tableCell', content: [p()] },
            ],
          },
        ],
      }),
      true,
    ],
    ['image', doc({ type: 'image', attrs: { src: `/api/v1/assets/${ID}`, alt: 'a' } }), true],
    [
      'hard break',
      doc({
        type: 'paragraph',
        content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }],
      }),
      true,
    ],
    ['no content in doc', { type: 'doc' }, false],
    ['empty list item', doc({ type: 'bulletList', content: [{ type: 'listItem' }] }), false],
    ['text directly in doc', doc({ type: 'text', text: 'x' }), false],
    ['list without items', doc({ type: 'bulletList' }), false],
    [
      'nested table in cell',
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'table',
                    content: [
                      { type: 'tableRow', content: [{ type: 'tableCell', content: [p()] }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      false,
    ],
    [
      'task item outside task list',
      doc({ type: 'bulletList', content: [{ type: 'taskItem', content: [p()] }] }),
      false,
    ],
    ['unknown node', doc({ type: 'blockquote', content: [p()] }), false],
    [
      'unknown mark',
      doc({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'strike' }] }],
      }),
      false,
    ],
    ['block inside paragraph', doc({ type: 'paragraph', content: [p('x')] }), false],
  ];

  it.each(cases)('%s', (_name, json, expected) => {
    expect(validateEditorDocument(json).ok).toBe(expected);
    expect(pmAccepts(json)).toBe(expected);
  });
});

describe('validator is stricter than ProseMirror on values', () => {
  const stricter: [string, unknown][] = [
    [
      'javascript: link',
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      }),
    ],
    ['external image', doc({ type: 'image', attrs: { src: 'https://example.com/a.png' } })],
    ['data: image', doc({ type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } })],
    [
      'heading level 4',
      doc({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'x' }] }),
    ],
    ['unknown attribute', doc({ type: 'paragraph', attrs: { onclick: 'x' } })],
    ['bad alignment', doc({ type: 'paragraph', attrs: { textAlign: 'diagonal' } })],
  ];

  it.each(stricter)('%s', (_name, json) => {
    expect(pmAccepts(json)).toBe(true);
    expect(validateEditorDocument(json).ok).toBe(false);
  });
});
