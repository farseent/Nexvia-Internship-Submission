import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAGE_EVENTS_CHANNEL, type PageEvent } from '@conote/shared';
import { Redis } from 'ioredis';
import { createHarness, deleteTestUsers, type Body, type Harness } from './auth-harness.js';
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

const anchor = {
  start: Buffer.from([1, 2, 3, 4, 5]).toString('base64'),
  end: Buffer.from([6, 7, 8, 9]).toString('base64'),
};

interface Setup {
  owner: TestUser;
  ws: string;
  pageId: string;
  viewer: TestUser;
  commenter: TestUser;
  editor: TestUser;
  admin: TestUser;
}

async function setup(): Promise<Setup> {
  const owner = await newUser(h, 'owner');
  const ws = await newWorkspace(h, owner);
  const page: Body = await newPage(h, owner, ws, { title: 'Doc' });
  return {
    owner,
    ws,
    pageId: page.id as string,
    viewer: await addMember(h, ws, owner, 'VIEWER'),
    commenter: await addMember(h, ws, owner, 'COMMENTER'),
    editor: await addMember(h, ws, owner, 'EDITOR'),
    admin: await addMember(h, ws, owner, 'ADMIN'),
  };
}

const createThread = (user: TestUser, pageId: string, body = 'First comment') =>
  h.call('POST', `/api/v1/pages/${pageId}/threads`, {
    token: user.token,
    body: { anchor, quotedText: 'quoted words', body },
  });

describe('CMT-02 create thread and CMT-01 list (AC-8.2)', () => {
  it('lets Commenter, Editor and Admin create threads; the thread carries its first comment and the anchor opaquely', async () => {
    const s = await setup();
    for (const user of [s.commenter, s.editor, s.admin, s.owner]) {
      const res = await createThread(user, s.pageId);
      expect(res.status).toBe(201);
      const thread = res.body.data.thread;
      expect(thread.anchor).toEqual(anchor);
      expect(thread.quotedText).toBe('quoted words');
      expect(thread.anchorStatus).toBe('ACTIVE');
      expect(thread.resolvedAt).toBeNull();
      expect(thread.comments).toHaveLength(1);
      expect(thread.comments[0].body).toBe('First comment');
      expect(thread.comments[0].author.id).toBe(user.id);
    }
  });

  it('refuses a Viewer with 403 and a non-member with 404 (same as a missing page)', async () => {
    const s = await setup();
    expect((await createThread(s.viewer, s.pageId)).status).toBe(403);
    const stranger = await newUser(h, 'stranger');
    const real = await createThread(stranger, s.pageId);
    const missing = await createThread(stranger, '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11');
    expect(real.status).toBe(404);
    expect(errorCode(real)).toBe(errorCode(missing));
    expect(await h.deps.prisma.commentThread.count({ where: { pageId: s.pageId } })).toBe(0);
  });

  it('lets a Viewer read threads but not a stranger', async () => {
    const s = await setup();
    await createThread(s.commenter, s.pageId);
    const read = await h.call('GET', `/api/v1/pages/${s.pageId}/threads`, {
      token: s.viewer.token,
    });
    expect(read.status).toBe(200);
    expect(read.body.data.threads).toHaveLength(1);
    const stranger = await newUser(h, 'stranger');
    expect(
      (await h.call('GET', `/api/v1/pages/${s.pageId}/threads`, { token: stranger.token })).status,
    ).toBe(404);
  });

  it('validates the body: empty or oversized comments, bad anchors and unknown fields are 400', async () => {
    const s = await setup();
    const post = (body: unknown) =>
      h.call('POST', `/api/v1/pages/${s.pageId}/threads`, { token: s.commenter.token, body });
    expect((await post({ anchor, quotedText: 'q', body: '   ' })).status).toBe(400);
    expect((await post({ anchor, quotedText: 'q', body: 'x'.repeat(5001) })).status).toBe(400);
    expect(
      (await post({ anchor: { start: '!!!', end: anchor.end }, quotedText: 'q', body: 'b' }))
        .status,
    ).toBe(400);
    const huge = Buffer.alloc(513, 1).toString('base64');
    expect(
      (await post({ anchor: { start: huge, end: anchor.end }, quotedText: 'q', body: 'b' })).status,
    ).toBe(400);
    expect((await post({ anchor, quotedText: 'q'.repeat(501), body: 'b' })).status).toBe(400);
    expect((await post({ anchor, quotedText: 'q', body: 'b', extra: 1 })).status).toBe(400);
    expect((await post({ anchor, quotedText: 'q', body: 'x'.repeat(5000) })).status).toBe(201);
  });

  it('filters by status and returns newest first with working pagination', async () => {
    const s = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      h.clock.advance(1000); // threads are ordered by creation time
      ids.push((await createThread(s.commenter, s.pageId, `c${i}`)).body.data.thread.id as string);
    }
    await h.call('POST', `/api/v1/threads/${ids[0]}/resolve`, { token: s.commenter.token });
    const list = (q: string) =>
      h.call('GET', `/api/v1/pages/${s.pageId}/threads${q}`, { token: s.viewer.token });
    expect((await list('')).body.data.threads.map((t: Body) => t.id)).toEqual([ids[2], ids[1]]);
    expect((await list('?status=resolved')).body.data.threads.map((t: Body) => t.id)).toEqual([
      ids[0],
    ]);
    expect((await list('?status=all')).body.data.threads).toHaveLength(3);
    const first = await list('?status=all&limit=2');
    expect(first.body.data.threads).toHaveLength(2);
    const next = await list(`?status=all&limit=2&cursor=${first.body.meta.nextCursor}`);
    expect(next.body.data.threads.map((t: Body) => t.id)).toEqual([ids[0]]);
    expect(next.body.meta.nextCursor).toBeNull();
  });
});

describe('CMT-03 replies', () => {
  it('lets Commenters reply, in order, and refuses Viewers', async () => {
    const s = await setup();
    const threadId = (await createThread(s.commenter, s.pageId)).body.data.thread.id as string;
    h.clock.advance(1000); // comments are ordered by creation time
    const reply = await h.call('POST', `/api/v1/threads/${threadId}/comments`, {
      token: s.editor.token,
      body: { body: 'A reply' },
    });
    expect(reply.status).toBe(201);
    expect(reply.body.data.comment.author.id).toBe(s.editor.id);
    expect(
      (
        await h.call('POST', `/api/v1/threads/${threadId}/comments`, {
          token: s.viewer.token,
          body: { body: 'no' },
        })
      ).status,
    ).toBe(403);
    const list = await h.call('GET', `/api/v1/pages/${s.pageId}/threads`, {
      token: s.viewer.token,
    });
    expect(list.body.data.threads[0].comments.map((c: Body) => c.body)).toEqual([
      'First comment',
      'A reply',
    ]);
  });

  it('answers 404 for a thread the caller cannot see and for an unknown thread', async () => {
    const s = await setup();
    const threadId = (await createThread(s.commenter, s.pageId)).body.data.thread.id as string;
    const stranger = await newUser(h, 'stranger');
    const real = await h.call('POST', `/api/v1/threads/${threadId}/comments`, {
      token: stranger.token,
      body: { body: 'x' },
    });
    const missing = await h.call(
      'POST',
      '/api/v1/threads/6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11/comments',
      { token: stranger.token, body: { body: 'x' } },
    );
    expect(real.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(errorCode(real)).toBe(errorCode(missing));
  });

  it('follows a page permission override: a Commenter restricted to Viewer on one page can no longer reply there', async () => {
    const s = await setup();
    const threadId = (await createThread(s.owner, s.pageId)).body.data.thread.id as string;
    await h.call('PUT', `/api/v1/pages/${s.pageId}/permissions/${s.commenter.id}`, {
      token: s.owner.token,
      body: { role: 'VIEWER' },
    });
    expect(
      (
        await h.call('POST', `/api/v1/threads/${threadId}/comments`, {
          token: s.commenter.token,
          body: { body: 'x' },
        })
      ).status,
    ).toBe(403);
    await h.call('PUT', `/api/v1/pages/${s.pageId}/permissions/${s.viewer.id}`, {
      token: s.owner.token,
      body: { role: 'COMMENTER' },
    });
    expect(
      (
        await h.call('POST', `/api/v1/threads/${threadId}/comments`, {
          token: s.viewer.token,
          body: { body: 'x' },
        })
      ).status,
    ).toBe(201);
  });
});

describe('CMT-04 resolve and CMT-05 reopen (AC-8.2)', () => {
  it('resolves and reopens, idempotently, recording who and logging activity once per change', async () => {
    const s = await setup();
    const threadId = (await createThread(s.commenter, s.pageId)).body.data.thread.id as string;
    const resolve = () =>
      h.call('POST', `/api/v1/threads/${threadId}/resolve`, { token: s.editor.token });
    const first = await resolve();
    expect(first.status).toBe(200);
    expect(first.body.data.thread.resolvedAt).not.toBeNull();
    expect(first.body.data.thread.resolvedBy.id).toBe(s.editor.id);
    const again = await resolve();
    expect(again.body.data.thread.resolvedAt).toBe(first.body.data.thread.resolvedAt);
    const reopened = await h.call('POST', `/api/v1/threads/${threadId}/reopen`, {
      token: s.commenter.token,
    });
    expect(reopened.body.data.thread.resolvedAt).toBeNull();
    expect(reopened.body.data.thread.resolvedBy).toBeNull();
    await h.call('POST', `/api/v1/threads/${threadId}/reopen`, { token: s.commenter.token });
    const actions = (
      await h.deps.prisma.activityLog.findMany({
        where: { pageId: s.pageId },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions.filter((a) => a === 'comment.thread_created')).toHaveLength(1);
    expect(actions.filter((a) => a === 'comment.thread_resolved')).toHaveLength(1);
    expect(actions.filter((a) => a === 'comment.thread_reopened')).toHaveLength(1);
  });

  it('refuses Viewers (403) and strangers (404) and leaves the thread unchanged', async () => {
    const s = await setup();
    const threadId = (await createThread(s.commenter, s.pageId)).body.data.thread.id as string;
    expect(
      (await h.call('POST', `/api/v1/threads/${threadId}/resolve`, { token: s.viewer.token }))
        .status,
    ).toBe(403);
    const stranger = await newUser(h, 'stranger');
    expect(
      (await h.call('POST', `/api/v1/threads/${threadId}/resolve`, { token: stranger.token }))
        .status,
    ).toBe(404);
    await h.call('POST', `/api/v1/threads/${threadId}/resolve`, { token: s.commenter.token });
    expect(
      (await h.call('POST', `/api/v1/threads/${threadId}/reopen`, { token: s.viewer.token }))
        .status,
    ).toBe(403);
    const row = await h.deps.prisma.commentThread.findUniqueOrThrow({ where: { id: threadId } });
    expect(row.resolvedAt).not.toBeNull();
  });
});

describe('CMT-06 delete', () => {
  it('lets the author and an admin delete, not another commenter; deleted bodies disappear', async () => {
    const s = await setup();
    const created = await createThread(s.commenter, s.pageId, 'to delete');
    const threadId = created.body.data.thread.id as string;
    const reply = await h.call('POST', `/api/v1/threads/${threadId}/comments`, {
      token: s.editor.token,
      body: { body: 'keep me' },
    });
    const replyId = reply.body.data.comment.id as string;
    const rootId = created.body.data.thread.comments[0].id as string;

    expect(
      (await h.call('DELETE', `/api/v1/comments/${rootId}`, { token: s.editor.token })).status,
    ).toBe(403);
    expect(
      (await h.call('DELETE', `/api/v1/comments/${rootId}`, { token: s.viewer.token })).status,
    ).toBe(403);
    expect(
      (await h.call('DELETE', `/api/v1/comments/${rootId}`, { token: s.commenter.token })).status,
    ).toBe(200);
    expect(
      (await h.call('DELETE', `/api/v1/comments/${rootId}`, { token: s.commenter.token })).status,
    ).toBe(404);

    const list = await h.call('GET', `/api/v1/pages/${s.pageId}/threads`, {
      token: s.viewer.token,
    });
    expect(list.body.data.threads[0].comments.map((c: Body) => c.body)).toEqual(['keep me']);
    expect(
      (await h.call('DELETE', `/api/v1/comments/${replyId}`, { token: s.admin.token })).status,
    ).toBe(200);
    const gone = await h.call('GET', `/api/v1/pages/${s.pageId}/threads?status=all`, {
      token: s.viewer.token,
    });
    expect(gone.body.data.threads).toHaveLength(0);
    const row = await h.deps.prisma.comment.findUniqueOrThrow({ where: { id: rootId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(s.commenter.id);
  });

  it('refuses an author who lost the right to comment, and hides the comment from strangers', async () => {
    const s = await setup();
    const created = await createThread(s.commenter, s.pageId);
    const rootId = created.body.data.thread.comments[0].id as string;
    await h.call('PUT', `/api/v1/pages/${s.pageId}/permissions/${s.commenter.id}`, {
      token: s.owner.token,
      body: { role: 'VIEWER' },
    });
    expect(
      (await h.call('DELETE', `/api/v1/comments/${rootId}`, { token: s.commenter.token })).status,
    ).toBe(403);
    const stranger = await newUser(h, 'stranger');
    expect(
      (await h.call('DELETE', `/api/v1/comments/${rootId}`, { token: stranger.token })).status,
    ).toBe(404);
  });
});

describe('page events (AC-8.10) and soft-deleted pages', () => {
  it('publishes comments.changed after each committed change, and nothing for a refused one', async () => {
    const s = await setup();
    const subscriber = new Redis(requireInfraEnv().REDIS_URL);
    const events: PageEvent[] = [];
    subscriber.on('message', (_c: string, m: string) => events.push(JSON.parse(m) as PageEvent));
    await subscriber.subscribe(PAGE_EVENTS_CHANNEL);
    try {
      const wait = async (n: number) => {
        const deadline = Date.now() + 2000;
        while (events.length < n && Date.now() < deadline)
          await new Promise((r) => setTimeout(r, 20));
      };
      const threadId = (await createThread(s.commenter, s.pageId)).body.data.thread.id as string;
      await h.call('POST', `/api/v1/threads/${threadId}/comments`, {
        token: s.commenter.token,
        body: { body: 'r' },
      });
      await h.call('POST', `/api/v1/threads/${threadId}/resolve`, { token: s.commenter.token });
      await h.call('POST', `/api/v1/threads/${threadId}/resolve`, { token: s.commenter.token }); // no change
      await createThread(s.viewer, s.pageId); // refused
      await wait(3);
      await new Promise((r) => setTimeout(r, 150));
      expect(events).toHaveLength(3);
      expect(
        events.every((e) => e.type === 'comments.changed' && e.pageId === s.pageId && e.v === 1),
      ).toBe(true);
    } finally {
      subscriber.disconnect();
    }
  });

  it('answers 404 for threads of a page in the trash', async () => {
    const s = await setup();
    const threadId = (await createThread(s.commenter, s.pageId)).body.data.thread.id as string;
    await h.call('DELETE', `/api/v1/pages/${s.pageId}`, { token: s.owner.token });
    expect(
      (await h.call('GET', `/api/v1/pages/${s.pageId}/threads`, { token: s.owner.token })).status,
    ).toBe(404);
    expect(
      (await h.call('POST', `/api/v1/threads/${threadId}/resolve`, { token: s.owner.token }))
        .status,
    ).toBe(404);
  });

  it('requires authentication on every endpoint', async () => {
    const id = '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11';
    for (const [method, url] of [
      ['GET', `/api/v1/pages/${id}/threads`],
      ['POST', `/api/v1/pages/${id}/threads`],
      ['POST', `/api/v1/threads/${id}/comments`],
      ['POST', `/api/v1/threads/${id}/resolve`],
      ['POST', `/api/v1/threads/${id}/reopen`],
      ['DELETE', `/api/v1/comments/${id}`],
    ] as const) {
      expect((await h.call(method, url, { body: {} })).status).toBe(401);
    }
  });
});
