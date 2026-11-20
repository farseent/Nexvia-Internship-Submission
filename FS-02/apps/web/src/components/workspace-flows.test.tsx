// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberDto, PageDto, UserDto, WorkspaceDto, WorkspaceRole } from '@conote/shared';
import { AuthProvider } from '@/lib/auth-context';
import { buildPageTree } from '@/lib/page-tree';
import { CreateWorkspaceForm } from './create-workspace-form';
import { InviteAccept } from './invite-accept';
import { MembersManager } from './members-manager';
import { PageTreeNav } from './page-tree-nav';
import { WorkspaceContext, type WorkspaceContextValue } from './workspace-context';
import { WorkspaceDashboard } from './workspace-dashboard';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const WS_ID = '0b1b6a8e-3a52-4c1d-8a49-2b8a4f3d1e01';
const ME_ID = '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'A'.repeat(43);
const NOW = '2026-11-14T00:00:00.000Z';

const USER: UserDto = {
  id: ME_ID,
  email: 'me@example.com',
  displayName: 'Me',
  presenceColor: '#0284C7',
  avatarUrl: null,
  createdAt: NOW,
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}
type Handler = (call: Call) => { status: number; body: unknown };

/** Stub `fetch` with routes keyed "METHOD /path"; records every call. */
function stubApi(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = {
        method: init.method ?? 'GET',
        url,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const handler = routes[`${call.method} ${url}`];
      if (!handler) throw new Error(`unexpected request: ${call.method} ${url}`);
      const { status, body } = handler(call);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
const fail = (status: number, code: string) => ({
  status,
  body: { success: false, error: { code, message: 'server message', requestId: 'r1' } },
});

const summary = (id: string, displayName: string) => ({
  id,
  displayName,
  presenceColor: '#4F46E5',
  avatarUrl: null,
});

function workspaceDto(myRole: WorkspaceRole): WorkspaceDto {
  return { id: WS_ID, name: 'Team', myRole, createdAt: NOW, updatedAt: NOW };
}

function contextValue(myRole: WorkspaceRole, pages: PageDto[] = []): WorkspaceContextValue {
  return {
    workspace: workspaceDto(myRole),
    pages,
    tree: buildPageTree(pages),
    canCreateRoot: myRole === 'OWNER' || myRole === 'ADMIN' || myRole === 'EDITOR',
    isAdmin: myRole === 'OWNER' || myRole === 'ADMIN',
    isOwner: myRole === 'OWNER',
    reloadPages: async () => {},
    reloadWorkspace: async () => {},
  };
}

function renderIn(ui: ReactNode, role: WorkspaceRole = 'ADMIN', user: UserDto | null = USER) {
  return render(
    <AuthProvider initialUser={user}>
      <WorkspaceContext.Provider value={contextValue(role)}>{ui}</WorkspaceContext.Provider>
    </AuthProvider>,
  );
}

const page = (id: string, over: Partial<PageDto> = {}): PageDto => ({
  id,
  workspaceId: WS_ID,
  parentId: null,
  title: `Page ${id}`,
  icon: null,
  position: 'i',
  myRole: 'EDITOR',
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  ...over,
});

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  window.sessionStorage.clear();
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workspace dashboard', () => {
  it('lists the workspaces with the user’s role', async () => {
    stubApi({ 'GET /api/v1/workspaces': () => ok({ workspaces: [workspaceDto('EDITOR')] }) });
    render(
      <AuthProvider initialUser={USER}>
        <WorkspaceDashboard displayName="Me" />
      </AuthProvider>,
    );
    const link = await screen.findByRole('link', { name: /Team/ });
    expect(link.getAttribute('href')).toBe(`/workspaces/${WS_ID}`);
    expect(within(link).getByText('Editor')).toBeTruthy();
  });

  it('shows an empty state and a way to create a workspace', async () => {
    stubApi({ 'GET /api/v1/workspaces': () => ok({ workspaces: [] }) });
    render(
      <AuthProvider initialUser={USER}>
        <WorkspaceDashboard displayName="Me" />
      </AuthProvider>,
    );
    expect(await screen.findByText('You are not in any workspace yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New workspace' }).getAttribute('href')).toBe(
      '/workspaces/new',
    );
  });

  it('offers to review an invitation that was stored before signing in', async () => {
    window.sessionStorage.setItem('conote.invitation', TOKEN);
    stubApi({ 'GET /api/v1/workspaces': () => ok({ workspaces: [] }) });
    render(
      <AuthProvider initialUser={USER}>
        <WorkspaceDashboard displayName="Me" />
      </AuthProvider>,
    );
    expect(await screen.findByRole('link', { name: 'Review invitation' })).toBeTruthy();
  });
});

describe('create workspace form', () => {
  it('validates before calling the API', async () => {
    const calls = stubApi({});
    renderIn(<CreateWorkspaceForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByText('Enter a workspace name')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('creates the workspace and opens it', async () => {
    const calls = stubApi({
      'POST /api/v1/workspaces': () => ok({ workspace: workspaceDto('OWNER') }),
    });
    renderIn(<CreateWorkspaceForm />);
    await userEvent.type(screen.getByLabelText('Workspace name'), '  Team  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/workspaces/${WS_ID}`));
    expect(calls[0]?.body).toEqual({ name: 'Team' });
  });
});

describe('page tree navigation', () => {
  const pages = [
    page('a', { title: 'Projects' }),
    page('b', { title: 'Roadmap', parentId: 'a' }),
    page('v', { title: 'Read only', position: 'r', myRole: 'VIEWER' }),
  ];

  function renderTree(expanded: string[], handlers = { toggle: vi.fn(), add: vi.fn() }) {
    render(
      <PageTreeNav
        nodes={buildPageTree(pages)}
        workspaceId={WS_ID}
        currentPageId="b"
        expanded={new Set(expanded)}
        onToggle={handlers.toggle}
        onAddChild={handlers.add}
        busyParentId={null}
      />,
    );
    return handlers;
  }

  it('shows nested pages only when the parent is expanded, and marks the current page', () => {
    renderTree([]);
    expect(screen.queryByText('Roadmap')).toBeNull();
    cleanup();
    renderTree(['a']);
    const current = screen.getByRole('link', { name: /Roadmap/ });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.getAttribute('href')).toBe(`/workspaces/${WS_ID}/pages/b`);
  });

  it('toggles a branch and adds a subpage, but only where the user can edit', async () => {
    const handlers = renderTree([]);
    await userEvent.click(screen.getByRole('button', { name: 'Expand Projects' }));
    expect(handlers.toggle).toHaveBeenCalledWith('a');
    await userEvent.click(screen.getByRole('button', { name: 'Add a subpage to Projects' }));
    expect(handlers.add).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('button', { name: 'Add a subpage to Read only' })).toBeNull();
  });
});

describe('members and invitations', () => {
  const members: MemberDto[] = [
    {
      user: summary(OWNER_ID, 'Olive Owner'),
      email: 'olive@example.com',
      role: 'OWNER',
      joinedAt: NOW,
    },
    { user: summary(ME_ID, 'Me'), email: 'me@example.com', role: 'ADMIN', joinedAt: NOW },
    {
      user: summary(VIEWER_ID, 'Vic Viewer'),
      email: 'vic@example.com',
      role: 'VIEWER',
      joinedAt: NOW,
    },
  ];
  const baseRoutes = (): Record<string, Handler> => ({
    [`GET /api/v1/workspaces/${WS_ID}/members`]: () => ok({ members }),
    [`GET /api/v1/workspaces/${WS_ID}/invitations?limit=100`]: () => ok({ invitations: [] }),
  });

  it('protects the owner and stops admins from granting the admin role', async () => {
    stubApi(baseRoutes());
    renderIn(<MembersManager />, 'ADMIN');
    expect(await screen.findByText('Olive Owner')).toBeTruthy();
    // The owner's role is a label, not a control; an admin cannot remove the owner.
    expect(screen.queryByLabelText('Role of Olive Owner')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Remove Olive Owner from the workspace' }),
    ).toBeNull();
    // An admin can change a viewer, but not to admin.
    const select = screen.getByLabelText('Role of Vic Viewer') as HTMLSelectElement;
    const adminOption = within(select).getByRole('option', { name: 'Admin' }) as HTMLOptionElement;
    expect(adminOption.disabled).toBe(true);
    expect(
      (within(select).getByRole('option', { name: 'Editor' }) as HTMLOptionElement).disabled,
    ).toBe(false);
  });

  it('changes a member’s role', async () => {
    const calls = stubApi({
      ...baseRoutes(),
      [`PATCH /api/v1/workspaces/${WS_ID}/members/${VIEWER_ID}`]: () =>
        ok({ member: { ...members[2], role: 'EDITOR' } }),
    });
    renderIn(<MembersManager />, 'ADMIN');
    await userEvent.selectOptions(await screen.findByLabelText('Role of Vic Viewer'), 'EDITOR');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'EDITOR' });
  });

  it('removes a member only after confirmation', async () => {
    const calls = stubApi({
      ...baseRoutes(),
      [`DELETE /api/v1/workspaces/${WS_ID}/members/${VIEWER_ID}`]: () => ok(null),
    });
    renderIn(<MembersManager />, 'ADMIN');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Vic Viewer from the workspace' }),
    );
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('lets a member leave and goes back to the dashboard', async () => {
    stubApi({
      ...baseRoutes(),
      [`DELETE /api/v1/workspaces/${WS_ID}/members/${ME_ID}`]: () => ok(null),
    });
    renderIn(<MembersManager />, 'ADMIN');
    await userEvent.click(await screen.findByRole('button', { name: 'Leave workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm leave' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'));
  });

  it('creates an invitation and shows the link once', async () => {
    const inviteUrl = `http://localhost:3000/invite#token=${TOKEN}`;
    const calls = stubApi({
      ...baseRoutes(),
      [`POST /api/v1/workspaces/${WS_ID}/invitations`]: () =>
        ok({
          invitation: {
            id: '33333333-3333-4333-8333-333333333333',
            email: 'new@example.com',
            role: 'EDITOR',
            status: 'PENDING',
            expiresAt: NOW,
            createdAt: NOW,
            invitedBy: null,
          },
          inviteUrl,
        }),
    });
    renderIn(<MembersManager />, 'ADMIN');
    await userEvent.type(await screen.findByLabelText('Email address'), ' New@Example.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    const link = (await screen.findByLabelText('Invitation link')) as HTMLInputElement;
    expect(link.value).toBe(inviteUrl);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      email: 'new@example.com',
      role: 'EDITOR',
    });
  });

  it('only offers the admin role to invite when the user is the owner', async () => {
    stubApi(baseRoutes());
    const { unmount } = renderIn(<MembersManager />, 'ADMIN');
    const roleSelect = (await screen.findByLabelText('Role')) as HTMLSelectElement;
    expect(within(roleSelect).queryByRole('option', { name: 'Admin' })).toBeNull();
    unmount();
    stubApi(baseRoutes());
    renderIn(<MembersManager />, 'OWNER');
    const ownerSelect = (await screen.findByLabelText('Role')) as HTMLSelectElement;
    expect(within(ownerSelect).getByRole('option', { name: 'Admin' })).toBeTruthy();
  });

  it('hides invitation management from non-admins', async () => {
    stubApi({
      [`GET /api/v1/workspaces/${WS_ID}/members`]: () =>
        ok({ members: members.map((m) => ({ user: m.user, role: m.role, joinedAt: m.joinedAt })) }),
    });
    renderIn(<MembersManager />, 'EDITOR');
    expect(await screen.findByText('Vic Viewer')).toBeTruthy();
    expect(screen.queryByText('Invite people')).toBeNull();
    expect(screen.queryByLabelText('Role of Vic Viewer')).toBeNull();
  });
});

describe('invitation page', () => {
  const preview = {
    workspaceName: 'Team',
    role: 'EDITOR',
    invitedBy: 'Olive Owner',
    emailHint: 'm***@example.com',
  };

  it('previews the invitation from the URL fragment and accepts it', async () => {
    window.location.hash = `#token=${TOKEN}`;
    const calls = stubApi({
      'POST /api/v1/invitations/preview': () => ok(preview),
      'POST /api/v1/invitations/accept': () => ok({ workspace: workspaceDto('EDITOR') }),
    });
    renderIn(<InviteAccept />);
    expect(await screen.findByText('Team')).toBeTruthy();
    expect(screen.getByText(/m\*\*\*@example\.com/)).toBeTruthy();
    expect(calls[0]?.body).toEqual({ token: TOKEN });

    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/workspaces/${WS_ID}`));
    expect(window.sessionStorage.getItem('conote.invitation')).toBeNull();
  });

  it('asks signed-out visitors to sign in, and remembers the invitation for after sign-in', async () => {
    window.location.hash = `#token=${TOKEN}`;
    stubApi({ 'POST /api/v1/invitations/preview': () => ok(preview) });
    renderIn(<InviteAccept />, 'VIEWER', null);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
    expect(window.sessionStorage.getItem('conote.invitation')).toBe(TOKEN);
  });

  it('reports an unusable invitation without saying why', async () => {
    window.location.hash = `#token=${TOKEN}`;
    stubApi({ 'POST /api/v1/invitations/preview': () => fail(400, 'INVITATION_INVALID') });
    renderIn(<InviteAccept />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
  });

  it('declines an invitation', async () => {
    window.location.hash = `#token=${TOKEN}`;
    const calls = stubApi({
      'POST /api/v1/invitations/preview': () => ok(preview),
      'POST /api/v1/invitations/decline': () => ok(null),
    });
    renderIn(<InviteAccept />);
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'));
    expect(calls.some((c) => c.url === '/api/v1/invitations/decline')).toBe(true);
  });

  it('explains a link without a token', async () => {
    stubApi({});
    renderIn(<InviteAccept />);
    expect(await screen.findByText(/does not contain a valid invitation/)).toBeTruthy();
  });
});
