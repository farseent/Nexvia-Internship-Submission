import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PAGE_DEPTH, PAGE_RETENTION_DAYS } from '@conote/shared';
import {
  createHarness,
  deleteTestUsers,
  subscribeAccessEvents,
  type Harness,
} from './auth-harness.js';
import { requireInfraEnv } from '../../../tests/helpers.js';
import { purgeExpiredPages } from '../src/jobs/page-purge.js';
import { addMember, errorCode, newPage, newUser, newWorkspace } from './workspace-harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

const list = async (token: string, workspaceId: string) =>
  (await h.call('GET', `/api/v1/workspaces/${workspaceId}/pages`, { token })).body.data.pages as {
    id: string;
    parentId: string | null;
    title: string;
    position: string;
    myRole: string;
  }[];

describe('creating and reading pages (PAGE-01 … PAGE-04)', () => {
  it('creates root and nested pages, defaulting the title to Untitled', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const root = await newPage(h, owner, ws);
    expect(root).toMatchObject({
      title: 'Untitled',
      parentId: null,
      workspaceId: ws,
      myRole: 'OWNER',
      deletedAt: null,
    });
    const child = await newPage(h, owner, ws, { title: 'Child', icon: '📄', parentId: root.id });
    expect(child).toMatchObject({ title: 'Child', icon: '📄', parentId: root.id });
    const pages = await list(owner.token, ws);
    expect(pages.map((p) => p.id).sort()).toEqual([root.id, child.id].sort());
  });

  it('orders siblings by position and honours afterPageId (null = first, omitted = last)', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const a = await newPage(h, owner, ws, { title: 'A' });
    const b = await newPage(h, owner, ws, { title: 'B' });
    const c = await newPage(h, owner, ws, { title: 'C', afterPageId: a.id }); // between A and B
    const first = await newPage(h, owner, ws, { title: 'First', afterPageId: null });
    const order = (await list(owner.token, ws)).map((p) => p.title);
    expect(order).toEqual(['First', 'A', 'C', 'B']);
    expect(first.position < a.position && a.position < c.position && c.position < b.position).toBe(
      true,
    );
  });

  it('re-spaces siblings when keys grow too long, keeping their order', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const a = await newPage(h, owner, ws, { title: 'A' });
    const b = await newPage(h, owner, ws, { title: 'B' });
    // Force a very long key directly, as repeated appends eventually would.
    await h.deps.prisma.page.update({
      where: { id: a.id },
      data: { position: 'i'.repeat(50) + '1' },
    });
    await h.deps.prisma.page.update({
      where: { id: b.id },
      data: { position: 'i'.repeat(50) + '2' },
    });
    const c = await newPage(h, owner, ws, { title: 'C', afterPageId: a.id });
    const pages = await list(owner.token, ws);
    expect(pages.map((p) => p.title)).toEqual(['A', 'C', 'B']);
    expect(pages.every((p) => p.position.length <= 48)).toBe(true);
    expect(new Set(pages.map((p) => p.position)).size).toBe(3);
    expect(c.position.length).toBeGreaterThan(0);
  });

  it('rejects an unknown sibling or a parent from another workspace', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const other = await newWorkspace(h, owner, 'Other');
    const foreign = await newPage(h, owner, other, { title: 'Foreign' });
    const post = (body: unknown) =>
      h.call('POST', `/api/v1/workspaces/${ws}/pages`, { token: owner.token, body });

    const crossParent = await post({ parentId: foreign.id });
    expect(crossParent.status).toBe(409);
    expect(errorCode(crossParent)).toBe('INVALID_MOVE');
    const badSibling = await post({ afterPageId: foreign.id });
    expect(errorCode(badSibling)).toBe('INVALID_MOVE');
    expect((await post({ parentId: '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11' })).status).toBe(404);
    expect((await post({ title: 'x'.repeat(201) })).status).toBe(400);
  });

  it('enforces the maximum depth', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    let parentId: string | null = null;
    for (let depth = 1; depth <= MAX_PAGE_DEPTH; depth += 1) {
      const page: { id: string } = await newPage(
        h,
        owner,
        ws,
        parentId === null ? {} : { parentId },
      );
      parentId = page.id;
    }
    const tooDeep = await h.call('POST', `/api/v1/workspaces/${ws}/pages`, {
      token: owner.token,
      body: { parentId },
    });
    expect(tooDeep.status).toBe(409);
    expect(errorCode(tooDeep)).toBe('INVALID_MOVE');
  });

  it('returns a page with breadcrumbs, and renames or re-icons it', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const root = await newPage(h, owner, ws, { title: 'Root' });
    const mid = await newPage(h, owner, ws, { title: 'Mid', parentId: root.id });
    const leaf = await newPage(h, owner, ws, { title: 'Leaf', parentId: mid.id });

    const got = await h.call('GET', `/api/v1/pages/${leaf.id}`, { token: owner.token });
    expect(got.status).toBe(200);
    expect(got.body.data.breadcrumbs).toEqual([
      { id: root.id, title: 'Root' },
      { id: mid.id, title: 'Mid' },
    ]);

    const renamed = await h.call('PATCH', `/api/v1/pages/${leaf.id}`, {
      token: owner.token,
      body: { title: 'Renamed', icon: '🍃' },
    });
    expect(renamed.body.data.page).toMatchObject({ title: 'Renamed', icon: '🍃' });
    const cleared = await h.call('PATCH', `/api/v1/pages/${leaf.id}`, {
      token: owner.token,
      body: { icon: null },
    });
    expect(cleared.body.data.page.icon).toBeNull();
    expect(
      (await h.call('PATCH', `/api/v1/pages/${leaf.id}`, { token: owner.token, body: {} })).status,
    ).toBe(400);

    const log = await h.call('GET', `/api/v1/pages/${leaf.id}/activity`, { token: owner.token });
    expect(log.body.data.activity.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['page.created', 'page.renamed']),
    );
  });
});

describe('moving pages (PAGE-05)', () => {
  it('moves a subtree and publishes an access event', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const a = await newPage(h, owner, ws, { title: 'A' });
    const b = await newPage(h, owner, ws, { title: 'B' });
    const child = await newPage(h, owner, ws, { title: 'Child', parentId: a.id });

    const sub = await subscribeAccessEvents(requireInfraEnv().REDIS_URL);
    try {
      const moved = await h.call('POST', `/api/v1/pages/${a.id}/move`, {
        token: owner.token,
        body: { parentId: b.id },
      });
      expect(moved.status).toBe(200);
      expect(moved.body.data.page.parentId).toBe(b.id);
      const events = await sub.waitFor(1);
      expect(events[0]).toMatchObject({
        type: 'page.access_changed',
        workspaceId: ws,
        pageId: a.id,
      });
    } finally {
      await sub.stop();
    }
    const pages = await list(owner.token, ws);
    expect(pages.find((p) => p.id === child.id)?.parentId).toBe(a.id);
    const back = await h.call('POST', `/api/v1/pages/${a.id}/move`, {
      token: owner.token,
      body: { parentId: null, afterPageId: null },
    });
    expect(back.body.data.page.parentId).toBeNull();
  });

  it('rejects moves under itself or a descendant, across workspaces, or beyond the depth limit', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const other = await newWorkspace(h, owner, 'Other');
    const a = await newPage(h, owner, ws, { title: 'A' });
    const b = await newPage(h, owner, ws, { title: 'B', parentId: a.id });
    const foreign = await newPage(h, owner, other, { title: 'Foreign' });
    const move = (id: string, body: unknown) =>
      h.call('POST', `/api/v1/pages/${id}/move`, { token: owner.token, body });

    for (const body of [{ parentId: a.id }, { parentId: b.id }]) {
      const res = await move(a.id, body);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INVALID_MOVE');
    }
    expect(errorCode(await move(a.id, { parentId: foreign.id }))).toBe('INVALID_MOVE');
    expect(errorCode(await move(a.id, { parentId: null, afterPageId: a.id }))).toBe('INVALID_MOVE');

    // A chain of depth 10 under X: moving a 2-deep subtree beneath its deepest page exceeds the limit.
    let parentId: string | null = null;
    for (let i = 0; i < MAX_PAGE_DEPTH; i += 1) {
      const page: { id: string } = await newPage(
        h,
        owner,
        ws,
        parentId === null ? {} : { parentId },
      );
      parentId = page.id;
    }
    expect(errorCode(await move(a.id, { parentId }))).toBe('INVALID_MOVE');
  });
});

describe('deleting, restoring and purging pages (PAGE-06 … PAGE-09)', () => {
  it('soft-deletes a whole subtree in one batch and hides it', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const root = await newPage(h, owner, ws, { title: 'Root' });
    const child = await newPage(h, owner, ws, { title: 'Child', parentId: root.id });
    const keep = await newPage(h, owner, ws, { title: 'Keep' });

    const sub = await subscribeAccessEvents(requireInfraEnv().REDIS_URL);
    try {
      const del = await h.call('DELETE', `/api/v1/pages/${root.id}`, { token: owner.token });
      expect(del.status).toBe(200);
      expect(del.body.data.deleteBatchId).toMatch(/^[0-9a-f-]{36}$/);
      expect((await sub.waitFor(1))[0]).toMatchObject({
        type: 'page.access_changed',
        pageId: root.id,
      });
    } finally {
      await sub.stop();
    }
    expect((await h.call('GET', `/api/v1/pages/${child.id}`, { token: owner.token })).status).toBe(
      404,
    );
    expect(
      (await h.call('DELETE', `/api/v1/pages/${root.id}`, { token: owner.token })).status,
    ).toBe(404);
    expect((await list(owner.token, ws)).map((p) => p.id)).toEqual([keep.id]);

    const trash = await h.call('GET', `/api/v1/workspaces/${ws}/trash`, { token: owner.token });
    expect(trash.body.data.pages.map((p: { id: string }) => p.id)).toEqual([root.id]);
    expect(trash.body.data.pages[0].deletedAt).not.toBeNull();
  });

  it('restores the batch under the original parent, or as a root when the parent is gone', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const parent = await newPage(h, owner, ws, { title: 'Parent' });
    const child = await newPage(h, owner, ws, { title: 'Child', parentId: parent.id });
    const grandchild = await newPage(h, owner, ws, { title: 'Grandchild', parentId: child.id });

    await h.call('DELETE', `/api/v1/pages/${child.id}`, { token: owner.token });
    const restored = await h.call('POST', `/api/v1/pages/${child.id}/restore`, {
      token: owner.token,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.data.page).toMatchObject({
      id: child.id,
      parentId: parent.id,
      deletedAt: null,
    });
    expect((await list(owner.token, ws)).map((p) => p.id).sort()).toEqual(
      [parent.id, child.id, grandchild.id].sort(),
    );
    expect(
      errorCode(await h.call('POST', `/api/v1/pages/${child.id}/restore`, { token: owner.token })),
    ).toBe('CONFLICT');

    // Delete the whole tree, then restore only the child: its parent is deleted, so it becomes a root.
    await h.call('DELETE', `/api/v1/pages/${parent.id}`, { token: owner.token });
    const asRoot = await h.call('POST', `/api/v1/pages/${child.id}/restore`, {
      token: owner.token,
    });
    expect(asRoot.body.data.page.parentId).toBeNull();
    const ids = (await list(owner.token, ws)).map((p) => p.id).sort();
    expect(ids).toEqual([child.id, grandchild.id].sort());
  });

  it('keeps pages deleted earlier out of a later restore', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const root = await newPage(h, owner, ws, { title: 'Root' });
    const early = await newPage(h, owner, ws, { title: 'Early', parentId: root.id });
    const late = await newPage(h, owner, ws, { title: 'Late', parentId: root.id });
    await h.call('DELETE', `/api/v1/pages/${early.id}`, { token: owner.token });
    await h.call('DELETE', `/api/v1/pages/${root.id}`, { token: owner.token });
    await h.call('POST', `/api/v1/pages/${root.id}/restore`, { token: owner.token });
    const ids = (await list(owner.token, ws)).map((p) => p.id).sort();
    expect(ids).toEqual([root.id, late.id].sort());
  });

  it('purges only deleted pages, only for admins, and cascades to descendants', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const admin = await addMember(h, ws, owner, 'ADMIN');
    const root = await newPage(h, owner, ws, { title: 'Root' });
    const child = await newPage(h, owner, ws, { title: 'Child', parentId: root.id });

    expect(
      errorCode(await h.call('POST', `/api/v1/pages/${root.id}/purge`, { token: owner.token })),
    ).toBe('CONFLICT');
    await h.call('DELETE', `/api/v1/pages/${root.id}`, { token: editor.token });
    expect(
      (await h.call('POST', `/api/v1/pages/${root.id}/purge`, { token: editor.token })).status,
    ).toBe(403);
    const stranger = await newUser(h, 'stranger');
    expect(
      (await h.call('POST', `/api/v1/pages/${root.id}/purge`, { token: stranger.token })).status,
    ).toBe(404);
    expect(
      (await h.call('POST', `/api/v1/pages/${root.id}/purge`, { token: admin.token })).status,
    ).toBe(200);
    expect(await h.deps.prisma.page.count({ where: { id: { in: [root.id, child.id] } } })).toBe(0);
    expect(
      (await h.call('POST', `/api/v1/pages/${root.id}/purge`, { token: admin.token })).status,
    ).toBe(404);
  });

  it('purges pages older than the retention period (scheduled job)', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const old = await newPage(h, owner, ws, { title: 'Old' });
    const recent = await newPage(h, owner, ws, { title: 'Recent' });
    await h.call('DELETE', `/api/v1/pages/${old.id}`, { token: owner.token });
    await h.call('DELETE', `/api/v1/pages/${recent.id}`, { token: owner.token });
    const day = 24 * 60 * 60 * 1000;
    await h.deps.prisma.page.update({
      where: { id: old.id },
      data: { deletedAt: new Date(h.clock.now.getTime() - (PAGE_RETENTION_DAYS + 1) * day) },
    });
    expect(await purgeExpiredPages(h.deps.prisma, h.clock.now)).toBeGreaterThanOrEqual(1);
    expect(await h.deps.prisma.page.count({ where: { id: old.id } })).toBe(0);
    expect(await h.deps.prisma.page.count({ where: { id: recent.id } })).toBe(1);
  });
});

describe('page authentication and role checks', () => {
  it('requires a session on every page endpoint', async () => {
    const id = '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11';
    for (const [method, url] of [
      ['GET', `/api/v1/workspaces/${id}/pages`],
      ['POST', `/api/v1/workspaces/${id}/pages`],
      ['GET', `/api/v1/pages/${id}`],
      ['PATCH', `/api/v1/pages/${id}`],
      ['POST', `/api/v1/pages/${id}/move`],
      ['DELETE', `/api/v1/pages/${id}`],
      ['POST', `/api/v1/pages/${id}/restore`],
      ['POST', `/api/v1/pages/${id}/purge`],
      ['GET', `/api/v1/workspaces/${id}/trash`],
    ] as const) {
      expect((await h.call(method, url)).status).toBe(401);
    }
  });

  it('lets only editors and above create, rename, move and delete', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const viewer = await addMember(h, ws, owner, 'VIEWER');
    const commenter = await addMember(h, ws, owner, 'COMMENTER');
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const page = await newPage(h, owner, ws, { title: 'P' });

    for (const user of [viewer, commenter]) {
      expect(
        (await h.call('POST', `/api/v1/workspaces/${ws}/pages`, { token: user.token, body: {} }))
          .status,
      ).toBe(403);
      expect(
        (
          await h.call('PATCH', `/api/v1/pages/${page.id}`, {
            token: user.token,
            body: { title: 'x' },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await h.call('POST', `/api/v1/pages/${page.id}/move`, {
            token: user.token,
            body: { parentId: null },
          })
        ).status,
      ).toBe(403);
      expect(
        (await h.call('DELETE', `/api/v1/pages/${page.id}`, { token: user.token })).status,
      ).toBe(403);
      expect((await h.call('GET', `/api/v1/pages/${page.id}`, { token: user.token })).status).toBe(
        200,
      );
      expect(
        (await h.call('GET', `/api/v1/workspaces/${ws}/trash`, { token: user.token })).status,
      ).toBe(403);
    }
    expect(
      (
        await h.call('PATCH', `/api/v1/pages/${page.id}`, {
          token: editor.token,
          body: { title: 'ok' },
        })
      ).status,
    ).toBe(200);
    expect(
      (await h.call('POST', `/api/v1/workspaces/${ws}/pages`, { token: editor.token, body: {} }))
        .status,
    ).toBe(201);
  });
});
