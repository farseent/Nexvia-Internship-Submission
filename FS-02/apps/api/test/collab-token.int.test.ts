import { generateKeyPairSync } from 'node:crypto';
import { importJWK, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COLLAB_TOKEN_AUDIENCE,
  COLLAB_TOKEN_ISSUER,
  collabTokenClaimsSchema,
  documentNameForPage,
} from '@conote/shared';
import { createHarness, deleteTestUsers, type Harness } from './auth-harness.js';
import { TEST_ORIGIN } from './helpers.js';
import { addMember, errorCode, newPage, newUser, newWorkspace } from './workspace-harness.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const KID = 'test-key-1';
const privateJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: priv.x as string,
  d: priv.d as string,
  kid: KID,
} as const;

let h: Harness;
beforeAll(async () => {
  h = await createHarness({
    config: { collab: { privateKey: privateJwk, url: 'ws://collab.test:4100' } },
  });
});
afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

const tokenCall = (token: string, pageId: string, options: { origin?: string | null } = {}) =>
  h.call('POST', `/api/v1/pages/${pageId}/collab-token`, { token, ...options });

describe('PAGE-10 collaboration token', () => {
  it('issues a short-lived EdDSA token that names the user, session and page, and no role', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page = await newPage(h, owner, ws);
    const res = await tokenCall(owner.token, page.id);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toMatchObject({
      collabUrl: 'ws://collab.test:4100',
      documentName: documentNameForPage(page.id),
      role: 'OWNER',
      readOnly: false,
    });

    const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', x: pub.x as string }, 'EdDSA');
    const { payload, protectedHeader } = await jwtVerify(data.token, key, {
      issuer: COLLAB_TOKEN_ISSUER,
      audience: COLLAB_TOKEN_AUDIENCE,
      algorithms: ['EdDSA'],
      currentDate: h.clock.now,
    });
    expect(protectedHeader.kid).toBe(KID);
    const claims = collabTokenClaimsSchema.parse(payload);
    expect(claims.sub).toBe(owner.id);
    expect(claims.pid).toBe(page.id);
    expect(claims.exp - claims.iat).toBe(60);
    expect(new Date(data.expiresAt).getTime()).toBe(claims.exp * 1000);
    expect(Object.keys(payload).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
      'pid',
      'sid',
      'sub',
    ]);
    const session = await h.deps.prisma.session.findUnique({ where: { id: claims.sid } });
    expect(session).toMatchObject({ userId: owner.id, revokedAt: null });
  });

  it('gives every request a fresh token id', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page = await newPage(h, owner, ws);
    const [a, b] = await Promise.all([
      tokenCall(owner.token, page.id),
      tokenCall(owner.token, page.id),
    ]);
    expect(a.body.data.token).not.toBe(b.body.data.token);
  });

  it.each([
    ['VIEWER', true],
    ['COMMENTER', true],
    ['EDITOR', false],
  ] as const)(
    'reports %s as readOnly=%s (a hint; the collab server decides)',
    async (role, readOnly) => {
      const owner = await newUser(h, 'owner');
      const ws = await newWorkspace(h, owner);
      const page = await newPage(h, owner, ws);
      const member = await addMember(h, ws, owner, role);
      const res = await tokenCall(member.token, page.id);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ role, readOnly });
    },
  );

  it('hides pages the caller cannot read: non-member, deleted page, and a NONE override all answer 404', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page = await newPage(h, owner, ws);
    const stranger = await newUser(h, 'stranger');
    const res = await tokenCall(stranger.token, page.id);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');

    const member = await addMember(h, ws, owner, 'EDITOR');
    await h.deps.prisma.pagePermission.create({
      data: { pageId: page.id, userId: member.id, role: 'NONE', createdById: owner.id },
    });
    expect((await tokenCall(member.token, page.id)).status).toBe(404);

    const other = await newPage(h, owner, ws);
    await h.call('DELETE', `/api/v1/pages/${other.id}`, { token: owner.token });
    expect((await tokenCall(owner.token, other.id)).status).toBe(404);
  });

  it('requires a session, a valid origin and a UUID', async () => {
    const owner = await newUser(h, 'owner');
    const ws = await newWorkspace(h, owner);
    const page = await newPage(h, owner, ws);
    const anonymous = await h.call('POST', `/api/v1/pages/${page.id}/collab-token`);
    expect(anonymous.status).toBe(401);
    const foreign = await tokenCall(owner.token, page.id, { origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    expect(foreign.body.data).toBeUndefined();
    expect([400, 422]).toContain((await tokenCall(owner.token, 'not-a-uuid')).status);
    expect(TEST_ORIGIN).toBeTruthy();
  });

  it('answers 503 when no signing key is configured, and still refuses unreadable pages first', async () => {
    const bare = await createHarness({
      config: { collab: { privateKey: undefined, url: 'ws://x:1' } },
    });
    try {
      const owner = await newUser(bare, 'owner');
      const ws = await newWorkspace(bare, owner);
      const page = await newPage(bare, owner, ws);
      const res = await bare.call('POST', `/api/v1/pages/${page.id}/collab-token`, {
        token: owner.token,
      });
      expect(res.status).toBe(503);
      expect(errorCode(res)).toBe('SERVICE_UNAVAILABLE');
      const stranger = await newUser(bare, 'stranger');
      const hidden = await bare.call('POST', `/api/v1/pages/${page.id}/collab-token`, {
        token: stranger.token,
      });
      expect(hidden.status).toBe(404);
    } finally {
      await deleteTestUsers(bare.deps);
      await bare.close();
    }
  });

  it('is rate limited per client address', async () => {
    const limited = await createHarness({
      config: {
        collab: { privateKey: privateJwk, url: 'ws://x:1' },
        rateLimits: { ...h.config.rateLimits, collabToken: { max: 3, timeWindowMs: 60_000 } },
      },
    });
    try {
      const owner = await newUser(limited, 'owner');
      const ws = await newWorkspace(limited, owner);
      const page = await newPage(limited, owner, ws);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        statuses.push(
          (
            await limited.call('POST', `/api/v1/pages/${page.id}/collab-token`, {
              token: owner.token,
            })
          ).status,
        );
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
    } finally {
      await deleteTestUsers(limited.deps);
      await limited.close();
    }
  });
});
