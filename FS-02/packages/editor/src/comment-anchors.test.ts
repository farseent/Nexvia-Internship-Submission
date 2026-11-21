// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentReplica, synchronizeReplicas } from '@conote/shared';
import {
  anchorStatusInDoc,
  createCommentAnchor,
  InvalidEditorContentError,
  planRestore,
  resolveCommentAnchor,
  setCommentThreads,
  type CommentAnchor,
  type ResolvedRanges,
} from './collaboration.js';
import { createCollaborativeRegistry, ydocToContent } from './collaboration.js';
import { createEditorExtensions } from './registry.js';

/*
 * Comment anchors on real Tiptap editors bound to their own Y.Doc (AC-8.1, AC-8.3), the
 * highlight decorations, and the restore planner (D9).
 */

interface Client {
  editor: Editor;
  replica: DocumentReplica;
  ranges: ResolvedRanges;
}
const clients: Client[] = [];
afterEach(() => {
  while (clients.length > 0) {
    const c = clients.pop();
    c?.editor.destroy();
    c?.replica.destroy();
  }
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

async function client(): Promise<Client> {
  const replica = new DocumentReplica();
  const holder: { ranges: ResolvedRanges } = { ranges: new Map() };
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(
      createCollaborativeRegistry(replica.doc, {
        comments: { onResolved: (ranges) => (holder.ranges = ranges) },
      }),
      { host: {} },
    ),
  });
  const created = {
    editor,
    replica,
    get ranges() {
      return holder.ranges;
    },
  } as Client;
  clients.push(created);
  await settle();
  return created;
}

async function pair(...paragraphs: string[]): Promise<[Client, Client]> {
  const a = await client();
  const b = await client();
  a.editor.commands.setContent(paragraphs.map((t) => `<p>${t}</p>`).join(''));
  synchronizeReplicas(a.replica, b.replica);
  await settle();
  return [a, b];
}

const sync = async (a: Client, b: Client) => {
  synchronizeReplicas(a.replica, b.replica);
  await settle();
};

/** ProseMirror range of `needle` in the editor's text. */
function find(c: Client, needle: string): { from: number; to: number } {
  let result: { from: number; to: number } | undefined;
  c.editor.state.doc.descendants((node, pos) => {
    if (node.isText && result === undefined) {
      const at = node.text?.indexOf(needle) ?? -1;
      if (at >= 0) result = { from: pos + at, to: pos + at + needle.length };
    }
  });
  if (!result) throw new Error(`"${needle}" not found`);
  return result;
}

const textOf = (c: Client, range: { from: number; to: number }) =>
  c.editor.state.doc.textBetween(range.from, range.to, ' ');

function anchorFor(c: Client, needle: string) {
  const r = find(c, needle);
  const created = createCommentAnchor(c.editor.state, r.from, r.to);
  if (!created) throw new Error('anchor not created');
  return created;
}

const insert = (c: Client, pos: number, text: string) =>
  c.editor.view.dispatch(c.editor.state.tr.insertText(text, pos));

describe('anchors follow content (AC-8.1)', () => {
  it('resolves to the same text where it was created and records the quoted text', async () => {
    const [a] = await pair('The quick brown fox jumps');
    const { anchor, quotedText } = anchorFor(a, 'brown fox');
    expect(quotedText).toBe('brown fox');
    const range = resolveCommentAnchor(a.editor.state, anchor);
    expect(range).not.toBeNull();
    expect(textOf(a, range!)).toBe('brown fox');
  });

  it('still covers the original text after another client inserts before and inside it', async () => {
    const [a, b] = await pair('The quick brown fox jumps over the dog');
    const { anchor } = anchorFor(a, 'brown fox');

    insert(b, find(b, 'quick').from, 'very, very ');
    await sync(a, b);
    insert(b, find(b, 'fox').from, 'LAZY ');
    await sync(a, b);
    insert(b, find(b, 'jumps').from, 'high ');
    await sync(a, b);

    for (const c of [a, b]) {
      const range = resolveCommentAnchor(c.editor.state, anchor);
      expect(range).not.toBeNull();
      // The inserted word inside the range is part of it; the text around it is not.
      expect(textOf(c, range!)).toBe('brown LAZY fox');
    }
  });

  it('keeps following the text through edits in other paragraphs and concurrent edits on both sides', async () => {
    const [a, b] = await pair('First paragraph', 'Second paragraph with target words', 'Third');
    const { anchor } = anchorFor(a, 'target words');
    insert(a, 1, 'Intro: ');
    insert(b, find(b, 'Third').from, 'Another ');
    insert(b, find(b, 'Second').from, 'Moved ');
    await sync(a, b);
    for (const c of [a, b]) {
      expect(textOf(c, resolveCommentAnchor(c.editor.state, anchor)!)).toBe('target words');
    }
  });

  it('does not extend over text typed right before the first or right after the last character', async () => {
    const [a] = await pair('alpha beta gamma');
    const { anchor } = anchorFor(a, 'beta'); // mid-paragraph; the very first character of a paragraph is a documented edge
    insert(a, find(a, 'beta').from, 'X');
    expect(textOf(a, resolveCommentAnchor(a.editor.state, anchor)!)).toBe('beta');
    insert(a, find(a, 'beta').to, 'Y');
    expect(textOf(a, resolveCommentAnchor(a.editor.state, anchor)!)).toBe('beta');
  });

  it('keeps an anchor that spans two paragraphs', async () => {
    const [a, b] = await pair('one two', 'three four');
    const from = find(a, 'two').from;
    const to = find(a, 'three').to;
    const created = createCommentAnchor(a.editor.state, from, to)!;
    insert(b, find(b, 'one').from, '>> ');
    await sync(a, b);
    const range = resolveCommentAnchor(b.editor.state, created.anchor);
    expect(range).not.toBeNull();
    expect(b.editor.state.doc.textBetween(range!.from, range!.to, '|')).toBe('two|three');
  });

  it('returns null for an empty range and for damaged bytes', async () => {
    const [a] = await pair('text');
    expect(createCommentAnchor(a.editor.state, 3, 3)).toBeNull();
    const bad: CommentAnchor = { start: new Uint8Array([255, 255, 255]), end: new Uint8Array([1]) };
    expect(resolveCommentAnchor(a.editor.state, bad)).toBeNull();
  });
});

describe('deleted anchored text is detached, not lost (AC-8.3)', () => {
  it('detaches when all anchored text is deleted by another client, in both editors and on the bare document', async () => {
    const [a, b] = await pair('keep this and delete that part');
    const { anchor } = anchorFor(a, 'delete that');
    const r = find(b, 'delete that');
    b.editor.view.dispatch(b.editor.state.tr.delete(r.from, r.to));
    await sync(a, b);
    for (const c of [a, b]) expect(resolveCommentAnchor(c.editor.state, anchor)).toBeNull();
    expect(anchorStatusInDoc(a.replica.doc, anchor)).toBe('DETACHED');
    expect(anchorStatusInDoc(b.replica.doc, anchor)).toBe('DETACHED');
  });

  it('stays attached while part of the anchored text remains, shrinking to it', async () => {
    const [a] = await pair('one two three');
    const { anchor } = anchorFor(a, 'two three');
    const r = find(a, 'two ');
    a.editor.view.dispatch(a.editor.state.tr.delete(r.from, r.to));
    expect(textOf(a, resolveCommentAnchor(a.editor.state, anchor)!)).toBe('three');
    expect(anchorStatusInDoc(a.replica.doc, anchor)).toBe('ACTIVE');
  });

  it('detaches when the whole paragraph is deleted', async () => {
    const [a] = await pair('stays', 'goes away');
    const { anchor } = anchorFor(a, 'goes away');
    const doc = a.editor.state.doc;
    let from = 0;
    let to = 0;
    doc.forEach((node, offset, i) => {
      if (i === 1) {
        from = offset;
        to = offset + node.nodeSize;
      }
    });
    a.editor.view.dispatch(a.editor.state.tr.delete(from, to));
    expect(resolveCommentAnchor(a.editor.state, anchor)).toBeNull();
    expect(anchorStatusInDoc(a.replica.doc, anchor)).toBe('DETACHED');
  });
});

describe('highlights are decorations only', () => {
  it('draws one highlight per open thread, none for resolved ones, and never touches the document', async () => {
    const [a] = await pair('highlight me and also me');
    const first = anchorFor(a, 'highlight me');
    const second = anchorFor(a, 'also me');
    const before = JSON.stringify(a.editor.getJSON());
    const stateBefore = Y.encodeStateAsUpdate(a.replica.doc).length;
    setCommentThreads(a.editor, [
      { id: 't1', anchor: first.anchor, resolved: false },
      { id: 't2', anchor: second.anchor, resolved: true },
    ]);
    await settle();
    const marks = a.editor.view.dom.querySelectorAll('[data-comment-thread]');
    expect([...marks].map((m) => m.getAttribute('data-comment-thread'))).toEqual(['t1']);
    expect(marks[0]?.textContent).toBe('highlight me');
    expect(JSON.stringify(a.editor.getJSON())).toBe(before);
    expect(Y.encodeStateAsUpdate(a.replica.doc).length).toBe(stateBefore);
    expect(a.editor.view.dom.innerHTML).not.toContain('conote-comment-highlight"></');
  });

  it('keeps the highlight on its text while a collaborator types before it, and reports positions', async () => {
    const [a, b] = await pair('start middle end');
    const { anchor } = anchorFor(a, 'middle');
    setCommentThreads(a.editor, [{ id: 't', anchor, resolved: false }]);
    await settle();
    insert(b, find(b, 'start').from, '12345 ');
    await sync(a, b);
    await settle();
    const mark = a.editor.view.dom.querySelector('[data-comment-thread="t"]');
    expect(mark?.textContent).toBe('middle');
    const range = a.ranges.get('t');
    expect(range && textOf(a, range)).toBe('middle');
  });

  it('removes the highlight and reports the thread as detached when its text is deleted', async () => {
    const [a, b] = await pair('before gone after');
    const { anchor } = anchorFor(a, 'gone');
    setCommentThreads(a.editor, [{ id: 't', anchor, resolved: false }]);
    await settle();
    expect(a.editor.view.dom.querySelector('[data-comment-thread="t"]')).not.toBeNull();
    const r = find(b, 'gone');
    b.editor.view.dispatch(b.editor.state.tr.delete(r.from, r.to));
    await sync(a, b);
    await settle();
    expect(a.editor.view.dom.querySelector('[data-comment-thread="t"]')).toBeNull();
    expect(a.ranges.get('t')).toBeNull();
  });

  it('judges nothing before the document is ready', async () => {
    const replica = new DocumentReplica();
    let ready = false;
    let reported: ResolvedRanges = new Map();
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions(
        createCollaborativeRegistry(replica.doc, {
          comments: { isReady: () => ready, onResolved: (r) => (reported = r) },
        }),
        { host: {} },
      ),
    });
    clients.push({ editor, replica, ranges: new Map() });
    await settle();
    const stray: CommentAnchor = { start: new Uint8Array([1, 2]), end: new Uint8Array([3, 4]) };
    setCommentThreads(editor, [{ id: 'x', anchor: stray, resolved: false }]);
    await settle();
    expect(reported.size).toBe(0);
    ready = true;
    setCommentThreads(editor, [{ id: 'x', anchor: stray, resolved: false }]);
    await settle();
    expect(reported.get('x')).toBeNull();
  });
});

describe('restore planning (D9)', () => {
  const stateOf = (c: Client) => Y.encodeStateAsUpdate(c.replica.doc);

  it('turns the live document into the snapshot content, keeping history (a new transaction)', async () => {
    const [a] = await pair('Original first', 'Original second');
    const snapshot = stateOf(a);
    a.editor.commands.setContent('<p>Changed first</p><p>Brand new</p><p>Another</p>');
    await settle();
    const live = stateOf(a);
    const delta = planRestore(live, snapshot);
    expect(delta).not.toBeNull();

    const target = new Y.Doc();
    Y.applyUpdate(target, live);
    Y.applyUpdate(target, delta!);
    expect(ydocToContent(target)).toEqual(ydocFromState(snapshot));
    // History is kept: the live operations are all still there, the delta only adds to them.
    expect(Y.encodeStateVector(target).length).toBeGreaterThanOrEqual(
      Y.encodeStateVectorFromUpdate(live).length,
    );
    const plain = new Y.Doc();
    Y.applyUpdate(plain, snapshot);
    expect(ydocToContent(target)).toEqual(ydocToContent(plain));
  });

  it('returns null when the content is already the same', async () => {
    const [a] = await pair('same', 'text');
    expect(planRestore(stateOf(a), stateOf(a))).toBeNull();
  });

  it('is idempotent: applying the same delta twice, or restoring again, changes nothing', async () => {
    const [a] = await pair('one', 'two');
    const snapshot = stateOf(a);
    a.editor.commands.setContent('<p>zzz</p>');
    await settle();
    const delta = planRestore(stateOf(a), snapshot)!;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, stateOf(a));
    Y.applyUpdate(doc, delta);
    const once = ydocToContent(doc);
    Y.applyUpdate(doc, delta);
    expect(ydocToContent(doc)).toEqual(once);
    expect(planRestore(Y.encodeStateAsUpdate(doc), snapshot)).toBeNull();
  });

  it('keeps comment anchors on text that is unchanged and detaches the rest', async () => {
    const [a] = await pair('Stable paragraph here', 'Will be rewritten');
    const kept = anchorFor(a, 'Stable paragraph');
    const lost = anchorFor(a, 'Will be rewritten');
    const snapshot = stateOf(a);
    // Edit the second paragraph heavily, then restore the snapshot: the first paragraph never changed.
    const r = find(a, 'Will be rewritten');
    a.editor.view.dispatch(a.editor.state.tr.delete(r.from, r.to));
    insert(a, find(a, 'Stable').from, '');
    await settle();
    // A snapshot older than the deletion: restoring brings the second paragraph back as new content.
    const delta = planRestore(stateOf(a), snapshot)!;
    Y.applyUpdate(a.replica.doc, delta, 'conote:remote');
    await settle();
    expect(textOf(a, resolveCommentAnchor(a.editor.state, kept.anchor)!)).toBe('Stable paragraph');
    expect(resolveCommentAnchor(a.editor.state, lost.anchor)).toBeNull();
    expect(anchorStatusInDoc(a.replica.doc, kept.anchor)).toBe('ACTIVE');
    expect(anchorStatusInDoc(a.replica.doc, lost.anchor)).toBe('DETACHED');
  });

  it('converges with a concurrent client that never saw the restore', async () => {
    const [a, b] = await pair('base one', 'base two');
    const snapshot = stateOf(a);
    a.editor.commands.setContent('<p>edited</p>');
    await sync(a, b);
    const delta = planRestore(stateOf(a), snapshot)!;
    Y.applyUpdate(a.replica.doc, delta);
    insert(b, find(b, 'edited').to, ' by B');
    await sync(a, b);
    await settle();
    expect(JSON.stringify(a.editor.getJSON())).toBe(JSON.stringify(b.editor.getJSON()));
  });

  it('refuses a snapshot whose content is not a valid page, leaving nothing applied', () => {
    const bogus = new Y.Doc();
    const fragment = bogus.getXmlFragment('default');
    fragment.insert(0, [new Y.XmlElement('notARealNode')]);
    expect(() =>
      planRestore(Y.encodeStateAsUpdate(new Y.Doc()), Y.encodeStateAsUpdate(bogus)),
    ).toThrow();
    expect(InvalidEditorContentError).toBeDefined();
  });

  it('restores an empty snapshot to one empty paragraph', async () => {
    const empty = Y.encodeStateAsUpdate(new Y.Doc());
    const [a] = await pair('has content');
    const delta = planRestore(stateOf(a), empty)!;
    Y.applyUpdate(a.replica.doc, delta);
    await settle();
    expect(a.editor.state.doc.textContent).toBe('');
  });
});

function ydocFromState(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return ydocToContent(doc);
}
