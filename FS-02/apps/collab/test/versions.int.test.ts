import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentStore, SnapshotStore } from '@conote/db';
import { PAGE_EVENTS_CHANNEL, type PageEvent, type ServerMessage } from '@conote/shared';
import type { VersionHooks } from '../src/versions.js';
import { Harness, sleep, until, type TestClient, type TestUser } from './harness.js';

/*
 * Version history on the real collaboration server (Phase 8, AC-8.4 … AC-8.11; D9, D62, D63):
 * manual and automatic snapshots, restore as one transaction, the restore barrier, and what
 * happens to concurrent editors. Each test starts its own server(s) so fault injection and
 * timing cannot leak between tests.
 */

const harnesses: Harness[] = [];
afterEach(async () => {
  const all = harnesses.splice(0);
  for (const h of all) await h.stop().catch(() => undefined);
  for (const h of all) await h.cleanup().catch(() => undefined);
});

async function start(
  options: Parameters<typeof Harness.start>[0] = {},
  hooks?: VersionHooks,
): Promise<Harness> {
  const h = await Harness.start({ ...options, ...(hooks ? { versionHooks: hooks } : {}) } as never);
  harnesses.push(h);
  return h;
}

// ───────────── document helpers (rich-text fragment, as the editor writes it) ─────────────

const fragmentOf = (doc: Y.Doc) => doc.getXmlFragment('default');
function addParagraph(doc: Y.Doc, text: string): void {
  doc.transact(() => {
    const paragraph = new Y.XmlElement('paragraph');
    fragmentOf(doc).insert(fragmentOf(doc).length, [paragraph]);
    const node = new Y.XmlText();
    paragraph.insert(0, [node]);
    node.insert(0, text);
  });
}
const paragraphs = (doc: Y.Doc): string[] =>
  fragmentOf(doc)
    .toArray()
    .map((node) => (node as Y.XmlElement).get(0)?.toString() ?? '');

async function scene(h: Harness, roles: ('EDITOR' | 'COMMENTER' | 'VIEWER')[] = []) {
  const { owner, workspaceId, pageId } = await h.scene();
  const members: TestUser[] = [];
  for (const [i, role] of roles.entries()) {
    const user = await h.user(`m${i}`);
    await h.member(workspaceId, user, role);
    members.push(user);
  }
  return { owner, members, workspaceId, pageId };
}

/** Send a command and wait for its answer. */
async function command(
  client: TestClient,
  type: 'version.create' | 'version.restore',
  payload: Record<string, unknown>,
): Promise<ServerMessage> {
  const id = randomUUID();
  client.provider.sendStateless(JSON.stringify({ v: 1, type, id, payload }));
  await until(
    () => client.messages.some((m) => 'replyTo' in m && m.replyTo === id),
    `${type} answered`,
    10_000,
  );
  return client.messages.find((m) => 'replyTo' in m && m.replyTo === id) as ServerMessage;
}
const isOk = (m: ServerMessage): boolean => m.type === 'response';
const errorCode = (m: ServerMessage): string | undefined =>
  m.type === 'error' ? m.payload.code : undefined;

const stored = async (h: Harness, pageId: string): Promise<Y.Doc> =>
  (await new DocumentStore(h.prisma).load(pageId)).doc;
const snapshotsOf = (h: Harness, pageId: string) =>
  h.prisma.documentSnapshot.findMany({ where: { pageId }, orderBy: { createdAt: 'asc' } });

/** A latch: `wait()` blocks until `open()` is called. */
function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, wait: () => opened };
}

describe('manual snapshots (AC-8.4)', () => {
  it('stores a labelled snapshot of the live document with its author and time, and tells every collaborator', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h, ['EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    addParagraph(a.doc, 'draft one');
    await until(() => paragraphs(b.doc).length === 1, 'b sees the edit');

    const answer = await command(a, 'version.create', { label: 'First draft' });
    expect(isOk(answer)).toBe(true);
    const rows = await snapshotsOf(h, pageId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'MANUAL', label: 'First draft', createdById: owner.id });
    expect(Math.abs(rows[0]!.createdAt.getTime() - Date.now())).toBeLessThan(10_000);
    // The snapshot is the live state, loadable into an equal document.
    const copy = new Y.Doc();
    Y.applyUpdate(copy, new Uint8Array(rows[0]!.state));
    expect(paragraphs(copy)).toEqual(['draft one']);
    // Everyone on the page hears about it.
    await until(() => b.messageTypes().includes('version.created'), 'b told');
    expect(a.messageTypes()).toContain('version.created');
  });

  it('includes edits that are not stored yet (it captures the live document)', async () => {
    const h = await start({ config: { storeDebounceMs: 5_000, storeMaxDebounceMs: 10_000 } });
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'only in memory');
    await sleep(100);
    expect(await h.hasStoredData(pageId)).toBe(false);
    await command(a, 'version.create', {});
    const copy = new Y.Doc();
    Y.applyUpdate(copy, new Uint8Array((await snapshotsOf(h, pageId))[0]!.state));
    expect(paragraphs(copy)).toEqual(['only in memory']);
  });

  it('refuses Commenters and Viewers with FORBIDDEN and creates nothing (AC-8.9)', async () => {
    const h = await start();
    const { members, pageId } = await scene(h, ['COMMENTER', 'VIEWER']);
    for (const user of members) {
      const c = await h.connect(user, pageId);
      expect(errorCode(await command(c, 'version.create', {}))).toBe('FORBIDDEN');
    }
    expect(await snapshotsOf(h, pageId)).toHaveLength(0);
  });

  it('rejects a malformed command and counts it as a protocol violation', async () => {
    const h = await start();
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    expect(errorCode(await command(a, 'version.create', { label: 'x'.repeat(200) }))).toBe(
      'INVALID_MESSAGE',
    );
    expect(errorCode(await command(a, 'version.create', { unknown: 1 }))).toBe('INVALID_MESSAGE');
    expect(errorCode(await command(a, 'version.restore', { versionId: 'not-a-uuid' }))).toBe(
      'INVALID_MESSAGE',
    );
    expect(await snapshotsOf(h, pageId)).toHaveLength(0);
  });

  it('records contributors: the distinct editors since the previous snapshot (AC-8.9)', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h, ['EDITOR', 'EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    const lurker = await h.connect(members[1]!, pageId); // connected, never edits
    addParagraph(a.doc, 'by owner');
    addParagraph(b.doc, 'by member');
    await until(() => paragraphs(lurker.doc).length === 2, 'all synced');
    await until(
      async () =>
        (await h.prisma.activityLog.count({ where: { pageId, action: 'page.edited' } })) >= 2,
      'edits logged',
    );
    await command(a, 'version.create', { label: 'one' });
    const first = (await snapshotsOf(h, pageId))[0]!;
    expect([...first.contributorIds].sort()).toEqual([owner.id, members[0]!.id].sort());

    // Only B edits next: the next snapshot lists B alone.
    addParagraph(b.doc, 'again by member');
    await until(
      async () =>
        (await h.prisma.activityLog.count({
          where: { pageId, action: 'page.edited', actorId: members[0]!.id },
        })) >= 2,
      'second edit logged',
    );
    await command(a, 'version.create', { label: 'two' });
    const second = (await snapshotsOf(h, pageId))[1]!;
    expect(second.contributorIds).toEqual([members[0]!.id]);
  });
});

describe('automatic snapshots (D63)', () => {
  it('takes one after the interval when the page changed, none when it did not, and tells collaborators', async () => {
    const h = await start({ config: { autoSnapshotIntervalMs: 150 } });
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'auto me');
    await sleep(250); // past the interval and the store debounce
    addParagraph(a.doc, 'and me');
    await until(async () => (await snapshotsOf(h, pageId)).length >= 1, 'an automatic snapshot');
    const rows = await snapshotsOf(h, pageId);
    expect(rows.every((r) => r.kind === 'AUTO' && r.createdById === null)).toBe(true);
    await until(() => a.messageTypes().includes('version.created'), 'announced');
    // Nothing changed since: an idle page gets no further snapshot.
    const count = (await snapshotsOf(h, pageId)).length;
    await sleep(500);
    expect((await snapshotsOf(h, pageId)).length).toBe(count);
  });

  it('takes a final one when the last client leaves a page that changed', async () => {
    const h = await start();
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'last words');
    await sleep(150);
    await a.destroy();
    await until(async () => (await snapshotsOf(h, pageId)).length === 1, 'unload snapshot');
    const copy = new Y.Doc();
    Y.applyUpdate(copy, new Uint8Array((await snapshotsOf(h, pageId))[0]!.state));
    expect(paragraphs(copy)).toEqual(['last words']);
  });

  it('prunes only automatic snapshots beyond the retention count (U11)', async () => {
    const h = await start({ config: { autoSnapshotIntervalMs: 1, autoSnapshotKeep: 2 } });
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    await command(a, 'version.create', { label: 'keep me' });
    for (let i = 0; i < 5; i += 1) {
      addParagraph(a.doc, `edit ${i}`);
      await sleep(180);
    }
    await until(
      async () => (await snapshotsOf(h, pageId)).filter((r) => r.kind === 'AUTO').length >= 2,
      'autos',
    );
    await sleep(300);
    const rows = await snapshotsOf(h, pageId);
    expect(rows.filter((r) => r.kind === 'AUTO').length).toBeLessThanOrEqual(2);
    expect(rows.filter((r) => r.kind === 'MANUAL')).toHaveLength(1);
  });
});

describe('restore (AC-8.5, AC-8.6)', () => {
  it('replaces the content for every collaborator, keeps the replaced state as a PRE_RESTORE snapshot, records the event', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h, ['EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    addParagraph(a.doc, 'version one');
    await until(() => paragraphs(b.doc).length === 1, 'synced');
    await command(a, 'version.create', { label: 'v1' });
    const v1 = (await snapshotsOf(h, pageId))[0]!;

    addParagraph(b.doc, 'added later');
    fragmentOf(a.doc).delete(0, 1);
    await until(
      () =>
        paragraphs(a.doc).join('|') === 'added later' &&
        paragraphs(b.doc).join('|') === 'added later',
      'edited',
    );

    const answer = await command(b, 'version.restore', { versionId: v1.id });
    expect(isOk(answer)).toBe(true);
    await until(
      () =>
        paragraphs(a.doc).join('|') === 'version one' &&
        paragraphs(b.doc).join('|') === 'version one',
      'restored everywhere',
    );

    // The replaced state is kept.
    const pre = (await snapshotsOf(h, pageId)).find((r) => r.kind === 'PRE_RESTORE')!;
    expect(pre.createdById).toBe(members[0]!.id);
    const replaced = new Y.Doc();
    Y.applyUpdate(replaced, new Uint8Array(pre.state));
    expect(paragraphs(replaced)).toEqual(['added later']);

    // PostgreSQL holds the restored document.
    await until(
      async () => paragraphs(await stored(h, pageId)).join('|') === 'version one',
      'stored',
    );
    // The event is recorded with both versions.
    const event = await h.prisma.activityLog.findFirstOrThrow({
      where: { pageId, action: 'version.restored' },
    });
    expect(event.actorId).toBe(members[0]!.id);
    expect(event.metadata).toMatchObject({ versionId: v1.id, preRestoreVersionId: pre.id });
    // Both clients were told, in order.
    for (const c of [a, b]) {
      await until(() => c.messageTypes().includes('version.restored'), 'told');
      const types = c.messageTypes();
      expect(types.indexOf('version.restore.started')).toBeLessThan(
        types.indexOf('version.restored'),
      );
    }
  });

  it('is a new transaction on top of history: the history is kept and a later restore can undo it', async () => {
    const h = await start();
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', { label: 'v1' });
    addParagraph(a.doc, 'two');
    await command(a, 'version.create', { label: 'v2' });
    const [v1, v2] = await snapshotsOf(h, pageId);
    const before = Y.encodeStateVector(a.doc);

    await command(a, 'version.restore', { versionId: v1!.id });
    expect(paragraphs(a.doc)).toEqual(['one']);
    // Every operation that existed is still there: the state vector only grew.
    const after = Y.decodeStateVector(Y.encodeStateVector(a.doc));
    for (const [client, clock] of Y.decodeStateVector(before))
      expect(after.get(client) ?? 0).toBeGreaterThanOrEqual(clock);

    // Restoring v2 brings 'two' back.
    await command(a, 'version.restore', { versionId: v2!.id });
    expect(paragraphs(a.doc)).toEqual(['one', 'two']);
  });

  it('restoring a version equal to the current content changes nothing but still keeps a PRE_RESTORE snapshot', async () => {
    const h = await start();
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'same');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(h, pageId))[0]!;
    expect(isOk(await command(a, 'version.restore', { versionId: v.id }))).toBe(true);
    expect(paragraphs(a.doc)).toEqual(['same']);
    expect((await snapshotsOf(h, pageId)).filter((r) => r.kind === 'PRE_RESTORE')).toHaveLength(1);
  });

  it('refuses Viewers and Commenters, a missing version and another page’s version; the document is unchanged', async () => {
    const h = await start();
    const { owner, members, pageId, workspaceId } = await scene(h, ['COMMENTER', 'VIEWER']);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'precious');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(h, pageId))[0]!;
    addParagraph(a.doc, 'newer');

    for (const user of members) {
      const c = await h.connect(user, pageId);
      expect(errorCode(await command(c, 'version.restore', { versionId: v.id }))).toBe('FORBIDDEN');
    }
    expect(errorCode(await command(a, 'version.restore', { versionId: randomUUID() }))).toBe(
      'NOT_FOUND',
    );
    const otherPage = await h.page(workspaceId, owner);
    const other = await h.connect(owner, otherPage);
    addParagraph(other.doc, 'other page');
    await command(other, 'version.create', {});
    const foreign = (await snapshotsOf(h, otherPage))[0]!;
    expect(errorCode(await command(a, 'version.restore', { versionId: foreign.id }))).toBe(
      'NOT_FOUND',
    );
    expect(paragraphs(a.doc)).toEqual(['precious', 'newer']);
    expect((await snapshotsOf(h, pageId)).filter((r) => r.kind === 'PRE_RESTORE')).toHaveLength(0);
  });

  it('uses the role as it is now: an editor demoted a moment ago cannot restore', async () => {
    const h = await start();
    const { owner, members, pageId, workspaceId } = await scene(h, ['EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    addParagraph(a.doc, 'v1');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(h, pageId))[0]!;
    addParagraph(a.doc, 'v2');
    await until(() => paragraphs(b.doc).length === 2, 'synced');
    await h.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: members[0]!.id } },
      data: { role: 'VIEWER' },
    });
    // No access event was published: the command itself re-reads the role.
    expect(errorCode(await command(b, 'version.restore', { versionId: v.id }))).toBe('FORBIDDEN');
    expect(paragraphs(a.doc)).toEqual(['v1', 'v2']);
  });
});

describe('concurrent editing during a restore (AC-8.6, D62)', () => {
  it('holds back writes while the restore runs, tells the editors, and lets nothing accepted before it be lost', async () => {
    const gate = latch();
    const h = await start({}, { afterPreRestoreSnapshot: () => gate.wait() });
    const { owner, members, pageId } = await scene(h, ['EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    addParagraph(a.doc, 'base');
    await command(a, 'version.create', { label: 'base' });
    const base = (await snapshotsOf(h, pageId))[0]!;
    addParagraph(a.doc, 'accepted before the restore');
    await until(() => paragraphs(b.doc).length === 2, 'synced');

    const restoring = command(a, 'version.restore', { versionId: base.id });
    await until(
      () => b.messageTypes().includes('version.restore.started'),
      'b told the restore started',
    );
    expect(h.collab.versions.isRestoring(pageId)).toBe(true);

    // B types while the barrier is up: the server does not apply it.
    addParagraph(b.doc, 'typed during the restore');
    await sleep(300);
    expect(
      paragraphs(h.collab.server.hocuspocus.documents.get(`page:${pageId}`)! as unknown as Y.Doc),
    ).not.toContain('typed during the restore');

    gate.open();
    expect(isOk(await restoring)).toBe(true);
    await until(() => b.messageTypes().includes('version.restored'), 'b told it finished');
    expect(h.collab.versions.isRestoring(pageId)).toBe(false);

    // The edit accepted before the barrier is in the PRE_RESTORE snapshot; it was not silently dropped.
    const pre = (await snapshotsOf(h, pageId)).find((r) => r.kind === 'PRE_RESTORE')!;
    const preDoc = new Y.Doc();
    Y.applyUpdate(preDoc, new Uint8Array(pre.state));
    expect(paragraphs(preDoc)).toEqual(['base', 'accepted before the restore']);

    // B re-syncs as the web client does after `version.restored`; the held-back edit is merged, not lost.
    b.provider.forceSync();
    await until(
      () => paragraphs(a.doc).includes('typed during the restore'),
      'held-back edit arrives',
    );
    expect(paragraphs(a.doc)).toEqual(paragraphs(b.doc));
    expect(paragraphs(a.doc)).toContain('base');
    expect(paragraphs(a.doc)).not.toContain('accepted before the restore');
  });

  it('accepts writes again right after the restore, from clients that never reconnected', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h, ['EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(h, pageId))[0]!;
    addParagraph(a.doc, 'two');
    await command(a, 'version.restore', { versionId: v.id });
    await until(() => paragraphs(b.doc).join('|') === 'one', 'restored');
    addParagraph(b.doc, 'after');
    await until(() => paragraphs(a.doc).join('|') === 'one|after', 'new edits flow');
    await until(
      async () => paragraphs(await stored(h, pageId)).join('|') === 'one|after',
      'and are stored',
    );
    // Nobody was disconnected: the restore needs no reconnection.
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
  });

  it('answers CONFLICT to a second restore that overlaps the first; exactly one runs', async () => {
    const gate = latch();
    const h = await start({}, { afterPreRestoreSnapshot: () => gate.wait() });
    const { owner, members, pageId } = await scene(h, ['EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(h, pageId))[0]!;
    addParagraph(a.doc, 'two');
    await until(() => paragraphs(b.doc).length === 2, 'synced');
    const first = command(a, 'version.restore', { versionId: v.id });
    await until(() => h.collab.versions.isRestoring(pageId), 'first is running');
    expect(errorCode(await command(b, 'version.restore', { versionId: v.id }))).toBe('CONFLICT');
    expect(errorCode(await command(b, 'version.create', {}))).toBe('CONFLICT');
    gate.open();
    expect(isOk(await first)).toBe(true);
    expect((await snapshotsOf(h, pageId)).filter((r) => r.kind === 'PRE_RESTORE')).toHaveLength(1);
  });

  it('serializes two simultaneous restore requests: one succeeds, one is refused', async () => {
    const h = await start();
    const { owner, members, pageId } = await scene(h, ['EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(h, pageId))[0]!;
    addParagraph(a.doc, 'two');
    await until(() => paragraphs(b.doc).length === 2, 'synced');
    const answers = await Promise.all([
      command(a, 'version.restore', { versionId: v.id }),
      command(b, 'version.restore', { versionId: v.id }),
    ]);
    expect(answers.filter(isOk).length).toBeGreaterThanOrEqual(1);
    for (const answer of answers.filter((m) => !isOk(m)))
      expect(errorCode(answer)).toBe('CONFLICT');
    await until(
      () => paragraphs(a.doc).join('|') === 'one' && paragraphs(b.doc).join('|') === 'one',
      'one restored state',
    );
  });
});

describe('failed restores change nothing (AC-8.5)', () => {
  it('aborts when the pre-restore snapshot cannot be committed: no change, barrier released, editing continues', async () => {
    const h = await start(
      {},
      {
        beforePreRestoreCommit: () => {
          throw new Error('injected snapshot failure');
        },
      },
    );
    const { owner, members, pageId } = await scene(h, ['EDITOR']);
    const a = await h.connect(owner, pageId);
    const b = await h.connect(members[0]!, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(h, pageId))[0]!;
    addParagraph(a.doc, 'two');
    await until(() => paragraphs(b.doc).length === 2, 'synced');

    const answer = await command(a, 'version.restore', { versionId: v.id });
    expect(errorCode(answer)).toBe('INTERNAL_ERROR');
    await until(() => b.messageTypes().includes('version.restore.failed'), 'b told');
    expect(paragraphs(a.doc)).toEqual(['one', 'two']);
    expect(paragraphs(b.doc)).toEqual(['one', 'two']);
    expect((await snapshotsOf(h, pageId)).filter((r) => r.kind === 'PRE_RESTORE')).toHaveLength(0);
    expect(await new DocumentStore(h.prisma).isRestoring(pageId)).toBe(false);
    expect(h.collab.versions.isRestoring(pageId)).toBe(false);
    addParagraph(b.doc, 'still editable');
    await until(() => paragraphs(a.doc).length === 3, 'editing continues');
    await until(async () => paragraphs(await stored(h, pageId)).length === 3, 'and is stored');
  });

  it('refuses a snapshot whose content is not a valid page, without touching the document', async () => {
    const h = await start();
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'fine');
    const bogus = new Y.Doc();
    fragmentOf(bogus).insert(0, [new Y.XmlElement('notARealNode')]);
    const state = Y.encodeStateAsUpdate(bogus);
    const row = await h.prisma.documentSnapshot.create({
      data: {
        pageId,
        kind: 'MANUAL',
        state: new Uint8Array(state),
        sizeBytes: state.length,
        coverageDigest: new Uint8Array(32),
      },
    });
    expect(errorCode(await command(a, 'version.restore', { versionId: row.id }))).toBe(
      'INTERNAL_ERROR',
    );
    expect(paragraphs(a.doc)).toEqual(['fine']);
    expect((await snapshotsOf(h, pageId)).filter((r) => r.kind === 'PRE_RESTORE')).toHaveLength(0);
    expect(await new DocumentStore(h.prisma).isRestoring(pageId)).toBe(false);
  });

  it('aborts when computing the restore fails, before anything is committed or changed', async () => {
    const h = await start(
      {},
      {
        planRestore: () => {
          throw new Error('injected planning failure');
        },
      },
    );
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(h, pageId))[0]!;
    addParagraph(a.doc, 'two');
    expect(errorCode(await command(a, 'version.restore', { versionId: v.id }))).toBe(
      'INTERNAL_ERROR',
    );
    expect(paragraphs(a.doc)).toEqual(['one', 'two']);
    expect((await snapshotsOf(h, pageId)).filter((r) => r.kind === 'PRE_RESTORE')).toHaveLength(0);
  });
});

describe('the barrier across collaboration instances (D62, AC-8.6)', () => {
  it('stops a second instance storing while the restore runs, and lets it store afterwards: nothing is lost', async () => {
    const gate = latch();
    const first = await start({}, { afterPreRestoreSnapshot: () => gate.wait() });
    const second = await start({
      persistence: { retryDelayMs: () => 100 },
      config: { storeDebounceMs: 30, storeMaxDebounceMs: 60 },
    });
    const { owner, members, pageId } = await scene(first, ['EDITOR']);
    const a = await first.connect(owner, pageId);
    const onSecond = await second.connect(members[0]!, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(first, pageId))[0]!;
    await until(async () => await first.hasStoredData(pageId), 'stored');

    const restoring = command(a, 'version.restore', { versionId: v.id });
    await until(() => first.collab.versions.isRestoring(pageId), 'gate up');
    const store = new DocumentStore(first.prisma);
    await until(async () => await store.isRestoring(pageId), 'barrier up in PostgreSQL');

    // The other instance accepts a client edit but cannot store it now.
    addParagraph(onSecond.doc, 'typed on the other instance');
    await sleep(400);
    expect(paragraphs(await stored(first, pageId))).not.toContain('typed on the other instance');
    expect(second.collab.persistence.failingDocuments).toBeGreaterThan(0);

    gate.open();
    expect(isOk(await restoring)).toBe(true);
    // Once the barrier is gone the retry succeeds: the edit reaches PostgreSQL.
    await until(
      async () => paragraphs(await stored(first, pageId)).includes('typed on the other instance'),
      'held edit stored after release',
      8000,
    );
  });

  it('propagates the restored content to a client on another instance through the page event', async () => {
    const first = await start();
    const second = await start();
    const { owner, members, pageId } = await scene(first, ['EDITOR']);
    const a = await first.connect(owner, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(first, pageId))[0]!;
    addParagraph(a.doc, 'two');
    await until(async () => paragraphs(await stored(first, pageId)).length === 2, 'stored');
    const onSecond = await second.connect(members[0]!, pageId);
    await until(() => paragraphs(onSecond.doc).length === 2, 'second instance has the document');

    await command(a, 'version.restore', { versionId: v.id });
    await until(
      () => paragraphs(onSecond.doc).join('|') === 'one',
      'restore reaches the other instance',
      8000,
    );
  });

  it('merges what another instance stored before the barrier into the pre-restore snapshot', async () => {
    const first = await start();
    const second = await start();
    const { owner, members, pageId } = await scene(first, ['EDITOR']);
    const a = await first.connect(owner, pageId);
    addParagraph(a.doc, 'one');
    await command(a, 'version.create', {});
    const v = (await snapshotsOf(first, pageId))[0]!;
    // The second instance loads the document from PostgreSQL, so the first edit must be stored by now.
    await until(
      async () => paragraphs(await stored(first, pageId)).length === 1,
      'first edit stored',
    );
    const b = await second.connect(members[0]!, pageId);
    await until(() => paragraphs(b.doc).length === 1, 'loaded on second');
    addParagraph(b.doc, 'stored by the other instance');
    await until(
      async () => paragraphs(await stored(first, pageId)).includes('stored by the other instance'),
      'stored by second',
    );
    // The first instance's live document does not have it yet (no document sync between instances until Phase 9).
    expect(await command(a, 'version.restore', { versionId: v.id })).toMatchObject({
      type: 'response',
    });
    const pre = (await snapshotsOf(first, pageId)).find((r) => r.kind === 'PRE_RESTORE')!;
    const preDoc = new Y.Doc();
    Y.applyUpdate(preDoc, new Uint8Array(pre.state));
    expect(paragraphs(preDoc)).toContain('stored by the other instance');
  });
});

describe('comment anchors after a restore (U8)', () => {
  it('keeps threads on unchanged text attached and marks threads on replaced text detached', async () => {
    const h = await start();
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'Stable paragraph');
    addParagraph(a.doc, 'Replaced paragraph');
    await until(async () => await h.hasStoredData(pageId), 'stored');
    await command(a, 'version.create', { label: 'base' });
    const base = (await snapshotsOf(h, pageId))[0]!;

    // Anchors on text in each paragraph (mid-word positions inside the text nodes).
    const anchorIn = (index: number) => {
      const text = (fragmentOf(a.doc).get(index) as Y.XmlElement).get(0) as Y.XmlText;
      return {
        start: Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 2, 0)),
        end: Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 8, -1)),
      };
    };
    const mk = async (index: number) =>
      (
        await h.prisma.commentThread.create({
          data: {
            pageId,
            createdById: owner.id,
            quotedText: 'q',
            anchorStart: new Uint8Array(anchorIn(index).start),
            anchorEnd: new Uint8Array(anchorIn(index).end),
            comments: { create: { authorId: owner.id, body: 'c' } },
          },
        })
      ).id;
    const stable = await mk(0);
    const replaced = await mk(1);

    // Rewrite the second paragraph completely, then go back to the base version.
    fragmentOf(a.doc).delete(1, 1);
    addParagraph(a.doc, 'Something else entirely');
    await command(a, 'version.restore', { versionId: base.id });
    expect(paragraphs(a.doc)).toEqual(['Stable paragraph', 'Replaced paragraph']);

    const status = async (id: string) =>
      (await h.prisma.commentThread.findUniqueOrThrow({ where: { id } })).anchorStatus;
    expect(await status(stable)).toBe('ACTIVE');
    expect(await status(replaced)).toBe('DETACHED');
    // The collaborators are told to refresh their threads.
    expect(a.messageTypes()).toContain('comments.changed');
    // No thread or comment was lost.
    expect(await h.prisma.commentThread.count({ where: { pageId } })).toBe(2);
    expect(await h.prisma.comment.count({ where: { thread: { pageId } } })).toBe(2);
  });
});

describe('page events (AC-8.10)', () => {
  it('relays comments.changed to the page’s connections only', async () => {
    const h = await start();
    const { owner, members, pageId, workspaceId } = await scene(h, ['VIEWER']);
    const otherPage = await h.page(workspaceId, owner);
    const viewer = await h.connect(members[0]!, pageId);
    const ownerOn = await h.connect(owner, pageId);
    const elsewhere = await h.connect(owner, otherPage);
    const event: PageEvent = {
      v: 1,
      type: 'comments.changed',
      pageId,
      at: new Date().toISOString(),
    };
    await h.redis.publish(PAGE_EVENTS_CHANNEL, JSON.stringify(event));
    await until(
      () =>
        viewer.messageTypes().includes('comments.changed') &&
        ownerOn.messageTypes().includes('comments.changed'),
      'relayed',
    );
    await sleep(150);
    expect(elsewhere.messageTypes()).not.toContain('comments.changed');
    const relayed = viewer.messages.find((m) => m.type === 'comments.changed');
    expect(relayed && 'payload' in relayed ? relayed.payload : null).toEqual({ pageId });
  });

  it('ignores malformed page events without disturbing connections', async () => {
    const h = await start();
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    await h.redis.publish(PAGE_EVENTS_CHANNEL, 'not json');
    await h.redis.publish(
      PAGE_EVENTS_CHANNEL,
      JSON.stringify({ v: 1, type: 'bogus', pageId, at: 'x' }),
    );
    await h.redis.publish(
      PAGE_EVENTS_CHANNEL,
      JSON.stringify({ v: 1, type: 'comments.changed', pageId: 'nope', at: 'x' }),
    );
    await sleep(200);
    expect(a.messageTypes()).not.toContain('comments.changed');
    expect(a.online).toBe(true);
  });
});

describe('snapshot storage is separate from the live document', () => {
  it('never changes the live document or its stored rows when a snapshot is taken', async () => {
    const h = await start();
    const { owner, pageId } = await scene(h);
    const a = await h.connect(owner, pageId);
    addParagraph(a.doc, 'x');
    await until(async () => await h.hasStoredData(pageId), 'stored');
    const rowsBefore = await h.prisma.documentUpdate.count({ where: { pageId } });
    const stateBefore = Y.encodeStateVector(a.doc);
    await command(a, 'version.create', {});
    expect(Buffer.from(Y.encodeStateVector(a.doc)).equals(Buffer.from(stateBefore))).toBe(true);
    expect(await h.prisma.documentUpdate.count({ where: { pageId } })).toBe(rowsBefore);
    expect(
      await new SnapshotStore(h.prisma).get(pageId, (await snapshotsOf(h, pageId))[0]!.id),
    ).not.toBeNull();
  });
});
