import { describe, expect, it } from 'vitest';
import {
  AWARENESS_MAX_STATE_BYTES,
  deriveCollaborators,
  initialsOf,
  normalizePresenceColor,
  parseRelayedAwareness,
  readableTextColor,
  sanitizeClientAwareness,
  type PresenceIdentity,
} from './presence.js';

const ADA: PresenceIdentity = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ada Lovelace',
  color: '#4F46E5',
};
const BOB_ID = '22222222-2222-4222-8222-222222222222';
const CURSOR = {
  anchor: { type: null, tname: 'default', item: { client: 7, clock: 3 }, assoc: 0 },
  head: { item: { client: 7, clock: 9 } },
};

describe('sanitizeClientAwareness (D61)', () => {
  it('replaces whatever identity the client wrote with the server-built one', () => {
    const state = sanitizeClientAwareness(
      { user: { id: BOB_ID, name: 'Admin', color: '#FF0000', extra: 1 }, cursor: CURSOR },
      ADA,
    );
    expect(state.user).toEqual(ADA);
    expect(JSON.stringify(state)).not.toContain('Admin');
    expect(JSON.stringify(state)).not.toContain(BOB_ID);
  });

  it('keeps a well-formed cursor and nothing else the client added', () => {
    const state = sanitizeClientAwareness({ cursor: CURSOR, secret: 'x', note: { a: 1 } }, ADA);
    expect(state).toEqual({ user: ADA, cursor: CURSOR });
  });

  it.each([
    ['not an object', 'cursor'],
    ['an array', [1, 2]],
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
  ])('gives presence without a cursor for %s', (_name, raw) => {
    expect(sanitizeClientAwareness(raw, ADA)).toEqual({ user: ADA });
  });

  it.each([
    ['a missing head', { anchor: CURSOR.anchor }],
    ['an extra key', { ...CURSOR, extra: true }],
    ['a negative clock', { anchor: { item: { client: 1, clock: -1 } }, head: CURSOR.head }],
    ['a fractional client id', { anchor: { item: { client: 1.5, clock: 1 } }, head: CURSOR.head }],
    ['an unsafe integer', { anchor: { item: { client: 1, clock: 2 ** 60 } }, head: CURSOR.head }],
    ['a long type name', { anchor: { tname: 'x'.repeat(65) }, head: CURSOR.head }],
    ['a string anchor', { anchor: 'start', head: CURSOR.head }],
    ['an out-of-range assoc', { anchor: { assoc: 5 }, head: CURSOR.head }],
  ])('drops a cursor with %s but keeps the person present', (_name, cursor) => {
    expect(sanitizeClientAwareness({ cursor }, ADA)).toEqual({ user: ADA });
  });

  it('ignores a state above the size limit entirely, cursor included', () => {
    const huge = { cursor: CURSOR, blob: 'x'.repeat(AWARENESS_MAX_STATE_BYTES) };
    expect(sanitizeClientAwareness(huge, ADA)).toEqual({ user: ADA });
  });

  it('does not alias the identity object it was given', () => {
    const state = sanitizeClientAwareness({}, ADA);
    state.user.name = 'changed';
    expect(ADA.name).toBe('Ada Lovelace');
  });

  it('survives a cyclic value without throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(sanitizeClientAwareness(cyclic, ADA)).toEqual({ user: ADA });
  });
});

describe('parseRelayedAwareness', () => {
  it('accepts what the server relays', () => {
    expect(parseRelayedAwareness({ user: ADA, cursor: CURSOR })).toEqual({
      user: ADA,
      cursor: CURSOR,
    });
  });
  it('rejects a state without a valid identity', () => {
    expect(parseRelayedAwareness({})).toBeNull();
    expect(parseRelayedAwareness(null)).toBeNull();
    expect(parseRelayedAwareness({ user: { ...ADA, id: 'not-a-uuid' } })).toBeNull();
    expect(
      parseRelayedAwareness({ user: { ...ADA, color: 'red; background: url(x)' } }),
    ).toBeNull();
    expect(parseRelayedAwareness({ user: { ...ADA, name: '' } })).toBeNull();
  });
  it('keeps the person but drops a malformed cursor', () => {
    expect(parseRelayedAwareness({ user: ADA, cursor: { anchor: 1 } })).toEqual({ user: ADA });
  });
});

describe('deriveCollaborators (one entry per user, FR-PR-04)', () => {
  const bob = { id: BOB_ID, name: 'Bob', color: '#0E7490' };
  const states = new Map<number, unknown>([
    [1, { user: ADA }], // the current person's own client
    [2, { user: bob, cursor: CURSOR }],
    [3, { user: bob }], // Bob's second tab
    [4, { user: ADA }], // the current person's second tab
    [5, { junk: true }], // never valid
  ]);

  it('lists each person once, the current person first, and counts their tabs', () => {
    const list = deriveCollaborators(states, 1, ADA);
    expect(list.map((c) => [c.name, c.isSelf, c.connections])).toEqual([
      ['Ada Lovelace', true, 2],
      ['Bob', false, 2],
    ]);
    expect(list[1]?.hasCursor).toBe(true);
  });

  it('lists nobody twice when the same person has several tabs and no self is given', () => {
    expect(deriveCollaborators(states, 1, null).map((c) => c.userId)).toEqual(
      [ADA.id, BOB_ID].sort(),
    );
  });

  it('is empty without states and without a current person', () => {
    expect(deriveCollaborators(new Map(), 1, null)).toEqual([]);
  });

  it('shows the current person alone when nobody else is there', () => {
    const list = deriveCollaborators(new Map([[1, { user: ADA }]]), 1, ADA);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ isSelf: true, connections: 1 });
  });

  it('orders the others by name', () => {
    const many = new Map<number, unknown>([
      [2, { user: { id: BOB_ID, name: 'Zed', color: '#111111' } }],
      [3, { user: { id: '33333333-3333-4333-8333-333333333333', name: 'Amy', color: '#222222' } }],
    ]);
    expect(deriveCollaborators(many, 1, null).map((c) => c.name)).toEqual(['Amy', 'Zed']);
  });
});

describe('avatar helpers', () => {
  it('builds initials from the first and last word', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('  ada  ')).toBe('A');
    expect(initialsOf('Jean Claude Van Damme')).toBe('JD');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('😀 Smile')).toBe('😀S');
  });
  it('picks a readable text colour', () => {
    expect(readableTextColor('#FFFFFF')).toBe('#000000');
    expect(readableTextColor('#000000')).toBe('#FFFFFF');
    expect(readableTextColor('#4F46E5')).toBe('#FFFFFF');
    expect(readableTextColor('#FDE047')).toBe('#000000');
  });
  it('replaces a corrupt colour by a neutral one', () => {
    expect(normalizePresenceColor('#abcdef')).toBe('#ABCDEF');
    expect(normalizePresenceColor('url(javascript:1)')).toBe('#64748B');
  });
});
