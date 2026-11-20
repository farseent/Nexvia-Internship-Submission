// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetUrl, validateEditorDocument, type EditorNode } from '@conote/shared';
import { createDefaultRegistry, createEditorExtensions } from './registry.js';
import {
  BASE_SLASH_COMMANDS,
  IMAGE_SLASH_COMMAND,
  TABLE_SLASH_COMMAND,
  TASK_LIST_SLASH_COMMAND,
} from './slash-commands.js';

const ASSET_ID = '0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const editors: Editor[] = [];

function create(
  content = '<p>hello world</p>',
  options: { undoRedo?: boolean; host?: { requestImage?: () => void } } = {},
) {
  const registry = createDefaultRegistry(
    options.undoRedo === undefined ? {} : { undoRedo: options.undoRedo },
  );
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(registry, { host: options.host ?? {} }),
    content,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

/** The editor's JSON must always satisfy the shared validator (what the API enforces). */
function json(editor: Editor): { type: 'doc'; content: EditorNode[] } {
  const value = editor.getJSON();
  const result = validateEditorDocument(value);
  expect(result.ok, JSON.stringify(result.ok ? [] : result.issues)).toBe(true);
  return value as { type: 'doc'; content: EditorNode[] };
}
const first = (editor: Editor) => json(editor).content[0]!;

describe('formatting features', () => {
  it('headings 1-3 and paragraphs', () => {
    const editor = create();
    for (const level of [1, 2, 3] as const) {
      editor.chain().focus().setHeading({ level }).run();
      expect(first(editor)).toMatchObject({ type: 'heading', attrs: { level } });
    }
    editor.chain().focus().setParagraph().run();
    expect(first(editor).type).toBe('paragraph');
    expect(editor.can().setHeading({ level: 4 as 1 })).toBe(false);
  });

  it('bold, italic and underline', () => {
    const editor = create();
    editor.chain().focus().selectAll().toggleBold().toggleItalic().toggleUnderline().run();
    const marks = first(editor)
      .content![0]!.marks!.map((m) => m.type)
      .sort();
    expect(marks).toEqual(['bold', 'italic', 'underline']);
    editor.chain().focus().selectAll().toggleBold().run();
    expect(first(editor).content![0]!.marks!.map((m) => m.type)).not.toContain('bold');
  });

  it('bullet, ordered and nested lists', () => {
    const editor = create();
    editor.chain().focus().toggleBulletList().run();
    expect(first(editor).type).toBe('bulletList');
    editor.chain().focus().toggleOrderedList().run();
    expect(first(editor).type).toBe('orderedList');
    editor.chain().focus().splitListItem('listItem').sinkListItem('listItem').run();
    expect(JSON.stringify(json(editor))).toContain('"listItem"');
  });

  it('checklists with toggleable items', () => {
    const editor = create();
    editor.chain().focus().toggleTaskList().run();
    expect(first(editor).type).toBe('taskList');
    expect(first(editor).content![0]).toMatchObject({
      type: 'taskItem',
      attrs: { checked: false },
    });
    editor.chain().focus().updateAttributes('taskItem', { checked: true }).run();
    expect(first(editor).content![0]!.attrs).toMatchObject({ checked: true });
  });

  it('links accept http(s) and mailto, and refuse javascript:', () => {
    const editor = create();
    editor.chain().focus().selectAll().setLink({ href: 'https://example.com/a?b=1' }).run();
    expect(first(editor).content![0]!.marks![0]).toMatchObject({
      type: 'link',
      attrs: { href: 'https://example.com/a?b=1' },
    });
    editor.chain().focus().selectAll().unsetLink().run();
    expect(first(editor).content![0]!.marks).toBeUndefined();
    expect(editor.can().setLink({ href: 'javascript:alert(1)' })).toBe(false);
    editor.chain().focus().selectAll().setLink({ href: 'mailto:a@b.co' }).run();
    expect(first(editor).content![0]!.marks![0]!.attrs).toMatchObject({ href: 'mailto:a@b.co' });
  });

  it('images from the asset URL; external and data: images are dropped', () => {
    const editor = create();
    editor
      .chain()
      .focus()
      .setImage({ src: assetUrl(ASSET_ID), alt: 'a chart' })
      .run();
    expect(
      json(editor).content.some(
        (n) => n.type === 'image' && n.attrs?.['src'] === assetUrl(ASSET_ID),
      ),
    ).toBe(true);
    for (const html of [
      '<img src="https://evil.example/x.png">',
      '<img src="data:image/png;base64,AAAA">',
    ]) {
      const other = create(html);
      expect(JSON.stringify(json(other))).not.toContain('"image"');
    }
    expect(JSON.stringify(json(create(`<img src="${assetUrl(ASSET_ID)}">`)))).toContain('"image"');
  });

  it('tables: insert, add/remove rows and columns, delete', () => {
    const editor = create();
    const tables = () => json(editor).content.filter((n) => n.type === 'table');
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    expect(tables()).toHaveLength(1);
    expect(tables()[0]!.content).toHaveLength(3);
    expect(tables()[0]!.content![0]!.content![0]!.type).toBe('tableHeader');
    // One command per call, as the toolbar issues them.
    editor.chain().focus().addRowAfter().run();
    editor.chain().focus().addColumnAfter().run();
    expect(tables()).toHaveLength(1);
    expect(tables()[0]!.content).toHaveLength(4);
    expect(tables()[0]!.content![0]!.content).toHaveLength(4);
    editor.chain().focus().deleteRow().run();
    editor.chain().focus().deleteColumn().run();
    expect(tables()[0]!.content).toHaveLength(3);
    expect(tables()[0]!.content![0]!.content).toHaveLength(3);
    editor.chain().focus().deleteTable().run();
    expect(tables()).toHaveLength(0);
  });

  it('nested tables in pasted HTML never produce an invalid document', () => {
    const editor = create('<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>');
    // `json()` runs the shared validator, which forbids a table inside a cell.
    expect(JSON.stringify(json(editor))).toContain('"x"');
  });

  it('text alignment on paragraphs and headings', () => {
    const editor = create();
    for (const alignment of ['center', 'right', 'justify', 'left'] as const) {
      editor.chain().focus().setTextAlign(alignment).run();
      expect(first(editor).attrs?.['textAlign']).toBe(alignment);
    }
    editor.chain().focus().setHeading({ level: 2 }).setTextAlign('right').run();
    expect(first(editor).attrs).toMatchObject({ level: 2, textAlign: 'right' });
  });

  it('pasted unsupported formatting is dropped instead of breaking the schema', () => {
    const editor = create(
      '<blockquote><p>q</p></blockquote><pre><code>c</code></pre><p><s>s</s><code>k</code></p><hr>',
    );
    expect(JSON.stringify(json(editor))).not.toMatch(
      /blockquote|codeBlock|strike|"code"|horizontalRule/,
    );
  });
});

describe('editor state', () => {
  it('undo and redo work by default', () => {
    const editor = create();
    editor.chain().focus().selectAll().toggleBold().run();
    editor.commands.undo();
    expect(first(editor).content![0]!.marks).toBeUndefined();
    editor.commands.redo();
    expect(first(editor).content![0]!.marks).toBeDefined();
  });

  it('built-in undo/redo can be removed for the collaboration binding (AC-4.6)', () => {
    const names = (editor: Editor) => editor.extensionManager.extensions.map((e) => e.name);
    expect(names(create())).toContain('undoRedo');
    expect(names(create('<p>x</p>', { undoRedo: false }))).not.toContain('undoRedo');
  });

  it('a read-only editor refuses changes', () => {
    const editor = create();
    editor.setEditable(false);
    expect(editor.isEditable).toBe(false);
  });

  it('round-trips: JSON in, same JSON out', () => {
    const editor = create();
    editor.chain().focus().toggleTaskList().insertContent('todo').run();
    const saved = json(editor);
    const reloaded = new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions(createDefaultRegistry()),
      content: saved,
    });
    editors.push(reloaded);
    expect(reloaded.getJSON()).toEqual(saved);
  });

  it('reports invalid content instead of silently rewriting it', () => {
    const onContentError = vi.fn();
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions(createDefaultRegistry()),
      content: { type: 'doc', content: [{ type: 'mystery', content: [] }] },
      enableContentCheck: true,
      onContentError,
    });
    editors.push(editor);
    expect(onContentError).toHaveBeenCalled();
  });
});

describe('slash commands act on the document', () => {
  const run = (editor: Editor, id: string, host = {}) => {
    editor.commands.setContent('<p>/xx</p>');
    editor.commands.focus('end');
    const end = editor.state.selection.from;
    const command = [
      ...BASE_SLASH_COMMANDS,
      TASK_LIST_SLASH_COMMAND,
      TABLE_SLASH_COMMAND,
      IMAGE_SLASH_COMMAND,
    ].find((c) => c.id === id)!;
    command.run({ editor, range: { from: end - 3, to: end }, host });
  };

  it.each([
    ['heading-1', 'heading'],
    ['heading-3', 'heading'],
    ['bullet-list', 'bulletList'],
    ['ordered-list', 'orderedList'],
    ['task-list', 'taskList'],
    ['table', 'table'],
  ])('%s', (id, nodeType) => {
    const editor = create();
    run(editor, id);
    expect(json(editor).content.some((n) => n.type === nodeType)).toBe(true);
    expect(JSON.stringify(json(editor))).not.toContain('/xx');
  });

  it('image asks the host to open its picker', () => {
    const requestImage = vi.fn();
    const editor = create('<p></p>', { host: { requestImage } });
    run(editor, 'image', { requestImage });
    expect(requestImage).toHaveBeenCalledOnce();
  });
});
