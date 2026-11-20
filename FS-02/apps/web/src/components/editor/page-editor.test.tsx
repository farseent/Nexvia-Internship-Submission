// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentToYDoc } from '@conote/editor/collaboration';
import type { EditorDocument, UserDto } from '@conote/shared';
import { AuthProvider } from '@/lib/auth-context';
import type { CollabSession, CollabState } from '@/lib/collab-session';
import { PageEditor } from './page-editor';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));

// The live connection is tested on its own (collab-session.test.ts and the collab server's
// integration tests). Here the editor gets a session whose state the test controls.
const live = vi.hoisted(() => ({
  current: { session: null, state: null } as {
    session: unknown;
    state: unknown;
  },
}));
vi.mock('@/lib/use-collab-session', () => ({ useCollabSession: () => live.current }));

const PAGE_ID = '0b1b6a8e-3a52-4c1d-8a49-2b8a4f3d1e01';
const ASSET_ID = '9d0c3a2f-4e1b-4c11-8f5b-6f1f0a2e8a39';
const NOW = '2026-11-15T09:00:00.000Z';
const USER: UserDto = {
  id: 'u1',
  email: 'me@example.com',
  displayName: 'Me',
  presenceColor: '#0284C7',
  avatarUrl: null,
  createdAt: NOW,
};

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as EditorDocument;

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

interface Call {
  method: string;
  url: string;
  body: unknown;
}
type Reply = { status: number; body: unknown } | 'network-error';
interface ServerState {
  imageReply?: { authorize?: Reply; bytes?: Reply; complete?: Reply };
}

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });
const fail = (status: number, code: string): Reply => ({
  status,
  body: { success: false, error: { code, message: 'server message', requestId: 'r1' } },
});

/** Only the image endpoints exist: there is no page-content endpoint any more. */
function installServer(initial: Partial<ServerState> = {}) {
  const state: ServerState = { ...initial };
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      const isBytes = typeof init.body !== 'string' && init.body !== undefined;
      const call: Call = {
        method,
        url,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : isBytes ? 'bytes' : undefined,
      };
      calls.push(call);
      let reply: Reply;
      if (method === 'POST' && url === '/api/v1/assets/uploads') {
        reply = state.imageReply?.authorize ?? {
          status: 201,
          body: {
            success: true,
            data: {
              asset: {
                id: ASSET_ID,
                status: 'PENDING',
                contentType: 'image/png',
                sizeBytes: 3,
                url: `/api/v1/assets/${ASSET_ID}`,
              },
              upload: {
                url: `/api/v1/assets/${ASSET_ID}/content`,
                method: 'PUT',
                headers: { 'Content-Type': 'image/png' },
                expiresAt: NOW,
              },
            },
          },
        };
      } else if (method === 'PUT' && url === `/api/v1/assets/${ASSET_ID}/content`) {
        reply = state.imageReply?.bytes ?? ok(null);
      } else if (method === 'POST' && url === `/api/v1/assets/${ASSET_ID}/complete`) {
        reply =
          state.imageReply?.complete ??
          ok({
            asset: {
              id: ASSET_ID,
              status: 'READY',
              contentType: 'image/png',
              sizeBytes: 3,
              url: `/api/v1/assets/${ASSET_ID}`,
            },
          });
      } else {
        throw new Error(`unexpected request: ${method} ${url}`);
      }
      if (reply === 'network-error') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return { state, calls };
}

// ───────────── a controllable collaboration session ─────────────

const baseState: CollabState = {
  phase: 'live',
  everSynced: true,
  readOnly: false,
  role: 'EDITOR',
  unsyncedChanges: false,
  generation: 1,
  reason: null,
};
const retry = vi.fn();
let unsynced = false;

function fakeSession(ydoc: Y.Doc | null): CollabSession {
  return {
    doc: ydoc,
    provider: null,
    getState: () => baseState,
    subscribe: () => () => undefined,
    hasUnsyncedChanges: () => unsynced,
    retry,
    start: () => undefined,
    destroy: () => undefined,
  } as unknown as CollabSession;
}
function setSession(state: Partial<CollabState>, content?: EditorDocument) {
  const ydoc =
    state.phase === 'denied' || state.phase === 'revoked'
      ? null
      : content
        ? contentToYDoc(content)
        : new Y.Doc();
  live.current = { session: fakeSession(ydoc), state: { ...baseState, ...state } };
}

let editor: Editor;
function mount(canEdit = true) {
  return render(
    <AuthProvider initialUser={USER}>
      <PageEditor pageId={PAGE_ID} canEdit={canEdit} onReady={(e) => (editor = e)} />
    </AuthProvider>,
  );
}
async function ready() {
  await waitFor(() => expect(editor).toBeDefined());
  await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull());
}
const type = (text: string) => act(() => void editor.commands.insertContent(text));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  editor = undefined as unknown as Editor;
  unsynced = false;
  retry.mockReset();
  setSession({});
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('opening a page', () => {
  it('shows a loading state until the document has synced for the first time', () => {
    setSession({ phase: 'connecting', everSynced: false });
    mount();
    expect(screen.getByRole('status', { name: 'Loading document' })).toBeTruthy();
    expect(document.querySelector('.ProseMirror')).toBeNull();
  });

  it('shows the live document with its toolbar and a connection indicator', async () => {
    setSession(
      {},
      doc(
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Quarterly plan' }],
        },
        p('Body text'),
      ),
    );
    mount();
    expect(await screen.findByRole('heading', { level: 2, name: 'Quarterly plan' })).toBeTruthy();
    expect(screen.getByText('Body text')).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('opens an empty, editable document for a page that was never edited', async () => {
    mount();
    await ready();
    expect(editor.isEmpty).toBe(true);
    expect(editor.isEditable).toBe(true);
    expect(document.querySelector('p.is-editor-empty')?.getAttribute('data-placeholder')).toMatch(
      /commands/,
    );
  });

  it('never calls the page-content API: the document lives in the collaborative document', async () => {
    const server = installServer();
    mount();
    await ready();
    await type('hello');
    await advance(20_000);
    expect(
      server.calls.filter((c) => c.url.includes('/content') && c.url.includes('/pages/')),
    ).toEqual([]);
  });
});

describe('connection states', () => {
  it('explains when the document cannot be opened and retries on request', async () => {
    setSession({ phase: 'unavailable', everSynced: false }, undefined);
    live.current = {
      session: fakeSession(null),
      state: { ...baseState, phase: 'unavailable', everSynced: false },
    };
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be opened/);
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([
    ['denied', 'You do not have access to this page.'],
    ['revoked', 'Your access to this page has ended.'],
  ] as const)('%s: shows the reason and no editor', async (phase, reason) => {
    setSession({ phase, reason, readOnly: true });
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain(reason);
    expect(document.querySelector('.ProseMirror')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('keeps the editor and says so when offline, with a reconnect button', async () => {
    setSession({ phase: 'offline' }, doc(p('Still here')));
    mount();
    expect(await screen.findByText('Still here')).toBeTruthy();
    expect(screen.getByText(/Offline\./)).toBeTruthy();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Reconnect now' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(editor.isEditable).toBe(true);
  });

  it('shows that changes are still being sent', async () => {
    setSession({ unsyncedChanges: true });
    mount();
    expect(await screen.findByText('Syncing…')).toBeTruthy();
  });

  it('asks the browser to confirm leaving while changes are unconfirmed', async () => {
    mount();
    await ready();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    unsynced = true;
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe('read-only access', () => {
  it('a role without edit rights sees content without toolbar and cannot edit', async () => {
    setSession({ readOnly: true, role: 'VIEWER' }, doc(p('Secret plan')));
    mount(false);
    expect(await screen.findByText('Secret plan')).toBeTruthy();
    expect(editor.isEditable).toBe(false);
    expect(document.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByText(/read-only access/i)).toBeTruthy();
  });

  it('follows the server: read-only when it says so, editable again after an upgrade', async () => {
    setSession({}, doc(p('Shared')));
    const view = mount();
    await ready();
    expect(editor.isEditable).toBe(true);

    setSession({ readOnly: true, role: 'VIEWER' }, doc(p('Shared')));
    view.rerender(
      <AuthProvider initialUser={USER}>
        <PageEditor pageId={PAGE_ID} canEdit onReady={(e) => (editor = e)} />
      </AuthProvider>,
    );
    await waitFor(() => expect(editor.isEditable).toBe(false));
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it("the server's answer wins over the page list: canEdit with a read-only connection stays read-only", async () => {
    setSession({ readOnly: true, role: 'COMMENTER' }, doc(p('x')));
    mount(true);
    await ready();
    expect(editor.isEditable).toBe(false);
  });
});

describe('toolbar', () => {
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const json = () =>
    editor.getJSON() as {
      content: {
        type: string;
        attrs?: Record<string, unknown>;
        content?: { marks?: { type: string; attrs?: Record<string, string> }[] }[];
      }[];
    };

  async function open(content: EditorDocument = doc(p('hello'))) {
    installServer();
    setSession({}, content);
    mount();
    await ready();
    await screen.findByRole('toolbar');
  }

  it('is a labelled toolbar with one tab stop and arrow-key navigation', async () => {
    await open();
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    const controls = [...toolbar.querySelectorAll<HTMLElement>('button, select')].filter(
      (e) => !(e as HTMLButtonElement).disabled,
    );
    expect(controls.filter((e) => e.tabIndex === 0)).toHaveLength(1);
    const u = user();
    controls[0]!.focus();
    await u.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(controls[1]);
    await u.keyboard('{End}');
    expect(document.activeElement).toBe(controls[controls.length - 1]);
    await u.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(controls[0]);
    expect(controls.filter((e) => e.tabIndex === 0)).toEqual([controls[0]]);
  });

  it('every button has an accessible name', async () => {
    await open();
    for (const b of within(screen.getByRole('toolbar')).getAllByRole('button')) {
      expect(b.getAttribute('aria-label') ?? b.textContent).toBeTruthy();
    }
  });

  it('bold, italic and underline toggle and reflect state', async () => {
    await open();
    const u = user();
    act(() => void editor.commands.selectAll());
    for (const [name, mark] of [
      ['Bold', 'bold'],
      ['Italic', 'italic'],
      ['Underline', 'underline'],
    ] as const) {
      await u.click(screen.getByRole('button', { name }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true'),
      );
      expect(json().content[0]!.content![0]!.marks!.map((m) => m.type)).toContain(mark);
    }
    await u.click(screen.getByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe(
        'false',
      ),
    );
  });

  it('text style select switches between paragraph and headings', async () => {
    await open();
    const u = user();
    await u.selectOptions(screen.getByRole('combobox', { name: 'Text style' }), 'h2');
    expect(json().content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    await u.selectOptions(screen.getByRole('combobox', { name: 'Text style' }), 'p');
    expect(json().content[0]!.type).toBe('paragraph');
  });

  it('lists and checklists', async () => {
    await open();
    const u = user();
    for (const [name, type] of [
      ['Bulleted list', 'bulletList'],
      ['Numbered list', 'orderedList'],
      ['Checklist', 'taskList'],
    ] as const) {
      await u.click(screen.getByRole('button', { name }));
      expect(json().content[0]!.type).toBe(type);
      await waitFor(() =>
        expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true'),
      );
    }
  });

  it('alignment', async () => {
    await open();
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Align center' }));
    expect(json().content[0]!.attrs).toMatchObject({ textAlign: 'center' });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Align center' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    await u.click(screen.getByRole('button', { name: 'Align justify' }));
    expect(json().content[0]!.attrs).toMatchObject({ textAlign: 'justify' });
  });

  it('links: needs a selection, normalizes input, rejects unsafe addresses, can be removed', async () => {
    await open();
    const u = user();
    expect((screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => void editor.commands.selectAll());
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await u.click(screen.getByRole('button', { name: 'Link' }));
    const input = screen.getByRole('textbox', { name: 'Link address' });
    await u.type(input, 'javascript:alert(1)');
    await u.click(screen.getByRole('button', { name: 'Apply' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/web address/i);
    expect(json().content[0]!.content![0]!.marks).toBeUndefined();
    await u.clear(input);
    await u.type(input, 'example.com/docs');
    await u.click(screen.getByRole('button', { name: 'Apply' }));
    expect(json().content[0]!.content![0]!.marks![0]).toMatchObject({
      type: 'link',
      attrs: { href: 'https://example.com/docs' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Link' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    );
    await u.click(screen.getByRole('button', { name: 'Link' }));
    await u.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(json().content[0]!.content![0]!.marks).toBeUndefined();
  });

  it('tables: insert, contextual row and column controls, delete', async () => {
    await open();
    const u = user();
    expect(screen.queryByRole('group', { name: 'Table' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Insert table' }));
    const group = await screen.findByRole('group', { name: 'Table' });
    const table = () =>
      json().content.find((n) => n.type === 'table') as unknown as {
        content: { content: unknown[] }[];
      };
    expect(table().content).toHaveLength(3);
    await u.click(within(group).getByRole('button', { name: 'Add row below' }));
    await u.click(within(group).getByRole('button', { name: 'Add column right' }));
    expect(table().content).toHaveLength(4);
    expect(table().content[0]!.content).toHaveLength(4);
    await u.click(within(group).getByRole('button', { name: 'Delete table' }));
    expect(json().content.some((n) => n.type === 'table')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Table' })).toBeNull());
  });

  it('undo and redo', async () => {
    await open();
    const u = user();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Bulleted list' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await u.click(screen.getByRole('button', { name: 'Undo' }));
    expect(json().content[0]!.type).toBe('paragraph');
    await u.click(screen.getByRole('button', { name: 'Redo' }));
    expect(json().content[0]!.type).toBe('bulletList');
  });
});

describe('images', () => {
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const png = () =>
    new File([new Uint8Array([0x89, 0x50, 0x4e])], 'Team photo.png', { type: 'image/png' });

  async function open(initial: Partial<ServerState> = {}) {
    const server = installServer(initial);
    setSession({}, doc(p('hello')));
    mount();
    await ready();
    await screen.findByRole('toolbar');
    return server;
  }
  const picker = () => screen.getByLabelText('Choose images to insert') as HTMLInputElement;

  it('uploads through the three-step flow and inserts the image', async () => {
    const server = await open();
    await user().upload(picker(), png());
    await waitFor(() =>
      expect(JSON.stringify(editor.getJSON())).toContain(`/api/v1/assets/${ASSET_ID}`),
    );
    const image = (
      editor.getJSON().content as { type: string; attrs: { src: string; alt: string } }[]
    ).find((n) => n.type === 'image')!;
    expect(image.attrs).toMatchObject({ src: `/api/v1/assets/${ASSET_ID}`, alt: 'Team photo' });
    const flow = server.calls
      .filter((c) => c.url.includes('/assets/'))
      .map((c) => `${c.method} ${c.url}`);
    expect(flow).toEqual([
      'POST /api/v1/assets/uploads',
      `PUT /api/v1/assets/${ASSET_ID}/content`,
      `POST /api/v1/assets/${ASSET_ID}/complete`,
    ]);
    expect(
      server.calls[server.calls.findIndex((c) => c.url.endsWith('/uploads'))]!.body,
    ).toMatchObject({
      purpose: 'PAGE_IMAGE',
      pageId: PAGE_ID,
      contentType: 'image/png',
      sizeBytes: 3,
    });
    // The image is part of the collaborative document: it travels with the document, and no
    // page-content request is made.
    expect(server.calls.some((c) => c.url.includes('/pages/'))).toBe(false);
  });

  it('rejects unsupported and oversized files before sending anything', async () => {
    const server = await open();
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, applyAccept: false });
    await u.upload(picker(), new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/PNG, JPEG, GIF or WebP/);
    const big = new File([new Uint8Array(1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await u.upload(picker(), big);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/at most 5 MB/));
    expect(server.calls.filter((c) => c.url.includes('/assets/'))).toHaveLength(0);
  });

  it('shows a clear message when the server refuses the upload, and inserts nothing', async () => {
    await open({ imageReply: { authorize: fail(413, 'PAYLOAD_TOO_LARGE') } });
    await user().upload(picker(), png());
    expect((await screen.findByRole('alert')).textContent).toMatch(/too large/i);
    expect(JSON.stringify(editor.getJSON())).not.toContain('"image"');
  });

  it('a failed confirmation inserts nothing', async () => {
    await open({ imageReply: { complete: fail(409, 'CONFLICT') } });
    await user().upload(picker(), png());
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be completed/i);
    expect(JSON.stringify(editor.getJSON())).not.toContain('"image"');
  });

  it('the toolbar image button opens the picker', async () => {
    await open();
    const click = vi.spyOn(picker(), 'click');
    await user().click(screen.getByRole('button', { name: 'Insert image' }));
    expect(click).toHaveBeenCalled();
  });
});

describe('slash commands', () => {
  async function open() {
    installServer();
    setSession({}, doc({ type: 'paragraph' }));
    mount();
    await ready();
    await screen.findByRole('toolbar');
    act(() => void editor.commands.focus('end'));
  }
  // jsdom does not turn simulated typing into ProseMirror input, so text goes in through the
  // editor API and keys are sent to the editor element, which is what the browser does too.
  const typeText = (text: string) => act(() => void editor.commands.insertContent(text));
  const press = (key: string) => act(() => void fireEvent.keyDown(editor.view.dom, { key }));

  it('opens a menu on "/", filters as you type and runs the chosen command with Enter', async () => {
    await open();
    typeText('/head');
    const list = await screen.findByRole('listbox', { name: 'Insert' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(3));
    const options = within(list)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options[0]).toMatch(/^Heading 1/);
    expect(editor.view.dom.getAttribute('aria-expanded')).toBe('true');
    press('ArrowDown');
    await waitFor(() =>
      expect(within(list).getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true'),
    );
    press('Enter');
    expect(editor.getJSON().content![0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(JSON.stringify(editor.getJSON())).not.toContain('/head');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(editor.view.dom.hasAttribute('aria-expanded')).toBe(false);
  });

  it('lists every command for a bare slash, including the image command', async () => {
    await open();
    typeText('/');
    const list = await screen.findByRole('listbox');
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(9));
    expect(within(list).getByRole('option', { name: /Image/ })).toBeTruthy();
  });

  it('inserts a table from the menu', async () => {
    await open();
    typeText('/table');
    await screen.findByRole('option', { name: /Table/ });
    press('Enter');
    expect((editor.getJSON().content as { type: string }[]).some((n) => n.type === 'table')).toBe(
      true,
    );
  });

  it('wraps around with the arrow keys', async () => {
    await open();
    typeText('/head');
    const list = await screen.findByRole('listbox');
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(3));
    press('ArrowUp');
    await waitFor(() =>
      expect(within(list).getAllByRole('option')[2]!.getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('shows a message when nothing matches and hides the menu with Escape', async () => {
    await open();
    typeText('/zzzz');
    const message = await screen.findByText('No matching commands');
    press('Escape');
    await waitFor(() => expect(message.closest('div')!.parentElement!.style.display).toBe('none'));
  });

  it('a click on an option runs it', async () => {
    await open();
    typeText('/check');
    const option = await screen.findByRole('option', { name: /Checklist/ });
    fireEvent.mouseDown(option);
    expect((editor.getJSON().content as { type: string }[])[0]!.type).toBe('taskList');
  });

  it('the image command opens the picker and removes the slash text', async () => {
    await open();
    const click = vi.spyOn(
      screen.getByLabelText('Choose images to insert') as HTMLInputElement,
      'click',
    );
    typeText('/imag');
    await screen.findByRole('option', { name: /Image/ });
    press('Enter');
    expect(click).toHaveBeenCalled();
    expect(JSON.stringify(editor.getJSON())).not.toContain('/imag');
  });
});

void status;
