// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollaborativeRegistry, ydocToContent } from './collaboration.js';
import { CursorPublisher, buildCaret, buildSelection } from './presence-caret.js';
import { createEditorExtensions } from './registry.js';

const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace', color: '#4F46E5' };
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls a selection into view.
const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
Range.prototype.getBoundingClientRect = () => ({ ...emptyRect, toJSON: () => ({}) }) as DOMRect;
Range.prototype.getClientRects = () =>
  ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
document.elementFromPoint = () => null;

describe('CursorPublisher', () => {
  let awareness: Awareness;
  let now: number;
  let sent: unknown[];
  beforeEach(() => {
    vi.useFakeTimers();
    awareness = new Awareness(new Y.Doc());
    now = 1_000;
    sent = [];
    awareness.on('change', () => sent.push(awareness.getLocalState()?.cursor));
  });
  afterEach(() => {
    awareness.destroy();
    vi.useRealTimers();
  });

  it('sends the first change at once and holds back the ones in a burst, latest wins', () => {
    const publisher = new CursorPublisher(awareness, 100, () => now);
    publisher.publish({ n: 1 });
    now += 10;
    publisher.publish({ n: 2 });
    now += 10;
    publisher.publish({ n: 3 });
    expect(sent).toEqual([{ n: 1 }]);
    now += 100;
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([{ n: 1 }, { n: 3 }]);
  });

  it('sends a change after a quiet interval immediately', () => {
    const publisher = new CursorPublisher(awareness, 100, () => now);
    publisher.publish({ n: 1 });
    now += 500;
    publisher.publish({ n: 2 });
    expect(sent).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('never delays clearing the cursor and drops what was waiting', () => {
    const publisher = new CursorPublisher(awareness, 100, () => now);
    publisher.publish({ n: 1 });
    publisher.publish({ n: 2 });
    publisher.publish(null);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([{ n: 1 }, null]);
  });

  it('cancel stops a pending send', () => {
    const publisher = new CursorPublisher(awareness, 100, () => now);
    publisher.publish({ n: 1 });
    publisher.publish({ n: 2 });
    publisher.cancel();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([{ n: 1 }]);
  });
});

describe('caret builders', () => {
  it('writes the name as text, never as markup', () => {
    const caret = buildCaret({ ...ADA, name: '<img src=x onerror=alert(1)>' });
    expect(caret.querySelector('img')).toBeNull();
    expect(caret.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(caret.getAttribute('aria-hidden')).toBe('true');
    expect(caret.style.getPropertyValue('--conote-caret-color')).toBe('#4F46E5');
  });
  it('uses the colour at low opacity for the selection', () => {
    expect(buildSelection(ADA)).toEqual({
      class: 'conote-selection',
      style: 'background-color: #4F46E533',
    });
  });
});

describe('collaborator carets in a real editor', () => {
  const editors: Editor[] = [];
  afterEach(() => {
    while (editors.length > 0) editors.pop()?.destroy();
  });

  async function setup() {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    // Attached to the page: ProseMirror only reports focus for an element that is in it.
    const element = document.body.appendChild(document.createElement('div'));
    const editor = new Editor({
      element,
      extensions: createEditorExtensions(
        createCollaborativeRegistry(doc, { awareness, presence: { publishIntervalMs: 0 } }),
        { host: {} },
      ),
    });
    editors.push(editor);
    editor.commands.setContent('<p>Hello shared world</p>');
    await settle();
    return { doc, awareness, editor };
  }

  /** Make `awareness` believe a remote client (id 4242) published `state`. */
  function remote(awareness: Awareness, state: Record<string, unknown> | null, clock = 1) {
    const other = new Awareness(new Y.Doc());
    other.clientID = 4242;
    other.meta.set(4242, { clock, lastUpdated: Date.now() });
    if (state) other.states.set(4242, state);
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(other, [4242]), 'test');
    other.destroy();
  }

  function cursorAt(doc: Y.Doc, from: number, to: number) {
    const fragment = doc.getXmlFragment('default');
    const paragraph = fragment.get(0) as Y.XmlElement;
    const text = paragraph.get(0) as Y.XmlText;
    return {
      anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, from)),
      head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, to)),
    };
  }

  it('draws a named caret and a selection for a collaborator, as decorations only', async () => {
    const { doc, awareness, editor } = await setup();
    const before = JSON.stringify(editor.getJSON());
    remote(awareness, { user: ADA, cursor: cursorAt(doc, 6, 12) });
    await settle();

    const caret = editor.view.dom.querySelector('.conote-caret');
    expect(caret?.textContent).toBe('Ada Lovelace');
    expect(editor.view.dom.querySelector('.conote-selection')?.textContent).toBe('shared');
    // Not content: the document, its JSON and the Yjs fragment are unchanged.
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    expect(editor.getText()).toBe('Hello shared world');
    expect(JSON.stringify(ydocToContent(doc))).not.toContain('Ada');
  });

  it('follows the text when someone types before the cursor', async () => {
    const { doc, awareness, editor } = await setup();
    remote(awareness, { user: ADA, cursor: cursorAt(doc, 6, 12) });
    await settle();
    editor.chain().setTextSelection(1).insertContent('>> ').run();
    await settle();
    expect(editor.view.dom.querySelector('.conote-selection')?.textContent).toBe('shared');
  });

  it('removes the caret when the collaborator leaves', async () => {
    const { doc, awareness, editor } = await setup();
    remote(awareness, { user: ADA, cursor: cursorAt(doc, 6, 12) }, 1);
    await settle();
    expect(editor.view.dom.querySelector('.conote-caret')).not.toBeNull();
    remote(awareness, null, 2);
    await settle();
    expect(editor.view.dom.querySelector('.conote-caret')).toBeNull();
    expect(editor.view.dom.querySelector('.conote-selection')).toBeNull();
  });

  it.each([
    ['no identity', { cursor: 'x' }],
    ['a hostile colour', { user: { ...ADA, color: 'red;background:url(//evil)' }, cursor: {} }],
    ['a malformed cursor', { user: ADA, cursor: { anchor: { item: { client: -1, clock: 'x' } } } }],
  ])('ignores a state with %s without breaking the editor', async (_name, state) => {
    const { awareness, editor } = await setup();
    remote(awareness, state as Record<string, unknown>);
    await settle();
    expect(editor.view.dom.querySelector('.conote-caret')).toBeNull();
    editor.chain().focus('end').insertContent('!').run();
    expect(editor.getText()).toBe('Hello shared world!');
  });

  it('publishes its own cursor as relative positions when focused', async () => {
    const { awareness, editor } = await setup();
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 2, to: 7 });
    await settle();
    const cursor = awareness.getLocalState()?.cursor as
      { anchor: object; head: object } | undefined;
    expect(cursor?.anchor).toBeDefined();
    expect(cursor?.head).toBeDefined();
  });
});
