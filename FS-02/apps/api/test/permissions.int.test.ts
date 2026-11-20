import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createHarness,
  deleteTestUsers,
  subscribeAccessEvents,
  type Harness,
} from './auth-harness.js';
import { requireInfraEnv } from '../../../tests/helpers.js';
import {
  addMember,
  errorCode,
  newPage,
  newUser,
  newWorkspace,
  type TestUser,
} from './workspace-harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

const setRole = (actor: TestUser, pageId: string, userId: string, role: string) =>
  h.call('PUT', `/api/v1/pages/${pageId}/permissions/${userId}`, {
    token: actor.token,
    body: { role },
  });
const getPage = (user: TestUser, pageId: string) =>
  h.call('GET', `/api/v1/pages/${pageId}`, { token: user.token });
const visibleIds = async (user: TestUser, ws: string) =>
  (
    (await h.call('GET', `/api/v1/workspaces/${ws}/pages`, { token: user.token })).body.data
      .pages as { id: string }[]
  ).map((p) => p.id);

describe('workspace roles on pages (Viewer, Commenter, Editor)', () => {
  it('gives each role its documented capabilities and reports myRole', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page = await newPage(h, owner, ws, { title: 'P' });
    for (const role of ['VIEWER', 'COMMENTER', 'EDITOR', 'ADMIN'] as const) {
      const user = await addMember(h, ws, owner, role);
      const res = await getPage(user, page.id);
      expect(res.status).toBe(200);
      expect(res.body.data.page.myRole).toBe(role);
    }
  });

  it('never reveals pages to non-members: 404, identical to a missing page', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page = await newPage(h, owner, ws, { title: 'Secret' });
    const stranger = await newUser(h, 'stranger');
    const real = await getPage(stranger, page.id);
    const missing = await getPage(stranger, '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11');
    expect(real.status).toBe(404);
    expect(real.body.error.code).toBe(missing.body.error.code);
    expect(real.body.error.message).toBe(missing.body.error.message);
    expect(
      (await h.call('GET', `/api/v1/workspaces/${ws}/pages`, { token: stranger.token })).status,
    ).toBe(404);
    expect(
      (await h.call('POST', `/api/v1/workspaces/${ws}/pages`, { token: stranger.token, body: {} }))
        .status,
    ).toBe(404);
    expect(
      (
        await h.call('PATCH', `/api/v1/pages/${page.id}`, {
          token: stranger.token,
          body: { title: 'x' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await h.call('DELETE', `/api/v1/pages/${page.id}`, { token: stranger.token })).status,
    ).toBe(404);
    expect(
      (await h.call('GET', `/api/v1/pages/${page.id}/activity`, { token: stranger.token })).status,
    ).toBe(404);
  });

  it('keeps one workspace’s role out of another workspace', async () => {
    const owner = await newUser(h, 'owner');
    const wsA = await newWorkspace(h, owner, 'A');
    const wsB = await newWorkspace(h, owner, 'B');
    const user = await addMember(h, wsA, owner, 'EDITOR');
    const pageB = await newPage(h, owner, wsB, { title: 'In B' });
    expect((await getPage(user, pageB.id)).status).toBe(404);
  });
});

describe('page-level permissions (PP-01 … PP-03, D23)', () => {
  it('lets an override restrict or elevate access for one member', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const viewer = await addMember(h, ws, owner, 'VIEWER');
    const page = await newPage(h, owner, ws, { title: 'P' });

    expect((await setRole(owner, page.id, editor.id, 'VIEWER')).status).toBe(200);
    expect((await getPage(editor, page.id)).body.data.page.myRole).toBe('VIEWER');
    expect(
      (
        await h.call('PATCH', `/api/v1/pages/${page.id}`, {
          token: editor.token,
          body: { title: 'x' },
        })
      ).status,
    ).toBe(403);

    expect((await setRole(owner, page.id, viewer.id, 'EDITOR')).status).toBe(200);
    expect(
      (
        await h.call('PATCH', `/api/v1/pages/${page.id}`, {
          token: viewer.token,
          body: { title: 'by viewer' },
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await h.call('DELETE', `/api/v1/pages/${page.id}/permissions/${editor.id}`, {
          token: owner.token,
        })
      ).status,
    ).toBe(200);
    expect((await getPage(editor, page.id)).body.data.page.myRole).toBe('EDITOR');
  });

  it('hides a page from a member with a NONE override, in reads and in lists', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const hidden = await newPage(h, owner, ws, { title: 'Hidden' });
    const open = await newPage(h, owner, ws, { title: 'Open' });
    await setRole(owner, hidden.id, editor.id, 'NONE');

    const res = await getPage(editor, hidden.id);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');
    expect(
      (
        await h.call('PATCH', `/api/v1/pages/${hidden.id}`, {
          token: editor.token,
          body: { title: 'x' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await h.call('DELETE', `/api/v1/pages/${hidden.id}`, { token: editor.token })).status,
    ).toBe(404);
    expect(await visibleIds(editor, ws)).toEqual([open.id]);
    expect((await visibleIds(owner, ws)).sort()).toEqual([hidden.id, open.id].sort());
  });

  it('inherits an override down the tree, a nearer override winning', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const root = await newPage(h, owner, ws, { title: 'Root' });
    const child = await newPage(h, owner, ws, { title: 'Child', parentId: root.id });
    const grandchild = await newPage(h, owner, ws, { title: 'Grandchild', parentId: child.id });
    await setRole(owner, root.id, editor.id, 'VIEWER');

    expect((await getPage(editor, grandchild.id)).body.data.page.myRole).toBe('VIEWER');
    await setRole(owner, child.id, editor.id, 'EDITOR');
    expect((await getPage(editor, grandchild.id)).body.data.page.myRole).toBe('EDITOR');
    expect((await getPage(editor, root.id)).body.data.page.myRole).toBe('VIEWER');

    const permissions = await h.call('GET', `/api/v1/pages/${grandchild.id}/permissions`, {
      token: owner.token,
    });
    expect(permissions.status).toBe(200);
    expect(permissions.body.data.overrides).toEqual([]);
    expect(permissions.body.data.inherited).toHaveLength(1);
    expect(permissions.body.data.inherited[0]).toMatchObject({
      role: 'EDITOR',
      fromPageId: child.id,
    });
    expect(permissions.body.data.inherited[0].user.id).toBe(editor.id);
  });

  it('only shows breadcrumbs for ancestors the member can open', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const root = await newPage(h, owner, ws, { title: 'Root' });
    const child = await newPage(h, owner, ws, { title: 'Child', parentId: root.id });
    await setRole(owner, root.id, editor.id, 'NONE');
    await setRole(owner, child.id, editor.id, 'EDITOR');
    const res = await getPage(editor, child.id);
    expect(res.status).toBe(200);
    expect(res.body.data.breadcrumbs).toEqual([]);
    expect(await visibleIds(editor, ws)).toEqual([child.id]);
  });

  it('never restricts admins or the owner', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const admin = await addMember(h, ws, owner, 'ADMIN');
    const page = await newPage(h, owner, ws);
    for (const target of [admin, owner]) {
      const res = await setRole(owner, page.id, target.id, 'NONE');
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('CANNOT_RESTRICT_ADMIN');
    }
    expect((await getPage(admin, page.id)).body.data.page.myRole).toBe('ADMIN');
  });

  it('restricts who manages permissions, and rejects non-members as targets', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const admin = await addMember(h, ws, owner, 'ADMIN');
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const viewer = await addMember(h, ws, owner, 'VIEWER');
    const stranger = await newUser(h, 'stranger');
    const page = await newPage(h, owner, ws);

    expect((await setRole(editor, page.id, viewer.id, 'NONE')).status).toBe(403);
    expect(
      (await h.call('GET', `/api/v1/pages/${page.id}/permissions`, { token: editor.token })).status,
    ).toBe(403);
    expect(
      (
        await h.call('DELETE', `/api/v1/pages/${page.id}/permissions/${viewer.id}`, {
          token: editor.token,
        })
      ).status,
    ).toBe(403);
    expect((await setRole(stranger, page.id, viewer.id, 'NONE')).status).toBe(404);
    expect((await setRole(owner, page.id, stranger.id, 'VIEWER')).status).toBe(404);
    expect((await setRole(admin, page.id, viewer.id, 'COMMENTER')).status).toBe(200);
    expect((await setRole(owner, page.id, viewer.id, 'ADMIN')).status).toBe(400);
    expect(
      (
        await h.call('DELETE', `/api/v1/pages/${page.id}/permissions/${editor.id}`, {
          token: owner.token,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.call('PUT', `/api/v1/pages/${page.id}/permissions/${viewer.id}`, {
          body: { role: 'NONE' },
        })
      ).status,
    ).toBe(401);
  });

  it('lists overrides and logs permission changes', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const page = await newPage(h, owner, ws);
    await setRole(owner, page.id, editor.id, 'COMMENTER');
    const list = await h.call('GET', `/api/v1/pages/${page.id}/permissions`, {
      token: owner.token,
    });
    expect(list.body.data.overrides).toHaveLength(1);
    expect(list.body.data.overrides[0]).toMatchObject({ role: 'COMMENTER' });
    expect(list.body.data.overrides[0].user.id).toBe(editor.id);
    expect(JSON.stringify(list.body)).not.toContain(editor.email);
    await h.call('DELETE', `/api/v1/pages/${page.id}/permissions/${editor.id}`, {
      token: owner.token,
    });
    const actions = (
      await h.call('GET', `/api/v1/workspaces/${ws}/activity?pageId=${page.id}`, {
        token: owner.token,
      })
    ).body.data.activity.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['page.permission_set', 'page.permission_removed']),
    );
  });

  it('publishes a page.access_changed event for the affected member', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const page = await newPage(h, owner, ws);
    const sub = await subscribeAccessEvents(requireInfraEnv().REDIS_URL);
    try {
      await setRole(owner, page.id, editor.id, 'VIEWER');
      const events = await sub.waitFor(1);
      expect(events[0]).toMatchObject({
        v: 1,
        type: 'page.access_changed',
        workspaceId: ws,
        pageId: page.id,
        userId: editor.id,
      });
    } finally {
      await sub.stop();
    }
  });

  it('lets moving a page under a restricted parent change who can read it', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const locked = await newPage(h, owner, ws, { title: 'Locked' });
    const page = await newPage(h, owner, ws, { title: 'Page' });
    await setRole(owner, locked.id, editor.id, 'NONE');
    expect((await getPage(editor, page.id)).status).toBe(200);
    await h.call('POST', `/api/v1/pages/${page.id}/move`, {
      token: owner.token,
      body: { parentId: locked.id },
    });
    expect((await getPage(editor, page.id)).status).toBe(404);
  });

  it('does not let a restricted editor place pages under a page they cannot edit', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const readOnly = await newPage(h, owner, ws, { title: 'Read only' });
    await setRole(owner, readOnly.id, editor.id, 'VIEWER');
    const res = await h.call('POST', `/api/v1/workspaces/${ws}/pages`, {
      token: editor.token,
      body: { parentId: readOnly.id },
    });
    expect(res.status).toBe(403);
  });
});

describe('activity (ACT-01, ACT-02)', () => {
  it('shows workspace activity to admins only, newest first, with filters and paging', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const a = await newPage(h, owner, ws, { title: 'A' });
    await newPage(h, owner, ws, { title: 'B' });

    expect(
      (await h.call('GET', `/api/v1/workspaces/${ws}/activity`, { token: editor.token })).status,
    ).toBe(403);
    const all = await h.call('GET', `/api/v1/workspaces/${ws}/activity?limit=100`, {
      token: owner.token,
    });
    const times = all.body.data.activity.map((e: { createdAt: string }) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(all.body.data.activity.length).toBeGreaterThanOrEqual(4);

    const first = await h.call('GET', `/api/v1/workspaces/${ws}/activity?limit=2`, {
      token: owner.token,
    });
    expect(first.body.data.activity).toHaveLength(2);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    const second = await h.call(
      'GET',
      `/api/v1/workspaces/${ws}/activity?limit=2&cursor=${first.body.meta.nextCursor}`,
      { token: owner.token },
    );
    const seen = [...first.body.data.activity, ...second.body.data.activity].map(
      (e: { id: string }) => e.id,
    );
    expect(new Set(seen).size).toBe(seen.length);
    expect(
      (
        await h.call('GET', `/api/v1/workspaces/${ws}/activity?cursor=not-a-cursor`, {
          token: owner.token,
        })
      ).status,
    ).toBe(400);

    const created = await h.call(
      'GET',
      `/api/v1/workspaces/${ws}/activity?action=page.created&pageId=${a.id}`,
      { token: owner.token },
    );
    expect(created.body.data.activity).toHaveLength(1);
    expect(created.body.data.activity[0].actor.id).toBe(owner.id);
  });

  it('does not put sensitive data in activity metadata', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const invitee = await newUser(h, 'invitee');
    const res = await h.call('POST', `/api/v1/workspaces/${ws}/invitations`, {
      token: owner.token,
      body: { email: invitee.email, role: 'VIEWER' },
    });
    const token = (res.body.data.inviteUrl as string).split('#token=')[1]!;
    const rows = await h.deps.prisma.activityLog.findMany({ where: { workspaceId: ws } });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(invitee.email);
  });
});
