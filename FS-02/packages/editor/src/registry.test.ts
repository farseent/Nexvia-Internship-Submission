import { Mark, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { ExtensionRegistry, createDefaultRegistry, createEditorExtensions } from './registry.js';

describe('ExtensionRegistry', () => {
  it('registers the approved features', () => {
    expect(createDefaultRegistry().ids()).toEqual([
      'core',
      'task-list',
      'table',
      'text-align',
      'image',
      'placeholder',
    ]);
  });

  it('accepts a new feature without changing core code (AC-4.2)', () => {
    const Highlight = Mark.create({
      name: 'highlight',
      parseHTML: () => [{ tag: 'mark' }],
      renderHTML: () => ['mark', 0],
    });
    const registry = createDefaultRegistry().register({
      id: 'highlight',
      extensions: [Highlight],
      slashCommands: [
        {
          id: 'highlight',
          title: 'Highlight',
          description: 'x',
          keywords: [],
          run: () => undefined,
        },
      ],
    });
    expect(getSchema(registry.extensions()).marks['highlight']).toBeDefined();
    expect(registry.slashCommands().map((c) => c.id)).toContain('highlight');
  });

  it('rejects duplicate ids and supports unregister', () => {
    const registry = new ExtensionRegistry().register({ id: 'a', extensions: [] });
    expect(() => registry.register({ id: 'a', extensions: [] })).toThrow(/already registered/);
    expect(registry.unregister('a')).toBe(true);
    expect(registry.has('a')).toBe(false);
  });

  it('leaves out features outside the approved schema', () => {
    const names = createEditorExtensions(createDefaultRegistry()).map((e) => e.name);
    for (const unwanted of ['blockquote', 'codeBlock', 'code', 'strike', 'horizontalRule']) {
      expect(names).not.toContain(unwanted);
    }
  });
});
