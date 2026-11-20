// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DocumentReplica,
  REMOTE_ORIGIN,
  assetUrl,
  emptyEditorDocument,
  stateVectorsEqual,
  synchronizeReplicas,
  validateEditorDocument,
} from '@conote/shared';
import {
  contentToYDoc,
  createCollaborativeRegistry,
  InvalidEditorContentError,
  ydocToContent,
  YJS_FRAGMENT_NAME,
} from './collaboration.js';
import { createDefaultRegistry, createEditorExtensions } from './registry.js';

/*
 * Real Tiptap editors, each bound to its own Y.Doc, exchanging Yjs updates the way a provider
 * would (AC-5.1, AC-5.2). The same scenarios on bare Yjs structures are in
 * packages/shared/src/yjs.test.ts.
 */

const ASSET_ID = '0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

interface Client {
  name: string;
  editor: Editor;
  replica: DocumentReplica;
  log: Uint8Array[];
}

const clients: Client[] = [];
const standalone: Editor[] = [];

afterEach(() => {
  while (clients.length > 0) {
    const client = clients.pop();
    client?.editor.destroy();
    client?.replica.destroy();
  }
  while (standalone.length > 0) standalone.pop()?.destroy();
});

/** The binding renders the Y document into the editor in a macrotask; edit only after that. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

async function client(name: string): Promise<Client> {
  const doc = new Y.Doc();
  const log: Uint8Array[] = [];
  const replica = new DocumentReplica({ doc, onLocalUpdate: (update) => log.push(update) });
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(createCollaborativeRegistry(doc), { host: {} }),
  });
  const created = { name, editor, replica, log };
  clients.push(created);
  await settle();
  return created;
}

async function clientsWithText(...paragraphs: string[]): Promise<[Client, Client]> {
  const a = await client('A');
  const b = await client('B');
  a.editor.commands.setContent(paragraphs.map((text) => `<p>${text}</p>`).join(''));
  synchronizeReplicas(a.replica, b.replica);
  await settle();
  expectConverged(a, b);
  return [a, b];
}

/** Start and end of the text of top-level paragraph `index` (ProseMirror positions). */
function paragraph(c: Client, index: number): { from: number; to: number; text: string } {
  let found: { from: number; to: number; text: string } | undefined;
  c.editor.state.doc.forEach((node, offset, i) => {
    if (i === index)
      found = { from: offset + 1, to: offset + 1 + node.content.size, text: node.textContent };
  });
  if (!found) throw new Error(`${c.name} has no paragraph ${index}`);
  return found;
}

function insertAt(c: Client, pos: number, text: string): void {
  c.editor.view.dispatch(c.editor.state.tr.insertText(text, pos));
}

function deleteRange(c: Client, from: number, to: number): void {
  c.editor.view.dispatch(c.editor.state.tr.delete(from, to));
}

function toggleMark(c: Client, mark: 'bold' | 'italic', from: number, to: number): void {
  const type = c.editor.schema.marks[mark];
  if (!type) throw new Error(`no ${mark} mark`);
  const { tr, doc } = c.editor.state;
  c.editor.view.dispatch(
    doc.rangeHasMark(from, to, type)
      ? tr.removeMark(from, to, type)
      : tr.addMark(from, to, type.create()),
  );
}

function json(c: Client) {
  const value = c.editor.getJSON();
  const validation = validateEditorDocument(value);
  expect(validation.ok, JSON.stringify(validation.ok ? [] : validation.issues)).toBe(true);
  return value;
}

/**
 * What the editor shows for a stored document: Tiptap's TrailingNode keeps an empty paragraph
 * after a final non-paragraph block (a table, an image). It exists only in the view; opening a
 * document does not write it into the Y.Doc (verified: no update on open, no duplicate when two
 * clients open the same document), so stored content and editor JSON differ by exactly this node.
 */
function asShown<T extends { content?: { type?: string }[] }>(content: T): T {
  const last = content.content?.at(-1);
  if (!last || last.type === 'paragraph') return content;
  return {
    ...content,
    content: [...(content.content ?? []), { type: 'paragraph', attrs: { textAlign: null } }],
  };
}

/** The editors, the Y documents and the JSON stored in them all agree. */
function expectConverged(...all: Client[]): void {
  const [first, ...rest] = all;
  if (!first) throw new Error('no clients');
  for (const other of rest) {
    expect(json(other), `${other.name} vs ${first.name}`).toEqual(json(first));
    expect(
      stateVectorsEqual(other.replica.stateVector(), first.replica.stateVector()),
      `state vectors of ${other.name} and ${first.name}`,
    ).toBe(true);
    expect(other.replica.hasPendingUpdates()).toBe(false);
  }
  for (const c of all) expect(asShown(ydocToContent(c.replica.doc))).toEqual(json(c));
}

const texts = (c: Client) =>
  (json(c) as { content: { content?: { text?: string }[] }[] }).content.map((block) =>
    (block.content ?? []).map((node) => node.text ?? '').join(''),
  );

// ───────────── the binding ─────────────

describe('the Yjs binding', () => {
  it('registers the Collaboration extension and removes the built-in undo/redo', async () => {
    const c = await client('A');
    const names = c.editor.extensionManager.extensions.map((extension) => extension.name);
    expect(names).toContain('collaboration');
    expect(names).not.toContain('undoRedo');
  });

  it('keeps all Phase 4 features and leaves the default registry untouched', () => {
    const doc = new Y.Doc();
    const collaborative = createCollaborativeRegistry(doc);
    const plain = createDefaultRegistry();
    expect(collaborative.ids()).toEqual([...plain.ids(), 'collaboration']);
    expect(plain.has('collaboration')).toBe(false);
  });

  it('writes edits into the Y.XmlFragment, not into a replacement of the whole document', async () => {
    const c = await client('A');
    c.editor.commands.setContent('<p>hello</p>');
    expect(c.replica.doc.getXmlFragment(YJS_FRAGMENT_NAME).length).toBeGreaterThan(0);
    c.log.length = 0;

    insertAt(c, paragraph(c, 0).to, '!');
    expect(c.log).toHaveLength(1);
    const full = c.replica.diffSince().length;
    expect((c.log[0] as Uint8Array).length).toBeLessThan(full);
    expect(texts(c)).toEqual(['hello!']);
  });

  it('reports each local edit once and never reports a remote update again', async () => {
    const [a, b] = await clientsWithText('start');
    a.log.length = 0;
    b.log.length = 0;

    insertAt(a, paragraph(a, 0).to, ' A');
    expect(a.log).toHaveLength(1);
    b.replica.applyRemoteUpdate(a.log[0] as Uint8Array);
    await settle();
    expect(b.log).toHaveLength(0); // applying it did not echo it
    expectConverged(a, b);
  });

  it('tags remote transactions so a provider can tell them from local ones', async () => {
    const [a, b] = await clientsWithText('x');
    const origins: unknown[] = [];
    b.replica.doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    insertAt(a, paragraph(a, 0).to, 'y');
    b.replica.applyRemoteUpdate(a.log[a.log.length - 1] as Uint8Array);
    expect(origins).toEqual([REMOTE_ORIGIN]);
  });
});

// ───────────── concurrent editing through the editors (AC-5.1) ─────────────

describe('two editors editing concurrently converge', () => {
  it('different sections', async () => {
    const [a, b] = await clientsWithText('one', 'two', 'three');
    insertAt(a, paragraph(a, 0).to, ' (A)');
    insertAt(b, paragraph(b, 2).to, ' (B)');
    synchronizeReplicas(a.replica, b.replica);
    await settle();

    expectConverged(a, b);
    expect(texts(a)).toEqual(['one (A)', 'two', 'three (B)']);
  });

  it('the same section', async () => {
    const [a, b] = await clientsWithText('The quick fox');
    insertAt(a, paragraph(a, 0).from + 4, 'brown ');
    insertAt(b, paragraph(b, 0).to, ' jumps');
    synchronizeReplicas(a.replica, b.replica);
    await settle();

    expectConverged(a, b);
    expect(texts(a)).toEqual(['The brown quick fox jumps']);
  });

  it('simultaneous insertions at the same position keep both', async () => {
    const [a, b] = await clientsWithText('ab');
    insertAt(a, paragraph(a, 0).from + 1, 'AAA');
    insertAt(b, paragraph(b, 0).from + 1, 'BBB');
    synchronizeReplicas(a.replica, b.replica);
    await settle();

    expectConverged(a, b);
    const [text] = texts(a);
    expect(text).toContain('AAA');
    expect(text).toContain('BBB');
    expect(text?.startsWith('a')).toBe(true);
    expect(text?.endsWith('b')).toBe(true);
  });

  it('simultaneous deletions', async () => {
    const [a, b] = await clientsWithText('The quick brown fox');
    const start = paragraph(a, 0).from;
    deleteRange(a, start + 4, start + 10); // "quick "
    deleteRange(b, start + 10, start + 16); // "brown "
    synchronizeReplicas(a.replica, b.replica);
    await settle();

    expectConverged(a, b);
    expect(texts(a)).toEqual(['The fox']);
  });

  it('simultaneous deletions of overlapping text delete it once', async () => {
    const [a, b] = await clientsWithText('abcdefg');
    const start = paragraph(a, 0).from;
    deleteRange(a, start + 2, start + 4); // "cd"
    deleteRange(b, start + 3, start + 5); // "de"
    synchronizeReplicas(a.replica, b.replica);
    await settle();

    expectConverged(a, b);
    expect(texts(a)).toEqual(['abfg']);
  });

  it('concurrent formatting changes keep both marks', async () => {
    const [a, b] = await clientsWithText('The quick brown fox');
    const start = paragraph(a, 0).from;
    toggleMark(a, 'bold', start + 4, start + 9); // "quick"
    toggleMark(b, 'italic', start + 4, start + 15); // "quick brown"
    synchronizeReplicas(a.replica, b.replica);
    await settle();

    expectConverged(a, b);
    const parts = (
      json(a) as { content: { content: { text: string; marks?: { type: string }[] }[] }[] }
    ).content[0]?.content;
    const quick = parts?.find((part) => part.text === 'quick');
    expect(quick?.marks?.map((m) => m.type).sort()).toEqual(['bold', 'italic']);
    const brown = parts?.find((part) => part.text.includes('brown'));
    expect(brown?.marks?.map((m) => m.type)).toEqual(['italic']);
  });

  it('an edit and a deletion of the paragraph around it converge', async () => {
    const [a, b] = await clientsWithText('keep', 'remove me');
    insertAt(b, paragraph(b, 1).to, ' now');
    a.editor.view.dispatch(
      a.editor.state.tr.delete(paragraph(a, 1).from - 1, paragraph(a, 1).to + 1),
    );
    synchronizeReplicas(a.replica, b.replica);
    await settle();
    expectConverged(a, b);
    expect(texts(a)[0]).toBe('keep');
  });

  it('a joining editor gets the whole document through the sync handshake', async () => {
    const [a] = await clientsWithText('one', 'two');
    const late = await client('late');
    expect(texts(late).join('')).toBe('');
    late.replica.applyRemoteUpdate(a.replica.diffSince(late.replica.stateVector()));
    await settle();
    expectConverged(a, late);
    expect(texts(late)).toEqual(['one', 'two']);
  });
});

// ───────────── repeated and out-of-order delivery ─────────────

describe('repeated and out-of-order updates reach the editor safely', () => {
  it('applying the same updates again changes nothing', async () => {
    const [a, b] = await clientsWithText('base');
    insertAt(a, paragraph(a, 0).to, '1');
    insertAt(a, paragraph(a, 0).to, '2');
    for (const update of a.log) b.replica.applyRemoteUpdate(update);
    await settle();
    const once = json(b);
    for (const update of [...a.log, ...a.log]) b.replica.applyRemoteUpdate(update);
    await settle();
    expect(json(b)).toEqual(once);
    expectConverged(a, b);
  });

  it('updates delivered in reverse order are held back and then integrated', async () => {
    const a = await client('A');
    const b = await client('B');
    a.editor.commands.setContent('<p>first</p>');
    insertAt(a, paragraph(a, 0).to, ' second');
    insertAt(a, paragraph(a, 0).to, ' third');
    expect(a.log.length).toBeGreaterThanOrEqual(3);

    for (const update of [...a.log].reverse()) b.replica.applyRemoteUpdate(update);
    await settle();
    expectConverged(a, b);
    expect(texts(b)).toEqual(['first second third']);
  });
});

// ───────────── randomized convergence (AC-5.2) ─────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('randomized convergence of real editors', () => {
  it.each([1, 2, 3, 4, 5])(
    'seed %i: three editors, random edits, random delivery order, duplicates',
    { timeout: 60_000 },
    async (seed) => {
      const random = mulberry32(seed);
      const a = await client('A');
      const b = await client('B');
      const c = await client('C');
      const all = [a, b, c];
      a.editor.commands.setContent(
        '<p>alpha beta gamma</p><p>delta epsilon</p><p>zeta eta theta</p>',
      );
      for (const other of [b, c]) synchronizeReplicas(a.replica, other.replica);
      await settle();

      const inbox = new Map<Client, Uint8Array[]>(all.map((x) => [x, []]));
      const sent = new Map<Client, number>(all.map((x) => [x, x.log.length]));
      const publish = (from: Client) => {
        for (const update of from.log.slice(sent.get(from) ?? 0)) {
          for (const to of all) if (to !== from) inbox.get(to)?.push(update);
        }
        sent.set(from, from.log.length);
      };

      for (let step = 0; step < 30; step += 1) {
        const actor = all[Math.floor(random() * all.length)] as Client;
        if (random() < 0.65) {
          const index = Math.floor(random() * actor.editor.state.doc.childCount);
          const { from, to } = paragraph(actor, index);
          const length = to - from;
          const roll = random();
          if (roll < 0.5 || length < 4) {
            insertAt(
              actor,
              from + Math.floor(random() * (length + 1)),
              String.fromCharCode(97 + Math.floor(random() * 26)),
            );
          } else if (roll < 0.75) {
            const start = from + Math.floor(random() * (length - 2));
            deleteRange(actor, start, start + 1 + Math.floor(random() * 2));
          } else {
            const start = from + Math.floor(random() * (length - 2));
            toggleMark(actor, random() < 0.5 ? 'bold' : 'italic', start, start + 2);
          }
          publish(actor);
        } else {
          const queue = inbox.get(actor) ?? [];
          if (queue.length > 0) {
            const at = Math.floor(random() * queue.length);
            actor.replica.applyRemoteUpdate(queue[at] as Uint8Array);
            if (random() < 0.7) queue.splice(at, 1); // otherwise it is delivered again later
            // Yjs may clean up redundant formatting while applying a remote update; that is a
            // local update a provider would broadcast, so it must be published here too.
            publish(actor);
          }
        }
      }

      // Deliver the rest (some of it twice) until the network is quiet: delivering can itself
      // produce updates (formatting cleanup).
      for (let round = 0; round < 20; round += 1) {
        for (const from of all) publish(from);
        let delivered = false;
        for (const to of all) {
          const queue = inbox.get(to) ?? [];
          inbox.set(to, []);
          for (const update of queue) {
            to.replica.applyRemoteUpdate(update);
            delivered = true;
          }
        }
        if (!delivered) break;
      }
      await settle();
      expectConverged(a, b, c);
    },
  );
});

// ───────────── compatibility with the Phase 4 document format ─────────────

describe('document compatibility with Tiptap and the Phase 4 schema', () => {
  const RICH_HTML =
    '<h2>Title</h2>' +
    '<p style="text-align: center">Centered <strong>bold</strong> <em>italic</em> <u>under</u> <a href="https://example.com">link</a></p>' +
    '<ul><li><p>bullet</p></li></ul>' +
    '<ol><li><p>number</p></li></ol>' +
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>' +
    '<table><tbody><tr><th><p>head</p></th><td><p>cell</p></td></tr></tbody></table>' +
    `<img src="${assetUrl(ASSET_ID)}">`;

  /** The canonical JSON of the single-user editor for `html`: what Phase 4 stores in `page_contents`. */
  function phase4Json(html: string) {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions(createDefaultRegistry(), { host: {} }),
      content: html,
    });
    standalone.push(editor);
    const value = editor.getJSON();
    expect(validateEditorDocument(value).ok).toBe(true);
    return value;
  }

  it('Phase 4 content survives seeding a Y.Doc and reading it back unchanged', () => {
    const content = phase4Json(RICH_HTML);
    const doc = contentToYDoc(content);
    expect(ydocToContent(doc)).toEqual(content);
  });

  it('an editor bound to a seeded Y.Doc shows exactly the Phase 4 content', async () => {
    const content = phase4Json(RICH_HTML);
    const doc = contentToYDoc(content);
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions(createCollaborativeRegistry(doc), { host: {} }),
    });
    standalone.push(editor);
    await settle();
    expect(editor.getJSON()).toEqual(asShown(content));
    expect(ydocToContent(doc)).toEqual(content);
  });

  it('a second editor that receives the seeded state shows it too, and edits stay valid', async () => {
    const content = phase4Json(RICH_HTML);
    const server = contentToYDoc(content);
    const a = await client('A');
    const b = await client('B');
    Y.applyUpdate(a.replica.doc, Y.encodeStateAsUpdate(server), REMOTE_ORIGIN);
    synchronizeReplicas(a.replica, b.replica);
    await settle();
    expectConverged(a, b);
    expect(json(a)).toEqual(asShown(content));
    expect(ydocToContent(a.replica.doc)).toEqual(content);

    insertAt(a, paragraph(a, 1).to, '!');
    synchronizeReplicas(a.replica, b.replica);
    await settle();
    expectConverged(a, b);
  });

  it('an empty fragment reads back as the empty document, and invalid content is refused', () => {
    expect(ydocToContent(new Y.Doc())).toEqual(emptyEditorDocument());
    expect(() => contentToYDoc({ type: 'doc', content: [{ type: 'script' }] })).toThrow(
      InvalidEditorContentError,
    );
    expect(() => contentToYDoc('not a document')).toThrow(InvalidEditorContentError);
  });
});
