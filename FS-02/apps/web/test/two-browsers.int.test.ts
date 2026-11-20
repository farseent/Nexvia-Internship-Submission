// @vitest-environment jsdom
/**
 * Several "browsers" editing one page: each is a jsdom window's worth of the real client code
 * (CollabSession + the Hocuspocus provider over a real WebSocket + a TipTap editor bound to the
 * collaborative document) talking to the real collaboration server, PostgreSQL and Redis.
 * It is as close to two browsers as a test can get without a browser; see docs/TESTING.md.
 */
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorExtensions } from '@conote/editor';
import { createCollaborativeRegistry } from '@conote/editor/collaboration';
import { documentNameForPage, type CollabTokenResponse } from '@conote/shared';
import { CollabSession } from '../src/lib/collab-session';
// A deliberate, test-only reach into the collab app's integration harness (it seeds PostgreSQL
// and starts the real server); no production code does this.
// eslint-disable-next-line no-restricted-imports
import { Harness, NodeWebSocket, until, type TestUser } from '../../collab/test/harness';

// jsdom has no layout; ProseMirror asks for rectangles when it scrolls the selection into view.
const emptyRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
};
Range.prototype.getBoundingClientRect = () => emptyRect as DOMRect;
Range.prototype.getClientRects = () =>
  ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
document.elementFromPoint = () => null;

interface Browser {
  session: CollabSession;
  editor: Editor;
  user: TestUser;
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
});

async function start(options: Parameters<typeof Harness.start>[0] = {}) {
  const h = await Harness.start(options);
  harnesses.push(h);
  return h;
}

/** Open the page the way the page view does: a session, then an editor on its document. */
async function openBrowser(
  h: Harness,
  user: TestUser,
  pageId: string,
  role: CollabTokenResponse['role'] = 'EDITOR',
): Promise<Browser> {
  const readOnly = role === 'VIEWER' || role === 'COMMENTER';
  const session = new CollabSession({
    pageId,
    // Stands in for PAGE-10: a fresh token for every connection.
    fetchToken: async () => ({
      token: await h.token(user, pageId),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      collabUrl: h.url,
      documentName: documentNameForPage(pageId),
      role,
      readOnly,
    }),
    // jsdom's Event class does not mix with Node's own WebSocket; the `ws` package does.
    WebSocketPolyfill: NodeWebSocket,
    retryDelaysMs: [50, 100],
  });
  session.start();
  await until(() => session.getState().everSynced, 'first sync', 8000);
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(createCollaborativeRegistry(session.doc!)),
    editable: !readOnly,
  });
  const browser = { session, editor, user };
  browsers.push(browser);
  return browser;
}

const texts = (...bs: Browser[]) => bs.map((b) => b.editor.getText());
const jsons = (...bs: Browser[]) => bs.map((b) => JSON.stringify(b.editor.getJSON()));
const allEqual = (values: string[]) => values.every((v) => v === values[0]);

async function scene(members: number) {
  const h = await start();
  const { owner, workspaceId, pageId } = await h.scene();
  const users = [owner];
  for (let i = 1; i < members; i += 1) {
    const u = await h.user(`m${i}`);
    await h.member(workspaceId, u, 'EDITOR');
    users.push(u);
  }
  return { h, users, owner, workspaceId, pageId };
}

describe('two browsers on one page', () => {
  it("shows each other's edits live, in rich text", async () => {
    const { h, users, pageId } = await scene(2);
    const [a, b] = [
      await openBrowser(h, users[0]!, pageId),
      await openBrowser(h, users[1]!, pageId),
    ];

    a.editor.commands.setContent('<h2>Plan</h2><p>First point</p>', { emitUpdate: true });
    await until(() => b.editor.getText().includes('First point'), 'b sees a');
    expect(b.editor.getHTML()).toContain('<h2>Plan</h2>');

    b.editor.chain().focus('end').insertContent('<p>Second point by B</p>').run();
    await until(() => a.editor.getText().includes('Second point by B'), 'a sees b');
    await until(() => allEqual(jsons(a, b)), 'identical documents');
  });

  it('converges when both type at the same time in the same place', async () => {
    const { h, users, pageId } = await scene(2);
    const [a, b] = [
      await openBrowser(h, users[0]!, pageId),
      await openBrowser(h, users[1]!, pageId),
    ];
    a.editor.commands.setContent('<p>shared start</p>');
    await until(() => b.editor.getText() === 'shared start', 'both have the start');
    for (let i = 0; i < 10; i += 1) {
      a.editor.chain().focus('end').insertContent(` A${i}`).run();
      b.editor.chain().focus('end').insertContent(` B${i}`).run();
    }
    await until(
      () =>
        allEqual(jsons(a, b)) &&
        a.editor.getText().includes('B9') &&
        a.editor.getText().includes('A9'),
      'converged',
      8000,
    );
    for (let i = 0; i < 10; i += 1) {
      expect(a.editor.getText().split(` A${i}`).length - 1).toBe(1);
      expect(a.editor.getText().split(` B${i}`).length - 1).toBe(1);
    }
  });

  it('keeps three or more browsers consistent, including formatting', async () => {
    const { h, users, pageId } = await scene(4);
    const bs = await Promise.all(users.map((u) => openBrowser(h, u, pageId)));
    bs[0]!.editor.commands.setContent('<p>base</p>');
    await until(() => bs.every((b) => b.editor.getText() === 'base'), 'everyone has the base');
    bs[1]!.editor.chain().focus('end').insertContent('<p><strong>bold from 1</strong></p>').run();
    bs[2]!.editor.chain().focus('end').insertContent('<ul><li><p>item from 2</p></li></ul>').run();
    bs[3]!.editor.chain().focus('end').insertContent('<p><em>italic from 3</em></p>').run();
    await until(
      () =>
        allEqual(jsons(...bs)) &&
        ['bold from 1', 'item from 2', 'italic from 3'].every((t) =>
          bs[0]!.editor.getText().includes(t),
        ),
      'four editors converge',
      8000,
    );
    expect(bs[0]!.editor.getHTML()).toMatch(/<strong>bold from 1<\/strong>/);
    expect(bs[0]!.editor.getHTML()).toMatch(/<li>/);
  });

  it('a viewer sees edits live but nothing the viewer does reaches anyone', async () => {
    const { h, users, workspaceId, pageId } = await scene(2);
    const viewerUser = await h.user('viewer');
    await h.member(workspaceId, viewerUser, 'VIEWER');
    const editorBrowser = await openBrowser(h, users[0]!, pageId);
    const viewer = await openBrowser(h, viewerUser, pageId, 'VIEWER');
    expect(viewer.editor.isEditable).toBe(false);

    editorBrowser.editor.commands.setContent('<p>visible to the viewer</p>');
    await until(() => viewer.editor.getText() === 'visible to the viewer', 'viewer sees it');

    // Even a forced programmatic change (as a tampered client would make) is refused by the server.
    viewer.editor.setEditable(true);
    viewer.editor.chain().focus('end').insertContent('<p>TAMPERED</p>').run();
    await new Promise((r) => setTimeout(r, 500));
    const late = await openBrowser(h, users[1]!, pageId);
    expect(editorBrowser.editor.getText()).toBe('visible to the viewer');
    expect(late.editor.getText()).toBe('visible to the viewer');
  });

  it("keeps one browser's edits made offline and merges them after reconnecting", async () => {
    const { h, users, pageId } = await scene(2);
    const [a, b] = [
      await openBrowser(h, users[0]!, pageId),
      await openBrowser(h, users[1]!, pageId),
    ];
    a.editor.commands.setContent('<p>before</p>');
    await until(() => b.editor.getText() === 'before', 'synced');

    // The network drops for a.
    const socket = a.session.provider!.configuration.websocketProvider.webSocket as unknown as {
      close(): void;
    };
    socket.close();
    await until(() => a.session.getState().phase === 'offline', 'a notices it is offline');
    a.editor.chain().focus('end').insertContent('<p>typed offline</p>').run();
    b.editor.chain().focus('end').insertContent('<p>typed meanwhile</p>').run();

    await until(() => a.session.getState().phase === 'live', 'a reconnected', 8000);
    await until(
      () =>
        allEqual(jsons(a, b)) &&
        a.editor.getText().includes('typed offline') &&
        a.editor.getText().includes('typed meanwhile'),
      'both edits on both sides',
      8000,
    );
    expect(a.editor.getText().split('typed offline').length - 1).toBe(1);
  });

  it('survives a server restart: the document is recovered and editing continues', async () => {
    const first = await start();
    const { owner, workspaceId, pageId } = await first.scene();
    const other = await first.user('other');
    await first.member(workspaceId, other, 'EDITOR');
    const a = await openBrowser(first, owner, pageId);
    const b = await openBrowser(first, other, pageId);
    a.editor.commands.setContent('<p>written before the restart</p>');
    await until(() => b.editor.getText() === 'written before the restart', 'synced');

    const port = first.collab.port;
    await first.collab.stop();
    a.editor.chain().focus('end').insertContent('<p>typed while the server was down</p>').run();

    const second = await start({ keys: first.keys, config: { port } });
    await until(
      () => a.session.getState().phase === 'live' && b.session.getState().phase === 'live',
      'both reconnected',
      10_000,
    );
    await until(
      () => allEqual(jsons(a, b)) && b.editor.getText().includes('typed while the server was down'),
      'converged',
      10_000,
    );
    // And the restarted server really has it: a new browser sees everything.
    const c = await openBrowser(second, owner, pageId);
    expect(c.editor.getText()).toContain('written before the restart');
    expect(c.editor.getText()).toContain('typed while the server was down');
  });

  it('removing a member ends their live session at once and leaves the others working', async () => {
    const { h, users, workspaceId, pageId } = await scene(3);
    const [a, b, c] = await Promise.all(users.map((u) => openBrowser(h, u, pageId)));
    a!.editor.commands.setContent('<p>hello</p>');
    await until(() => c!.editor.getText() === 'hello', 'synced');

    await h.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: users[2]!.id } },
    });
    await h.publish({ type: 'member.removed', userId: users[2]!.id, workspaceId });
    await until(() => c!.session.getState().phase === 'revoked', 'member sees the revocation');
    expect(c!.session.doc).toBeNull();

    a!.editor.chain().focus('end').insertContent('<p>after removal</p>').run();
    await until(() => b!.editor.getText().includes('after removal'), 'others continue');
    expect(c!.editor.getText()).not.toContain('after removal');
  });

  it('opens a page that only has Phase 4 content once, for everyone who opens it at the same time', async () => {
    const { h, users, pageId } = await scene(3);
    await h.prisma.pageContent.create({
      data: {
        pageId,
        schemaVersion: 1,
        revision: 1,
        updatedById: users[0]!.id,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Written in Phase 4' }] }],
        },
      },
    });
    const bs = await Promise.all(users.map((u) => openBrowser(h, u, pageId)));
    await until(
      () => bs.every((b) => b.editor.getText() === 'Written in Phase 4'),
      'everyone shows the content exactly once',
    );
    expect(allEqual(jsons(...bs))).toBe(true);
    expect(texts(...bs)).toEqual([
      'Written in Phase 4',
      'Written in Phase 4',
      'Written in Phase 4',
    ]);
  });
});
