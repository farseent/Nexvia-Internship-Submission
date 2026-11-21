import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentReplica } from '@conote/shared';
import { createHarness, deleteTestUsers, type Body, type Harness } from './auth-harness.js';
import { addMember, newPage, newUser, newWorkspace, type TestUser } from './workspace-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

function stateOf(text: string): Uint8Array {
  const replica = new DocumentReplica();
  replica.doc.getText('t').insert(0, text);
  return replica.diffSince();
}

async function addSnapshot(
  pageId: string,
  kind: 'AUTO' | 'MANUAL' | 'PRE_RESTORE',
  text: string,
  extra: Partial<{
    label: string;
    createdById: string;
    contributorIds: string[];
    createdAt: Date;
  }> = {},
) {
  const state = stateOf(text);
  return h.deps.prisma.documentSnapshot.create({
    data: {
      pageId,
      kind,
      state: new Uint8Array(state),
      sizeBytes: state.length,
      coverageDigest: new Uint8Array(32),
      ...extra,
    },
  });
}

describe('VER-01 … VER-03 (AC-8.8)', () => {
  it('lists newest first with creator and contributors, filters by kind and paginates', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page: Body = await newPage(h, owner, ws, { title: 'V' });
    const viewer = await addMember(h, ws, owner, 'VIEWER');
    const t0 = Date.now();
    const a = await addSnapshot(page.id, 'AUTO', 'one', { createdAt: new Date(t0 - 3000) });
    const b = await addSnapshot(page.id, 'MANUAL', 'two', {
      label: 'Draft 2',
      createdById: owner.id,
      contributorIds: [owner.id, viewer.id],
      createdAt: new Date(t0 - 2000),
    });
    const c = await addSnapshot(page.id, 'PRE_RESTORE', 'three', {
      createdAt: new Date(t0 - 1000),
    });

    const list = await h.call('GET', `/api/v1/pages/${page.id}/versions`, { token: viewer.token });
    expect(list.status).toBe(200);
    expect(list.body.data.versions.map((v: Body) => v.id)).toEqual([c.id, b.id, a.id]);
    const manual = list.body.data.versions[1];
    expect(manual.label).toBe('Draft 2');
    expect(manual.kind).toBe('MANUAL');
    expect(manual.createdBy.id).toBe(owner.id);
    expect(manual.contributors.map((u: Body) => u.id).sort()).toEqual([owner.id, viewer.id].sort());
    expect(manual).not.toHaveProperty('state');
    expect(manual.sizeBytes).toBeGreaterThan(0);

    const onlyManual = await h.call('GET', `/api/v1/pages/${page.id}/versions?kind=MANUAL`, {
      token: viewer.token,
    });
    expect(onlyManual.body.data.versions.map((v: Body) => v.id)).toEqual([b.id]);
    const first = await h.call('GET', `/api/v1/pages/${page.id}/versions?limit=2`, {
      token: viewer.token,
    });
    const next = await h.call(
      'GET',
      `/api/v1/pages/${page.id}/versions?limit=2&cursor=${first.body.meta.nextCursor}`,
      { token: viewer.token },
    );
    expect(next.body.data.versions.map((v: Body) => v.id)).toEqual([a.id]);
  });

  it('returns the exact stored state as binary, loadable into a Y.Doc', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page: Body = await newPage(h, owner, ws);
    const viewer = await addMember(h, ws, owner, 'VIEWER');
    const snap = await addSnapshot(page.id, 'MANUAL', 'hello snapshot');
    const res = await h.call('GET', `/api/v1/pages/${page.id}/versions/${snap.id}/state`, {
      token: viewer.token,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.headers['cache-control']).toContain('no-store');
    const bytes = new Uint8Array(res.raw.rawPayload);
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(snap.state))).toBe(0);
    const replica = new DocumentReplica();
    replica.applyRemoteUpdate(bytes);
    expect(replica.doc.getText('t').toString()).toBe('hello snapshot');
    const detail = await h.call('GET', `/api/v1/pages/${page.id}/versions/${snap.id}`, {
      token: viewer.token,
    });
    expect(detail.body.data.version.id).toBe(snap.id);
  });

  it('hides versions from strangers (404), from other pages, and from trashed pages', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page: Body = await newPage(h, owner, ws);
    const other: Body = await newPage(h, owner, ws);
    const snap = await addSnapshot(page.id, 'AUTO', 'x');
    const stranger: TestUser = await newUser(h, 'stranger');
    for (const suffix of ['', `/${snap.id}`, `/${snap.id}/state`]) {
      expect(
        (
          await h.call('GET', `/api/v1/pages/${page.id}/versions${suffix}`, {
            token: stranger.token,
          })
        ).status,
      ).toBe(404);
    }
    // A version id used through another page's URL is not found.
    expect(
      (await h.call('GET', `/api/v1/pages/${other.id}/versions/${snap.id}`, { token: owner.token }))
        .status,
    ).toBe(404);
    expect(
      (
        await h.call('GET', `/api/v1/pages/${other.id}/versions/${snap.id}/state`, {
          token: owner.token,
        })
      ).status,
    ).toBe(404);
    await h.call('DELETE', `/api/v1/pages/${page.id}`, { token: owner.token });
    expect(
      (await h.call('GET', `/api/v1/pages/${page.id}/versions`, { token: owner.token })).status,
    ).toBe(404);
  });

  it('requires authentication', async () => {
    const id = '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11';
    expect((await h.call('GET', `/api/v1/pages/${id}/versions`)).status).toBe(401);
    expect((await h.call('GET', `/api/v1/pages/${id}/versions/${id}/state`)).status).toBe(401);
  });
});
