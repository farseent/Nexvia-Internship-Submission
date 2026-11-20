import { describe, expect, it } from 'vitest';
import {
  COLLAB_CLOSE,
  accessEventSchema,
  collabTokenClaimsSchema,
  encodeServerMessage,
  parseClientEnvelope,
  parseServerMessage,
} from './collab-protocol.js';

const ID = '0b1b6a8e-3a52-4c1d-8a49-2b8a4f3d1e01';
const claims = {
  iss: 'conote-api',
  aud: 'conote-collab',
  sub: ID,
  sid: ID,
  pid: ID,
  jti: 'abcdefgh',
  iat: 1,
  exp: 61,
};

describe('collaboration token claims', () => {
  it('accepts exactly the documented claims', () => {
    expect(collabTokenClaimsSchema.safeParse(claims).success).toBe(true);
  });
  it.each([
    ['wrong issuer', { iss: 'x' }],
    ['wrong audience', { aud: 'x' }],
    ['subject that is not a UUID', { sub: 'nope' }],
    ['page id that is not a UUID', { pid: '../../etc' }],
    ['short jti', { jti: 'a' }],
    ['non-integer expiry', { exp: 1.5 }],
  ])('rejects %s', (_n, patch) => {
    expect(collabTokenClaimsSchema.safeParse({ ...claims, ...patch }).success).toBe(false);
  });
});

describe('application messages', () => {
  it('round-trips every server message', () => {
    const messages = [
      { v: 1, type: 'access.changed', payload: { readOnly: true, role: 'VIEWER' } },
      { v: 1, type: 'access.revoked', payload: { reason: 'MEMBER_REMOVED' } },
      { v: 1, type: 'server.shutting_down', payload: {} },
      { v: 1, type: 'error', replyTo: 'r1', payload: { code: 'INVALID_MESSAGE', message: 'no' } },
    ] as const;
    for (const message of messages) {
      expect(parseServerMessage(encodeServerMessage(message))).toEqual(message);
    }
  });
  it.each([
    'not json',
    '{}',
    JSON.stringify({ v: 2, type: 'server.shutting_down', payload: {} }),
    JSON.stringify({ v: 1, type: 'access.revoked', payload: { reason: 'MADE_UP' } }),
    JSON.stringify({
      v: 1,
      type: 'access.changed',
      payload: { readOnly: true, role: 'VIEWER', extra: 1 },
    }),
    'x'.repeat(9000),
  ])('parseServerMessage returns null for %s', (raw) => {
    expect(parseServerMessage(raw)).toBeNull();
  });
  it('validates the client envelope', () => {
    expect(
      parseClientEnvelope(
        JSON.stringify({ v: 1, type: 'version.restore', id: 'a', payload: { x: 1 } }),
      )?.type,
    ).toBe('version.restore');
    expect(parseClientEnvelope(JSON.stringify({ v: 1, type: 'x' }))?.payload).toEqual({});
    for (const bad of [
      'nope',
      '[]',
      JSON.stringify({ v: 1 }),
      JSON.stringify({ v: 1, type: '' }),
      JSON.stringify({ v: 1, type: 'x', payload: [] }),
      'y'.repeat(9000),
    ]) {
      expect(parseClientEnvelope(bad)).toBeNull();
    }
  });
});

describe('access events and close reasons', () => {
  it('parses an access event and rejects an unknown type', () => {
    expect(
      accessEventSchema.safeParse({ v: 1, type: 'member.removed', workspaceId: ID, at: 'now' })
        .success,
    ).toBe(true);
    expect(accessEventSchema.safeParse({ v: 1, type: 'other', at: 'now' }).success).toBe(false);
    expect(
      accessEventSchema.safeParse({ v: 1, type: 'member.removed', workspaceId: 'x', at: 'now' })
        .success,
    ).toBe(false);
  });
  it('uses distinct codes in the application range', () => {
    const codes = Object.values(COLLAB_CLOSE).map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const { code } of Object.values(COLLAB_CLOSE))
      expect(code === 1000 || code === 1009 || code === 1012 || (code >= 4400 && code < 4600)).toBe(
        true,
      );
  });
});
