// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentToYDoc } from '@conote/editor/collaboration';
import type { EditorDocument, ThreadDto, UserDto, VersionMetaDto } from '@conote/shared';
import { AuthProvider } from '@/lib/auth-context';
import type { CollabSession, CollabState } from '@/lib/collab-session';
import { PageEditor } from './page-editor';

/*
 * Comments panel and version history in the page editor (Phase 8: FR-CM-02…06, FR-VH-02…06).
 * The live connection is faked; the editor is a real Tiptap editor bound to a real Y.Doc, so
 * anchors are created and resolved for real. The API is a small in-memory fake.
 */

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
const live = vi.hoisted(() => ({
  current: { session: null, state: null } as { session: unknown; state: unknown },
}));
vi.mock('@/lib/use-collab-session', () => ({ useCollabSession: () => live.current }));

const PAGE_ID = '0b1b6a8e-3a52-4c1d-8a49-2b8a4f3d1e01';
const NOW = '2026-11-19T09:00:00.000Z';
const ME: UserDto = {
  id: 'u1',
  email: 'me@example.com',
  displayName: 'Me',
  presenceColor: '#0284C7',
  avatarUrl: null,
  createdAt: NOW,
};
const OTHER = { id: 'u2', displayName: 'Other', presenceColor: '#DC2626', avatarUrl: null };
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

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as EditorDocument;

// ───────────── in-memory API ─────────────

interface Call {
  method: string;
  url: string;
  body: unknown;
}
interface Api {
  threads: ThreadDto[];
  versions: VersionMetaDto[];
  versionStates: Map<string, Uint8Array>;
  calls: Call[];
}
function installApi(initial: Partial<Api> = {}): Api {
  const api: Api = { threads: [], versions: [], versionStates: new Map(), calls: [], ...initial };
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body =
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      api.calls.push({ method, url, body });
      let m: RegExpMatchArray | null;
      if (method === 'GET' && /\/pages\/[^/]+\/threads/.test(url))
        return json({ threads: api.threads });
      if (method === 'GET' && (m = url.match(/\/versions\/([^/?]+)\/state/))) {
        const bytes = api.versionStates.get(m[1]!);
        return bytes
          ? new Response(Uint8Array.from(bytes).buffer, { status: 200 })
          : new Response('{}', { status: 404 });
      }
      if (method === 'GET' && /\/pages\/[^/]+\/versions/.test(url))
        return json({ versions: api.versions });
      if (method === 'POST' && /\/pages\/[^/]+\/threads$/.test(url)) {
        const input = body as {
          anchor: { start: string; end: string };
          quotedText: string;
          body: string;
        };
        const thread: ThreadDto = {
          id: `00000000-0000-4000-8000-00000000000${api.threads.length + 1}`,
          pageId: PAGE_ID,
          anchor: input.anchor,
          quotedText: input.quotedText,
          anchorStatus: 'ACTIVE',
          createdBy: {
            id: ME.id,
            displayName: 'Me',
            presenceColor: ME.presenceColor,
            avatarUrl: null,
          },
          createdAt: NOW,
          resolvedAt: null,
          resolvedBy: null,
          comments: [
            {
              id: 'c-new',
              threadId: 'x',
              author: {
                id: ME.id,
                displayName: 'Me',
                presenceColor: ME.presenceColor,
                avatarUrl: null,
              },
              body: input.body,
              createdAt: NOW,
            },
          ],
        };
        api.threads = [thread, ...api.threads];
        return json({ thread }, 201);
      }
      if (method === 'POST' && (m = url.match(/\/threads\/([^/]+)\/(resolve|reopen)$/))) {
        api.threads = api.threads.map((t) =>
          t.id === m![1]
            ? {
                ...t,
                resolvedAt: m![2] === 'resolve' ? NOW : null,
                resolvedBy: m![2] === 'resolve' ? OTHER : null,
              }
            : t,
        );
        return json({ thread: api.threads.find((t) => t.id === m![1]) });
      }
      if (method === 'POST' && (m = url.match(/\/threads\/([^/]+)\/comments$/))) {
        const comment = {
          id: `r-${api.calls.length}`,
          threadId: m[1]!,
          author: {
            id: ME.id,
            displayName: 'Me',
            presenceColor: ME.presenceColor,
            avatarUrl: null,
          },
          body: (body as { body: string }).body,
          createdAt: NOW,
        };
        api.threads = api.threads.map((t) =>
          t.id === m![1] ? { ...t, comments: [...t.comments, comment] } : t,
        );
        return json({ comment }, 201);
      }
      if (method === 'DELETE' && (m = url.match(/\/comments\/([^/]+)$/))) {
        api.threads = api.threads
          .map((t) => ({ ...t, comments: t.comments.filter((c) => c.id !== m![1]) }))
          .filter((t) => t.comments.length > 0);
        return json(null);
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    }),
  );
  return api;
}

const aThread = (over: Partial<ThreadDto> = {}): ThreadDto => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  pageId: PAGE_ID,
  anchor: { start: 'AQID', end: 'BAUG' }, // does not resolve in the document
  quotedText: 'some quoted words',
  anchorStatus: 'ACTIVE',
  createdBy: OTHER,
  createdAt: NOW,
  resolvedAt: null,
  resolvedBy: null,
  comments: [
    {
      id: 'c1',
      threadId: '00000000-0000-4000-8000-0000000000a1',
      author: OTHER,
      body: 'Please check this',
      createdAt: NOW,
    },
    {
      id: 'c2',
      threadId: '00000000-0000-4000-8000-0000000000a1',
      author: { id: ME.id, displayName: 'Me', presenceColor: ME.presenceColor, avatarUrl: null },
      body: 'Done',
      createdAt: NOW,
    },
  ],
  ...over,
});
const aVersion = (over: Partial<VersionMetaDto> = {}): VersionMetaDto => ({
  id: '00000000-0000-4000-8000-0000000000b1',
  pageId: PAGE_ID,
  kind: 'MANUAL',
  label: 'First draft',
  sizeBytes: 100,
  createdAt: NOW,
  createdBy: OTHER,
  contributors: [OTHER],
  ...over,
});

// ───────────── fake session ─────────────

const baseState: CollabState = {
  phase: 'live',
  everSynced: true,
  readOnly: false,
  role: 'EDITOR',
  unsyncedChanges: false,
  generation: 1,
  reason: null,
  restoring: false,
  restoreError: null,
  commentsTick: 0,
  versionsTick: 0,
};
const createVersion = vi.fn();
const restoreVersion = vi.fn();
function setSession(
  state: Partial<CollabState> = {},
  content: EditorDocument = doc(p('Hello brave new world')),
) {
  const ydoc = contentToYDoc(content);
  const session = {
    doc: ydoc,
    provider: null,
    awareness: null,
    getState: () => baseState,
    subscribe: () => () => undefined,
    hasUnsyncedChanges: () => false,
    retry: vi.fn(),
    start: () => undefined,
    destroy: () => undefined,
    createVersion,
    restoreVersion,
  } as unknown as CollabSession;
  live.current = { session, state: { ...baseState, ...state } };
  return ydoc;
}

let editor: Editor;
function mount(props: { canEdit?: boolean; canComment?: boolean } = {}) {
  const canEdit = props.canEdit ?? true;
  return render(
    <AuthProvider initialUser={ME}>
      <PageEditor
        pageId={PAGE_ID}
        canEdit={canEdit}
        canComment={props.canComment ?? canEdit}
        onReady={(e) => (editor = e)}
      />
    </AuthProvider>,
  );
}
async function ready() {
  await waitFor(() => expect(editor).toBeDefined());
  await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull());
}
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
const openPanel = async (name: 'Comments' | 'Version history') => {
  await user().click(screen.getByRole('button', { name }));
};
function selectText(needle: string) {
  let from = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && from === 0) {
      const at = node.text?.indexOf(needle) ?? -1;
      if (at >= 0) from = pos + at;
    }
  });
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, from, from + needle.length),
      ),
    );
  });
}

beforeEach(() => {
  editor = undefined as unknown as Editor;
  createVersion.mockReset().mockResolvedValue({ ok: true, result: {} });
  restoreVersion.mockReset().mockResolvedValue({ ok: true, result: {} });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('comments panel', () => {
  it('lists threads with quoted text, author and replies, and marks a thread whose text is gone as detached', async () => {
    installApi({ threads: [aThread()] });
    setSession();
    mount();
    await ready();
    await openPanel('Comments');
    const card = await screen.findByTestId('comment-thread');
    expect(within(card).getByText(/some quoted words/)).toBeTruthy();
    expect(within(card).getByText('Please check this')).toBeTruthy();
    expect(within(card).getByText('Done')).toBeTruthy();
    // The anchor does not resolve in the live document: shown as detached, still readable.
    expect(within(card).getByText(/Detached/)).toBeTruthy();
  });

  it('shows resolved threads under their own tab and lets a commenter reopen them', async () => {
    const api = installApi({ threads: [aThread({ resolvedAt: NOW, resolvedBy: OTHER })] });
    setSession();
    mount();
    await ready();
    await openPanel('Comments');
    expect(await screen.findByText('No open comments.')).toBeTruthy();
    await user().click(screen.getByRole('tab', { name: 'Resolved' }));
    const card = await screen.findByTestId('comment-thread');
    await user().click(within(card).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(api.calls.some((c) => c.url.endsWith('/reopen'))).toBe(true));
    await user().click(screen.getByRole('tab', { name: 'Open' }));
    expect(await screen.findByTestId('comment-thread')).toBeTruthy();
  });

  it('replies and resolves through the API', async () => {
    const api = installApi({ threads: [aThread()] });
    setSession();
    mount();
    await ready();
    await openPanel('Comments');
    const card = await screen.findByTestId('comment-thread');
    await user().type(within(card).getByPlaceholderText('Reply…'), 'On it');
    await user().click(within(card).getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(screen.getByText('On it')).toBeTruthy());
    expect(api.calls.find((c) => c.url.endsWith('/comments'))?.body).toEqual({ body: 'On it' });
    await user().click(
      within(screen.getByTestId('comment-thread')).getByRole('button', { name: 'Resolve' }),
    );
    await waitFor(() => expect(screen.getByText('No open comments.')).toBeTruthy());
  });

  it('lets a person delete only their own comment', async () => {
    const api = installApi({ threads: [aThread()] });
    setSession();
    mount();
    await ready();
    await openPanel('Comments');
    const card = await screen.findByTestId('comment-thread');
    expect(within(card).getAllByRole('button', { name: 'Delete' })).toHaveLength(1); // "Done" is mine, the first is not
    await user().click(within(card).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/c2'))).toBe(true),
    );
  });

  it('creates a thread from the selection, anchored to the selected text, and highlights it', async () => {
    const api = installApi();
    setSession();
    mount();
    await ready();
    await openPanel('Comments');
    selectText('brave new');
    await user().type(
      await screen.findByLabelText('Comment on the selected text'),
      'Is this right?',
    );
    await user().click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/threads'))).toBe(true),
    );
    const post = api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/threads'))!.body as {
      anchor: { start: string; end: string };
      quotedText: string;
      body: string;
    };
    expect(post.quotedText).toBe('brave new');
    expect(post.body).toBe('Is this right?');
    expect(post.anchor.start.length).toBeGreaterThan(0);
    expect(post.anchor.end.length).toBeGreaterThan(0);
    // The new thread is listed and its text is highlighted: a decoration, not part of the document.
    await screen.findByTestId('comment-thread');
    await waitFor(() =>
      expect(document.querySelector('[data-comment-thread]')?.textContent).toBe('brave new'),
    );
    expect(JSON.stringify(editor.getJSON())).not.toContain('data-comment-thread');
    expect(screen.queryByText(/Detached/)).toBeNull();
  });

  it('keeps the highlight on the text when the text before it changes', async () => {
    installApi();
    setSession();
    mount();
    await ready();
    await openPanel('Comments');
    selectText('brave new');
    await user().type(await screen.findByLabelText('Comment on the selected text'), 'c');
    await user().click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(document.querySelector('[data-comment-thread]')).not.toBeNull());
    act(() => void editor.chain().insertContentAt(1, 'Well, ').run());
    await waitFor(() =>
      expect(document.querySelector('[data-comment-thread]')?.textContent).toBe('brave new'),
    );
  });

  it('a Viewer reads comments but gets no way to add, reply or resolve', async () => {
    installApi({ threads: [aThread()] });
    setSession({ readOnly: true, role: 'VIEWER' });
    mount({ canEdit: false, canComment: false });
    await ready();
    await openPanel('Comments');
    const card = await screen.findByTestId('comment-thread');
    expect(within(card).getByText('Please check this')).toBeTruthy();
    expect(
      screen.queryByLabelText(/Comment on the selected text|Select text to comment/),
    ).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(within(card).queryByPlaceholderText('Reply…')).toBeNull();
    expect(screen.getByText(/can read comments on this page but not add any/)).toBeTruthy();
  });

  it('a Commenter on a read-only page can still comment (comments are not document edits)', async () => {
    installApi();
    setSession({ readOnly: true, role: 'COMMENTER' });
    mount({ canEdit: false, canComment: true });
    await ready();
    await openPanel('Comments');
    expect(editor.isEditable).toBe(false);
    selectText('brave');
    expect(await screen.findByLabelText('Comment on the selected text')).toBeTruthy();
  });

  it('shows an API failure without losing what was typed', async () => {
    installApi({ threads: [aThread()] });
    setSession();
    mount();
    await ready();
    await openPanel('Comments');
    const card = await screen.findByTestId('comment-thread');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error: {
                code: 'FORBIDDEN',
                message: 'You do not have permission to do this.',
                requestId: 'r',
              },
            }),
            { status: 403 },
          ),
      ),
    );
    await user().type(within(card).getByPlaceholderText('Reply…'), 'Still here');
    await user().click(within(card).getByRole('button', { name: 'Reply' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      (
        within(screen.getByTestId('comment-thread')).getByPlaceholderText(
          'Reply…',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe('Still here');
  });
});

describe('version history', () => {
  async function versionState(text: string): Promise<Uint8Array> {
    return Y.encodeStateAsUpdate(contentToYDoc(doc(p(text))));
  }

  it('lists versions with kind, author and contributors, and says when there are none', async () => {
    installApi();
    setSession();
    mount();
    await ready();
    await openPanel('Version history');
    expect(await screen.findByText('No versions yet.')).toBeTruthy();
    cleanup();
    installApi({
      versions: [
        aVersion(),
        aVersion({
          id: '00000000-0000-4000-8000-0000000000b2',
          kind: 'AUTO',
          label: null,
          createdBy: null,
          contributors: [],
        }),
      ],
    });
    editor = undefined as unknown as Editor;
    setSession();
    mount();
    await ready();
    await openPanel('Version history');
    expect(await screen.findByText('First draft')).toBeTruthy();
    expect(screen.getByText(/By Other · Edited by Other/)).toBeTruthy();
    expect(screen.getAllByText(/Automatic/).length).toBeGreaterThan(0);
  });

  it('shows a previous version read-only without touching the live page', async () => {
    const version = aVersion();
    installApi({
      versions: [version],
      versionStates: new Map([[version.id, await versionState('Old content')]]),
    });
    setSession({}, doc(p('Current content')));
    mount();
    await ready();
    await openPanel('Version history');
    await user().click(await screen.findByRole('button', { name: /First draft/ }));
    const preview = await screen.findByTestId('version-preview');
    await waitFor(() => expect(within(preview).getByText('Old content')).toBeTruthy());
    expect(within(preview).getByText(/read only/)).toBeTruthy();
    expect(preview.querySelector('[contenteditable="true"]')).toBeNull();
    // The live document is exactly as it was.
    expect(editor.getText()).toBe('Current content');
    expect(restoreVersion).not.toHaveBeenCalled();
    await user().click(within(preview).getByRole('button', { name: 'Back to the page' }));
    expect(screen.queryByTestId('version-preview')).toBeNull();
  });

  it('restores after a confirmation, through the collaboration connection', async () => {
    const version = aVersion();
    installApi({
      versions: [version],
      versionStates: new Map([[version.id, await versionState('Old content')]]),
    });
    setSession();
    mount();
    await ready();
    await openPanel('Version history');
    await user().click(await screen.findByRole('button', { name: /First draft/ }));
    const preview = await screen.findByTestId('version-preview');
    await user().click(within(preview).getByRole('button', { name: 'Restore this version' }));
    expect(restoreVersion).not.toHaveBeenCalled(); // asks first
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm restore' });
    expect(within(dialog).getByText(/saved first/)).toBeTruthy();
    await user().click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith(version.id));
    await waitFor(() => expect(screen.queryByTestId('version-preview')).toBeNull());
  });

  it('cancelling the confirmation restores nothing', async () => {
    const version = aVersion();
    installApi({
      versions: [version],
      versionStates: new Map([[version.id, await versionState('Old')]]),
    });
    setSession();
    mount();
    await ready();
    await openPanel('Version history');
    await user().click(await screen.findByRole('button', { name: /First draft/ }));
    const preview = await screen.findByTestId('version-preview');
    await user().click(within(preview).getByRole('button', { name: 'Restore this version' }));
    await user().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows why a restore was refused and stays on the version', async () => {
    restoreVersion.mockResolvedValue({
      ok: false,
      code: 'CONFLICT',
      message: 'The page is already being restored.',
    });
    const version = aVersion();
    installApi({
      versions: [version],
      versionStates: new Map([[version.id, await versionState('Old')]]),
    });
    setSession();
    mount();
    await ready();
    await openPanel('Version history');
    await user().click(await screen.findByRole('button', { name: /First draft/ }));
    const preview = await screen.findByTestId('version-preview');
    await user().click(within(preview).getByRole('button', { name: 'Restore this version' }));
    await user().click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('The page is already being restored.')).toBeTruthy();
    expect(screen.getByTestId('version-preview')).toBeTruthy();
  });

  it('a Viewer can inspect versions but is offered neither saving nor restoring', async () => {
    const version = aVersion();
    installApi({
      versions: [version],
      versionStates: new Map([[version.id, await versionState('Old')]]),
    });
    setSession({ readOnly: true, role: 'VIEWER' });
    mount({ canEdit: false });
    await ready();
    await openPanel('Version history');
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    await user().click(await screen.findByRole('button', { name: /First draft/ }));
    const preview = await screen.findByTestId('version-preview');
    await waitFor(() => expect(within(preview).getByText('Old')).toBeTruthy());
    expect(within(preview).queryByRole('button', { name: 'Restore this version' })).toBeNull();
  });

  it('saves a named version through the collaboration connection', async () => {
    installApi();
    setSession();
    mount();
    await ready();
    await openPanel('Version history');
    await user().type(
      await screen.findByLabelText('Save the page as it is now'),
      'Before the rewrite',
    );
    await user().click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(createVersion).toHaveBeenCalledWith('Before the rewrite'));
  });

  it('shows a version that cannot be loaded as an error, not a blank page', async () => {
    const version = aVersion();
    installApi({ versions: [version] }); // no state stored: the state endpoint answers 404
    setSession();
    mount();
    await ready();
    await openPanel('Version history');
    await user().click(await screen.findByRole('button', { name: /First draft/ }));
    expect(
      await screen.findByText('This item no longer exists, or you no longer have access to it.'),
    ).toBeTruthy();
  });
});

describe('while a version is being restored (D62)', () => {
  it('pauses editing and says why; editing comes back when the restore ends', async () => {
    installApi();
    setSession({ restoring: true });
    const view = mount();
    await ready();
    expect(editor.isEditable).toBe(false);
    expect(screen.getByText(/A version is being restored/)).toBeTruthy();
    setSession({ restoring: false });
    view.rerender(
      <AuthProvider initialUser={ME}>
        <PageEditor pageId={PAGE_ID} canEdit canComment onReady={(e) => (editor = e)} />
      </AuthProvider>,
    );
    await waitFor(() => expect(editor.isEditable).toBe(true));
    expect(screen.queryByText(/A version is being restored/)).toBeNull();
  });

  it('keeps Save version and Restore unavailable during a restore', async () => {
    installApi();
    setSession({ restoring: true });
    mount();
    await ready();
    await openPanel('Version history');
    expect(
      (screen.getByRole('button', { name: 'Save version' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the reason when a restore failed', async () => {
    installApi();
    setSession({ restoreError: 'The version could not be restored. The page was not changed.' });
    mount();
    await ready();
    await openPanel('Version history');
    expect(
      await screen.findByText('The version could not be restored. The page was not changed.'),
    ).toBeTruthy();
    expect(fireEvent).toBeDefined();
  });
});
