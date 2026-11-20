// @vitest-environment jsdom
/**
 * Presence with several "browsers" on one page (Phase 7, AC-7.1, AC-7.2, AC-7.4): each is a
 * jsdom window's worth of the real client code (CollabSession with its awareness, the
 * Hocuspocus provider over a real WebSocket, a TipTap editor with the caret extension)
 * talking to the real collaboration server, PostgreSQL and Redis. Not real browsers; see
 * docs/TESTING.md §8.0f.
 */
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorExtensions } from '@conote/editor';
import { createCollaborativeRegistry } from '@conote/editor/collaboration';
import { deriveCollaborators, documentNameForPage, type CollabTokenResponse } from '@conote/shared';
import { CollabSession } from '../src/lib/collab-session';
// A deliberate, test-only reach into the collab app's integration harness (it seeds PostgreSQL
// and starts the real server); no production code does this.
// eslint-disable-next-line no-restricted-imports
import { Harness, NodeWebSocket, until, type TestUser } from '../../collab/test/harness';

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls the selection into view.
const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
Range.prototype.getBoundingClientRect = () => ({ ...emptyRect, toJSON: () => ({}) }) as DOMRect;
Range.prototype.getClientRects = () =>
  ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
document.elementFromPoint = () => null;

interface Browser {
  session: CollabSession;
  editor: Editor;
  user: TestUser;
  focused: boolean;
}

const harnesses: Harness[] = [];
const browsers: Browser[] = [];
afterEach(async () => {
  for (const b of browsers.splice(0)) {
    b.editor.destroy();
    b.session.destroy();
  }
  const all = harnesses.splice(0);
  for (const h of all) await h.stop().catch(() => undefined);
  for (const h of all) await h.cleanup().catch(() => undefined);
  document.body.replaceChildren();
});

async function openBrowser(
  h: Harness,
  user: TestUser,
  pageId: string,
  role: CollabTokenResponse['role'] = 'EDITOR',
): Promise<Browser> {
  const readOnly = role === 'VIEWER' || role === 'COMMENTER';
  const session = new CollabSession({
    pageId,
    fetchToken: async () => ({
      token: await h.token(user, pageId),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      collabUrl: h.url,
      documentName: documentNameForPage(pageId),
      role,
      readOnly,
    }),
    WebSocketPolyfill: NodeWebSocket,
    retryDelaysMs: [50, 100],
  });
  session.start();
  await until(() => session.getState().everSynced, 'first sync', 8000);
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({
    element,
    extensions: createEditorExtensions(
      createCollaborativeRegistry(session.doc!, {
        awareness: session.awareness!,
        presence: { publishIntervalMs: 0 },
      }),
    ),
    editable: !readOnly,
  });
  // All simulated browsers live in one jsdom document, where only one element can have focus,
  // and an editor without focus stops publishing its cursor (as it should). Each browser has
  // its own focus here, which a real window has: `setFocused` stands for focus and blur.
  const browser: Browser = { session, editor, user, focused: true };
  editor.view.hasFocus = () => browser.focused;
  browsers.push(browser);
  return browser;
}

async function scene(names: string[], roles: CollabTokenResponse['role'][] = []) {
  const h = await Harness.start();
  harnesses.push(h);
  const owner = await h.user(names[0] ?? 'Ada', '#4F46E5');
  const workspaceId = await h.workspace(owner);
  const pageId = await h.page(workspaceId, owner);
  const users = [owner];
  const colors = ['#0E7490', '#B45309', '#BE123C'];
  for (const [i, name] of names.slice(1).entries()) {
    const user = await h.user(name, colors[i] ?? '#111111');
    await h.member(workspaceId, user, (roles[i + 1] ?? 'EDITOR') as 'EDITOR');
    users.push(user);
  }
  return { h, users, pageId };
}

const carets = (b: Browser) =>
  [...b.editor.view.dom.querySelectorAll('.conote-caret')].map((el) => el.textContent);
const selections = (b: Browser) =>
  [...b.editor.view.dom.querySelectorAll('.conote-selection')].map((el) => el.textContent);

/** Select `from`..`to` (document positions) in `b` and focus it, as a person would. */
function select(b: Browser, from: number, to: number): void {
  b.focused = true;
  b.editor.commands.setTextSelection({ from, to });
}

/** The editor loses focus (the person clicks elsewhere): the cursor plugin reacts to it. */
function blur(b: Browser): void {
  b.focused = false;
  b.editor.view.dispatch(b.editor.state.tr.setMeta('presence-test', 'blur'));
}

const collaboratorsSeenBy = (b: Browser) =>
  deriveCollaborators(b.session.awareness!.getStates(), b.session.awareness!.clientID, {
    id: b.user.id,
    name: b.user.name,
    color: b.user.color,
  });

describe('collaborator carets across browsers', () => {
  it("shows each person's caret, name and selection to the other (AC-7.1)", async () => {
    const { h, users, pageId } = await scene(['Ada', 'Bob']);
    const a = await openBrowser(h, users[0]!, pageId);
    const b = await openBrowser(h, users[1]!, pageId);
    a.editor.commands.setContent('<p>Hello shared world</p>');
    await until(() => b.editor.getText() === 'Hello shared world', 'b has the text');

    select(b, 7, 13); // "shared"
    await until(() => carets(a).includes('Bob'), "a sees Bob's caret");
    await until(() => selections(a).includes('shared'), "a sees Bob's selection");

    select(a, 1, 6); // "Hello"
    await until(() => carets(b).includes('Ada'), "b sees Ada's caret");
    await until(() => selections(b).includes('Hello'), "b sees Ada's selection");

    // Own caret is never drawn on one's own editor, and labels are not document content.
    expect(carets(a)).toEqual(['Bob']);
    expect(a.editor.getText()).toBe('Hello shared world');
    expect(a.editor.getHTML()).not.toContain('Bob');
  });

  it('moves the cursor in real time and clears it when the person leaves the editor', async () => {
    const { h, users, pageId } = await scene(['Ada', 'Bob']);
    const a = await openBrowser(h, users[0]!, pageId);
    const b = await openBrowser(h, users[1]!, pageId);
    a.editor.commands.setContent('<p>one two three</p>');
    await until(() => b.editor.getText() === 'one two three', 'b has the text');
    select(b, 1, 4);
    await until(() => selections(a).includes('one'), 'first selection');
    select(b, 9, 14);
    await until(() => selections(a).includes('three'), 'selection moved');
    expect(selections(a)).not.toContain('one');
    // Blur: the editor stops publishing a cursor.
    blur(b);
    await until(() => carets(a).length === 0, "Bob's caret is gone after blur", 4000);
  });

  it('keeps a collaborator selection on the same text while others edit before it', async () => {
    const { h, users, pageId } = await scene(['Ada', 'Bob']);
    const a = await openBrowser(h, users[0]!, pageId);
    const b = await openBrowser(h, users[1]!, pageId);
    a.editor.commands.setContent('<p>keep this word</p>');
    await until(() => b.editor.getText() === 'keep this word', 'b has the text');
    select(b, 6, 10); // "this"
    await until(() => selections(a).includes('this'), 'a sees the selection');
    a.editor.chain().setTextSelection(1).insertContent('>>> ').run();
    await until(() => b.editor.getText().startsWith('>>> keep'), 'b got the edit');
    await until(() => selections(a).includes('this'), 'still on "this" in a');
    expect(a.editor.getText()).toBe(b.editor.getText());
  });

  it('shows three people at once, each with their own name, while all of them edit', async () => {
    const { h, users, pageId } = await scene(['Ada', 'Bob', 'Cy']);
    const [a, b, c] = [
      await openBrowser(h, users[0]!, pageId),
      await openBrowser(h, users[1]!, pageId),
      await openBrowser(h, users[2]!, pageId),
    ];
    a.editor.commands.setContent('<p>alpha</p><p>beta</p><p>gamma</p>');
    await until(() => c.editor.getText().includes('gamma'), 'c has the text');
    select(a, 2, 4);
    select(b, 9, 11);
    select(c, 15, 17);
    await until(
      () => [a, b, c].every((x) => carets(x).length === 2),
      'everyone sees the other two',
    );
    expect(carets(a).sort()).toEqual(['Bob', 'Cy']);
    expect(carets(b).sort()).toEqual(['Ada', 'Cy']);
    expect(carets(c).sort()).toEqual(['Ada', 'Bob']);

    for (let i = 0; i < 8; i += 1) {
      a.editor.chain().focus('start').insertContent('a').run();
      b.editor.chain().focus('end').insertContent('b').run();
      c.editor.chain().focus('end').insertContent('c').run();
    }
    await until(
      () => a.editor.getText() === b.editor.getText() && b.editor.getText() === c.editor.getText(),
      'documents converge',
      10_000,
    );
    // Carets never became content.
    expect(a.editor.getText()).not.toMatch(/Ada|Bob|Cy/);
  });

  it('shows a viewer to the editors, and gives the viewer a read-only editor', async () => {
    const { h, users, pageId } = await scene(['Ada', 'Vera'], ['EDITOR', 'VIEWER']);
    const a = await openBrowser(h, users[0]!, pageId);
    const v = await openBrowser(h, users[1]!, pageId, 'VIEWER');
    a.editor.commands.setContent('<p>read me</p>');
    await until(() => v.editor.getText() === 'read me', 'viewer has the text');
    select(v, 1, 5);
    await until(() => selections(a).includes('read'), "a sees the viewer's selection");
    expect(carets(a)).toEqual(['Vera']);
    expect(v.editor.isEditable).toBe(false);
  });
});

describe('who is online (AC-7.2, AC-7.4)', () => {
  it('lists one entry per person even with two tabs, and drops them when both close', async () => {
    const { h, users, pageId } = await scene(['Ada', 'Bob']);
    const a = await openBrowser(h, users[0]!, pageId);
    const bobTab1 = await openBrowser(h, users[1]!, pageId);
    const bobTab2 = await openBrowser(h, users[1]!, pageId);
    await until(() => collaboratorsSeenBy(a).some((c) => c.connections === 2), 'two Bob tabs');
    expect(collaboratorsSeenBy(a).map((c) => [c.name, c.connections])).toEqual([
      ['Ada', 1],
      ['Bob', 2],
    ]);

    bobTab1.session.destroy();
    await until(
      () => collaboratorsSeenBy(a).some((c) => c.connections === 1 && !c.isSelf),
      'one tab',
    );
    expect(collaboratorsSeenBy(a).map((c) => c.name)).toEqual(['Ada', 'Bob']);

    bobTab2.session.destroy();
    await until(() => collaboratorsSeenBy(a).length === 1, 'Bob is gone', 4000);
    expect(collaboratorsSeenBy(a).map((c) => c.name)).toEqual(['Ada']);
  });

  it('shows a person who has not moved a cursor yet', async () => {
    const { h, users, pageId } = await scene(['Ada', 'Bob']);
    const a = await openBrowser(h, users[0]!, pageId);
    await openBrowser(h, users[1]!, pageId);
    await until(() => collaboratorsSeenBy(a).length === 2, 'Bob is listed without a cursor');
    expect(collaboratorsSeenBy(a)[1]).toMatchObject({ name: 'Bob', hasCursor: false });
  });

  it('keeps presence correct when a connection drops and comes back', async () => {
    const { h, users, pageId } = await scene(['Ada', 'Bob']);
    const a = await openBrowser(h, users[0]!, pageId);
    const b = await openBrowser(h, users[1]!, pageId);
    a.editor.commands.setContent('<p>steady text</p>');
    await until(() => b.editor.getText() === 'steady text', 'b has the text');
    select(b, 1, 7);
    await until(() => selections(a).includes('steady'), 'a sees the selection');

    // Cut Bob's network: Ada must stop seeing him. The provider then reconnects by itself.
    (
      b.session.provider!.configuration.websocketProvider.webSocket as unknown as {
        terminate(): void;
      }
    ).terminate();
    await until(() => collaboratorsSeenBy(a).length === 1, 'Bob disappears for Ada', 5000);
    await until(() => b.session.getState().phase === 'live', 'Bob is live again', 8000);
    await until(() => collaboratorsSeenBy(a).length === 2, 'Bob is back for Ada', 5000);
    select(b, 8, 12);
    await until(() => selections(a).includes('text'), 'the new selection arrives');
    expect(collaboratorsSeenBy(a).filter((c) => !c.isSelf)).toHaveLength(1);
  });

  it('keeps the same awareness and shows the person again when the provider is rebuilt (Reconnect now)', async () => {
    const { h, users, pageId } = await scene(['Ada', 'Bob']);
    const a = await openBrowser(h, users[0]!, pageId);
    const b = await openBrowser(h, users[1]!, pageId);
    a.editor.commands.setContent('<p>rebuild me</p>');
    await until(() => b.editor.getText() === 'rebuild me', 'b has the text');
    const awarenessBefore = b.session.awareness;
    const providerBefore = b.session.provider;

    (
      b.session.provider!.configuration.websocketProvider.webSocket as unknown as {
        terminate(): void;
      }
    ).terminate();
    await until(() => b.session.getState().phase === 'offline', 'Bob is offline', 5000);
    b.session.retry(); // what the "Reconnect now" button calls: a new provider, the same document
    await until(() => b.session.provider !== providerBefore, 'a new provider');
    await until(() => b.session.getState().phase === 'live', 'Bob is live again', 8000);

    expect(b.session.awareness).toBe(awarenessBefore);
    await until(() => collaboratorsSeenBy(a).length === 2, 'Ada sees Bob again', 5000);
    select(b, 1, 8);
    await until(() => selections(a).includes('rebuild'), "Bob's selection reaches Ada again");
    expect(collaboratorsSeenBy(a).filter((c) => !c.isSelf)).toHaveLength(1);
  });
});
