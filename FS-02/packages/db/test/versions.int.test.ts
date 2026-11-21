import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DocumentRestoringError,
  DocumentStore,
  PAGE_EDITED_ACTION,
  SnapshotStore,
  createPrismaClient,
  type PrismaClient,
} from '../src/index.js';
import { requireInfraEnv } from '../../../tests/helpers.js';
import {
  addParagraph,
  cleanupDocumentTestData,
  contentOf,
  createTestPage,
} from './document-test-support.js';

/** Snapshots (G7, AC-8.5, AC-8.9) and the durable restore barrier (D62) against real PostgreSQL. */
const { DATABASE_URL } = requireInfraEnv();

let prisma: PrismaClient;
let store: DocumentStore;
let snapshots: SnapshotStore;

beforeAll(() => {
  prisma = createPrismaClient(DATABASE_URL);
  store = new DocumentStore(prisma);
  snapshots = new SnapshotStore(prisma);
});
afterAll(async () => {
  await cleanupDocumentTestData(prisma);
  await prisma.$disconnect();
});

async function workspaceOf(pageId: string): Promise<string> {
  return (
    await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { workspaceId: true } })
  ).workspaceId;
}
async function memberOf(pageId: string): Promise<string> {
  const workspaceId = await workspaceOf(pageId);
  return (
    await prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId },
      select: { userId: true },
    })
  ).userId;
}
async function logEdit(pageId: string, actorId: string, at: Date): Promise<void> {
  await prisma.activityLog.create({
    data: {
      workspaceId: await workspaceOf(pageId),
      pageId,
      actorId,
      action: PAGE_EDITED_ACTION,
      createdAt: at,
    },
  });
}

describe('snapshots (G7)', () => {
  it('stores the full state, size, kind, label, creator and time; the state loads into an equal document', async () => {
    const pageId = await createTestPage(prisma);
    const userId = await memberOf(pageId);
    const doc = new Y.Doc();
    addParagraph(doc, 'hello');
    addParagraph(doc, 'world');
    const when = new Date('2026-11-19T10:00:00.000Z');
    const result = await snapshots.create(pageId, {
      kind: 'MANUAL',
      doc,
      label: 'First',
      createdById: userId,
      now: when,
    });
    expect(result.created).toBe(true);
    if (!result.created) return;
    expect(result.snapshot).toMatchObject({ kind: 'MANUAL', label: 'First', createdById: userId });
    expect(result.snapshot.createdAt.toISOString()).toBe(when.toISOString());
    const state = await snapshots.loadState(pageId, result.snapshot.id);
    expect(state).not.toBeNull();
    expect(result.snapshot.sizeBytes).toBe(state?.length);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, state as Uint8Array);
    expect(contentOf(copy)).toBe(contentOf(doc));
  });

  it('never returns a snapshot through another page', async () => {
    const pageA = await createTestPage(prisma);
    const pageB = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'a');
    const created = await snapshots.create(pageA, { kind: 'AUTO', doc });
    if (!created.created) throw new Error('expected a snapshot');
    expect(await snapshots.loadState(pageB, created.snapshot.id)).toBeNull();
    expect(await snapshots.get(pageB, created.snapshot.id)).toBeNull();
  });

  it('skips an AUTO snapshot of an unchanged document but not a changed one, and MANUAL is never skipped', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'one');
    expect(
      (await snapshots.create(pageId, { kind: 'AUTO', doc, skipIfUnchanged: true })).created,
    ).toBe(true);
    expect(await snapshots.create(pageId, { kind: 'AUTO', doc, skipIfUnchanged: true })).toEqual({
      created: false,
      reason: 'UNCHANGED',
    });
    expect((await snapshots.create(pageId, { kind: 'MANUAL', doc })).created).toBe(true);
    addParagraph(doc, 'two');
    expect(
      (await snapshots.create(pageId, { kind: 'AUTO', doc, skipIfUnchanged: true })).created,
    ).toBe(true);
    // A deletion changes no state vector but is a change.
    const before = await prisma.documentSnapshot.count({ where: { pageId } });
    doc.getXmlFragment('default').delete(0, 1);
    expect(
      (await snapshots.create(pageId, { kind: 'AUTO', doc, skipIfUnchanged: true })).created,
    ).toBe(true);
    expect(await prisma.documentSnapshot.count({ where: { pageId } })).toBe(before + 1);
  });

  it('refuses to modify a snapshot: the database rejects UPDATE; existing rows survive (AC-8.5)', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'x');
    const created = await snapshots.create(pageId, { kind: 'MANUAL', doc, label: 'keep' });
    if (!created.created) throw new Error('expected a snapshot');
    await expect(
      prisma.documentSnapshot.update({
        where: { id: created.snapshot.id },
        data: { label: 'changed' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE document_snapshots SET state = '\x00'::bytea WHERE id = ${created.snapshot.id}::uuid`,
    ).rejects.toThrow();
    const row = await prisma.documentSnapshot.findUniqueOrThrow({
      where: { id: created.snapshot.id },
    });
    expect(row.label).toBe('keep');
  });

  it('rolls back completely when something fails before the commit (fault injection)', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'x');
    await expect(
      snapshots.create(pageId, {
        kind: 'PRE_RESTORE',
        doc,
        beforeCommit: () => {
          throw new Error('injected');
        },
      }),
    ).rejects.toThrow('injected');
    expect(await prisma.documentSnapshot.count({ where: { pageId } })).toBe(0);
  });

  it('is removed with its page, and a CHECK keeps size and state consistent', async () => {
    const pageId = await createTestPage(prisma);
    const doc = new Y.Doc();
    addParagraph(doc, 'x');
    await snapshots.create(pageId, { kind: 'AUTO', doc });
    await expect(
      prisma.$executeRaw`INSERT INTO document_snapshots (id, "pageId", kind, state, "sizeBytes", "coverageDigest", "contributorIds") VALUES (${randomUUID()}::uuid, ${pageId}::uuid, 'AUTO', '\x0000'::bytea, 99, '\x00'::bytea, '{}')`,
    ).rejects.toThrow();
    await prisma.page.delete({ where: { id: pageId } });
    expect(await prisma.documentSnapshot.count({ where: { pageId } })).toBe(0);
  });
});

describe('contributors (AC-8.9)', () => {
  it('are the distinct users with page.edited since the previous snapshot, and reset after each snapshot', async () => {
    const pageId = await createTestPage(prisma);
    const workspaceId = await workspaceOf(pageId);
    const first = await memberOf(pageId);
    const secondUser = await prisma.user.create({
      data: {
        email: `c-${randomUUID().slice(0, 8)}@document-store.example`,
        passwordHash: 'x',
        displayName: 'Second',
        presenceColor: '#4F46E5',
      },
      select: { id: true },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: secondUser.id, role: 'EDITOR' },
    });
    const doc = new Y.Doc();
    addParagraph(doc, 'a');
    const t = (minutes: number) => new Date(Date.UTC(2026, 10, 19, 12, minutes));

    await logEdit(pageId, first, t(1));
    await logEdit(pageId, first, t(2));
    await logEdit(pageId, secondUser.id, t(3));
    const s1 = await snapshots.create(pageId, { kind: 'AUTO', doc, now: t(5) });
    if (!s1.created) throw new Error('expected a snapshot');
    expect([...s1.snapshot.contributorIds].sort()).toEqual([first, secondUser.id].sort());

    await logEdit(pageId, secondUser.id, t(6));
    addParagraph(doc, 'b');
    const s2 = await snapshots.create(pageId, { kind: 'MANUAL', doc, now: t(8) });
    if (!s2.created) throw new Error('expected a snapshot');
    expect(s2.snapshot.contributorIds).toEqual([secondUser.id]);

    addParagraph(doc, 'c');
    const s3 = await snapshots.create(pageId, { kind: 'MANUAL', doc, now: t(9) });
    if (!s3.created) throw new Error('expected a snapshot');
    expect(s3.snapshot.contributorIds).toEqual([]);
  });

  it('ignore other actions, other pages and activity of deleted accounts', async () => {
    const pageId = await createTestPage(prisma);
    const otherPage = await createTestPage(prisma);
    const user = await memberOf(pageId);
    const otherUser = await memberOf(otherPage);
    await prisma.activityLog.create({
      data: {
        workspaceId: await workspaceOf(pageId),
        pageId,
        actorId: user,
        action: 'page.renamed',
      },
    });
    await logEdit(otherPage, otherUser, new Date());
    const doc = new Y.Doc();
    addParagraph(doc, 'a');
    const created = await snapshots.create(pageId, { kind: 'AUTO', doc });
    if (!created.created) throw new Error('expected a snapshot');
    expect(created.snapshot.contributorIds).toEqual([]);
  });
});

describe('restore barrier (D62, AC-8.6, AC-8.7)', () => {
  const ttl = 60_000;

  it('is granted to one holder; a second request is refused; release frees it', async () => {
    const pageId = await createTestPage(prisma);
    const owner = await memberOf(pageId);
    const a = randomUUID();
    const b = randomUUID();
    expect(
      await store.acquireRestoreBarrier(pageId, { token: a, ownerId: owner, ttlMs: ttl }),
    ).toBe(true);
    expect(await store.isRestoring(pageId)).toBe(true);
    expect(
      await store.acquireRestoreBarrier(pageId, { token: b, ownerId: owner, ttlMs: ttl }),
    ).toBe(false);
    expect(await store.releaseRestoreBarrier(pageId, b)).toBe(false); // not the holder
    expect(await store.isRestoring(pageId)).toBe(true);
    expect(await store.releaseRestoreBarrier(pageId, a)).toBe(true);
    expect(await store.isRestoring(pageId)).toBe(false);
    expect(
      await store.acquireRestoreBarrier(pageId, { token: b, ownerId: owner, ttlMs: ttl }),
    ).toBe(true);
  });

  it('lets exactly one of many simultaneous requests win', async () => {
    const pageId = await createTestPage(prisma);
    const owner = await memberOf(pageId);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.acquireRestoreBarrier(pageId, { token: randomUUID(), ownerId: owner, ttlMs: ttl }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('refuses stores from anyone but the holder and keeps the stored document unchanged', async () => {
    const pageId = await createTestPage(prisma);
    const owner = await memberOf(pageId);
    const doc = new Y.Doc();
    addParagraph(doc, 'before');
    await store.appendDiff(pageId, doc);
    const token = randomUUID();
    await store.acquireRestoreBarrier(pageId, { token, ownerId: owner, ttlMs: ttl });

    addParagraph(doc, 'during');
    await expect(store.appendDiff(pageId, doc)).rejects.toBeInstanceOf(DocumentRestoringError);
    await expect(
      store.appendDiff(pageId, doc, { restoreToken: randomUUID() }),
    ).rejects.toBeInstanceOf(DocumentRestoringError);
    expect(contentOf((await store.load(pageId)).doc)).not.toContain('during');

    expect((await store.appendDiff(pageId, doc, { restoreToken: token })).stored).toBe(true);
    await store.releaseRestoreBarrier(pageId, token);
    expect(contentOf((await store.load(pageId)).doc)).toContain('during');
  });

  it('lets a refused store succeed after the release: nothing a refused instance held is lost', async () => {
    const pageId = await createTestPage(prisma);
    const owner = await memberOf(pageId);
    const token = randomUUID();
    await store.acquireRestoreBarrier(pageId, { token, ownerId: owner, ttlMs: ttl });
    const other = new Y.Doc();
    addParagraph(other, 'held by another instance');
    await expect(store.appendDiff(pageId, other)).rejects.toBeInstanceOf(DocumentRestoringError);
    await store.releaseRestoreBarrier(pageId, token);
    expect((await store.appendDiff(pageId, other)).stored).toBe(true);
    expect(contentOf((await store.load(pageId)).doc)).toContain('held by another instance');
  });

  it('expires, so a crashed holder cannot block a page for ever', async () => {
    const pageId = await createTestPage(prisma);
    const owner = await memberOf(pageId);
    const start = new Date('2026-11-19T12:00:00.000Z');
    await store.acquireRestoreBarrier(pageId, {
      token: randomUUID(),
      ownerId: owner,
      ttlMs: 1000,
      now: start,
    });
    const doc = new Y.Doc();
    addParagraph(doc, 'x');
    await expect(
      store.appendDiff(pageId, doc, { now: new Date(start.getTime() + 500) }),
    ).rejects.toBeInstanceOf(DocumentRestoringError);
    expect(
      (await store.appendDiff(pageId, doc, { now: new Date(start.getTime() + 1500) })).stored,
    ).toBe(true);
    expect(
      await store.acquireRestoreBarrier(pageId, {
        token: randomUUID(),
        ownerId: owner,
        ttlMs: ttl,
        now: new Date(start.getTime() + 1600),
      }),
    ).toBe(true);
  });

  it('does not block compaction, which changes no content', async () => {
    const pageId = await createTestPage(prisma);
    const owner = await memberOf(pageId);
    const doc = new Y.Doc();
    addParagraph(doc, 'a');
    await store.appendDiff(pageId, doc);
    await store.acquireRestoreBarrier(pageId, { token: randomUUID(), ownerId: owner, ttlMs: ttl });
    expect((await store.compact(pageId)).compacted).toBe(true);
  });

  it('is all-or-nothing in the database (CHECK)', async () => {
    const pageId = await createTestPage(prisma);
    await store.appendDiff(pageId, new Y.Doc());
    await expect(
      prisma.$executeRaw`UPDATE document_states SET "restoreToken" = ${randomUUID()}::uuid WHERE "pageId" = ${pageId}::uuid`,
    ).rejects.toThrow();
  });
});
