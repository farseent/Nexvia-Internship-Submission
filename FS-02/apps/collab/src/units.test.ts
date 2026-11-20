import { describe, expect, it } from 'vitest';
import { ConnectionRegistry, createContext } from './connection-registry.js';
import { connectionsAffectedBy } from './access-events.js';
import { classifyInbound } from './wire-messages.js';

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const W1 = '00000000-0000-4000-8000-0000000000a1';
const W2 = '00000000-0000-4000-8000-0000000000a2';
const ctx = (userId: string, workspaceId: string, sessionId = userId) =>
  createContext(
    {
      userId,
      sessionId,
      pageId: 'p',
      workspaceId,
      role: 'EDITOR',
      readOnly: false,
      tokenId: 't',
      identity: { id: userId, name: 'Test', color: '#4F46E5' },
    },
    0,
  );

describe('ConnectionRegistry', () => {
  it('counts per user and releases on remove', () => {
    const r = new ConnectionRegistry();
    const a = ctx(U1, W1);
    r.add(a);
    r.add(a); // idempotent
    expect(r.size).toBe(1);
    expect(r.countForUser(U1)).toBe(1);
    r.remove(a);
    r.remove(a);
    expect(r.size).toBe(0);
    expect(r.countForUser(U1)).toBe(0);
  });

  it('reservations count against the limits until released', () => {
    const r = new ConnectionRegistry();
    const limits = { perUser: 2, total: 10 };
    const r1 = r.reserve(U1, limits);
    const r2 = r.reserve(U1, limits);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r.reserve(U1, limits)).toBeNull();
    expect(r.reserve(U2, limits)).not.toBeNull();
    r1!();
    r1!(); // double release is harmless
    expect(r.reserve(U1, limits)).not.toBeNull();
  });

  it('enforces the total limit', () => {
    const r = new ConnectionRegistry();
    r.add(ctx(U1, W1));
    expect(r.reserve(U2, { perUser: 5, total: 1 })).toBeNull();
  });

  it('allows maxPerSecond messages per window, then refuses until the next window', () => {
    const r = new ConnectionRegistry();
    const c = ctx(U1, W1);
    const results = Array.from({ length: 5 }, () => r.allowMessage(c, 100, 3));
    expect(results).toEqual([true, true, true, false, false]);
    expect(r.allowMessage(c, 1200, 3)).toBe(true);
  });
});

describe('connectionsAffectedBy', () => {
  const setup = () => {
    const r = new ConnectionRegistry();
    const a = ctx(U1, W1, 's1');
    const b = ctx(U2, W1, 's2');
    const c = ctx(U1, W2, 's3');
    [a, b, c].forEach((x) => r.add(x));
    return { r, a, b, c };
  };
  const at = 'now';
  it('session.revoked: by session id, or by user when no session is named', () => {
    const { r, a, c } = setup();
    expect(
      connectionsAffectedBy(r, { v: 1, type: 'session.revoked', sessionId: 's1', at }),
    ).toEqual([a]);
    expect(
      connectionsAffectedBy(r, { v: 1, type: 'session.revoked', userId: U1, at }).sort(),
    ).toEqual([a, c].sort());
  });
  it('member events: the workspace, narrowed to the user when named', () => {
    const { r, a, b } = setup();
    expect(
      connectionsAffectedBy(r, { v: 1, type: 'member.removed', workspaceId: W1, userId: U1, at }),
    ).toEqual([a]);
    expect(
      connectionsAffectedBy(r, { v: 1, type: 'member.role_changed', workspaceId: W1, at }).sort(),
    ).toEqual([a, b].sort());
  });
  it('workspace.deleted and page.access_changed', () => {
    const { r, c } = setup();
    expect(
      connectionsAffectedBy(r, { v: 1, type: 'workspace.deleted', workspaceId: W2, at }),
    ).toEqual([c]);
    expect(
      connectionsAffectedBy(r, {
        v: 1,
        type: 'page.access_changed',
        workspaceId: W2,
        userId: U1,
        at,
      }),
    ).toEqual([c]);
    expect(
      connectionsAffectedBy(r, {
        v: 1,
        type: 'page.access_changed',
        workspaceId: '00000000-0000-4000-8000-0000000000ff',
        at,
      }),
    ).toEqual([]);
  });
});

describe('classifyInbound', () => {
  const str = (s: string) => [s.length, ...Buffer.from(s)];
  it('tells reads, writes, awareness and others apart without applying anything', () => {
    expect(classifyInbound(Uint8Array.from([...str('doc'), 0, 0, 1, 0]))).toBe('sync-read');
    expect(classifyInbound(Uint8Array.from([...str('doc'), 0, 1, 1, 0]))).toBe('sync-write');
    expect(classifyInbound(Uint8Array.from([...str('doc'), 0, 2, 1, 0]))).toBe('sync-write');
    expect(classifyInbound(Uint8Array.from([...str('doc'), 1, 0]))).toBe('awareness');
    expect(classifyInbound(Uint8Array.from([...str('doc'), 5, 0]))).toBe('other');
  });
  it('never throws on truncated or hostile input', () => {
    for (const bytes of [[], [200], [255, 255, 255, 255, 255, 255], [3, 1, 2], [0]]) {
      expect(['unknown', 'other', 'awareness', 'sync-read', 'sync-write']).toContain(
        classifyInbound(Uint8Array.from(bytes)),
      );
    }
  });
});

describe('ConnectionRegistry awareness ownership (D61)', () => {
  it('lets a connection own one client id and refuses others', () => {
    const r = new ConnectionRegistry();
    const a = ctx(U1, W1);
    expect(r.claimAwareness(a, 7)).toEqual({ ok: true, previous: null });
    expect(r.claimAwareness(a, 7).ok).toBe(true);
    expect(r.claimAwareness(a, 8).ok).toBe(false);
    expect(r.ownsAwareness(a, 7)).toBe(true);
    expect(r.ownsAwareness(a, 8)).toBe(false);
  });

  it("refuses a client id that another user's connection holds on the same page", () => {
    const r = new ConnectionRegistry();
    const a = ctx(U1, W1);
    const b = ctx(U2, W1);
    r.claimAwareness(a, 7);
    expect(r.claimAwareness(b, 7)).toEqual({ ok: false, previous: null });
    expect(b.awarenessClientId).toBeNull();
    expect(a.awarenessClientId).toBe(7);
  });

  it('lets a reconnection of the same user take the id over from its stale connection', () => {
    const r = new ConnectionRegistry();
    const stale = ctx(U1, W1);
    const fresh = ctx(U1, W1);
    r.claimAwareness(stale, 7);
    expect(r.claimAwareness(fresh, 7)).toEqual({ ok: true, previous: stale });
    expect(stale.awarenessClientId).toBeNull();
    // The stale connection closing later must not release the new owner's claim.
    r.add(stale);
    r.remove(stale);
    expect(r.ownsAwareness(fresh, 7)).toBe(true);
    expect(r.claimAwareness(ctx(U2, W1), 7).ok).toBe(false);
  });

  it('keeps ids of different pages apart and frees the id when the connection goes', () => {
    const r = new ConnectionRegistry();
    const a = ctx(U1, W1);
    const other = { ...ctx(U2, W1), pageId: 'other' };
    r.add(a);
    r.claimAwareness(a, 7);
    expect(r.claimAwareness(other, 7).ok).toBe(true);
    r.remove(a);
    expect(r.claimAwareness(ctx(U2, W1), 7).ok).toBe(true);
  });
});
