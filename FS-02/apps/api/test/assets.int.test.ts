import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET_PENDING_GRACE_HOURS,
  ASSET_UPLOAD_TTL_SECONDS,
  MAX_IMAGE_BYTES,
} from '@conote/shared';
import { createHarness, deleteTestUsers, type Harness } from './auth-harness.js';
import { cleanupAssets } from '../src/jobs/asset-cleanup.js';
import { addMember, errorCode, newPage, newUser, newWorkspace } from './workspace-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 7),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);

async function setup() {
  const owner = await newUser(h, 'owner');
  const ws = await newWorkspace(h, owner);
  const page = await newPage(h, owner, ws);
  return { owner, ws, page };
}

const authorize = (token: string | undefined, body: Record<string, unknown>) =>
  h.call('POST', '/api/v1/assets/uploads', { ...(token === undefined ? {} : { token }), body });
const upload = (token: string, id: string, bytes: Buffer, contentType = 'image/png') =>
  h.call('PUT', `/api/v1/assets/${id}/content`, { token, body: bytes, contentType });
const complete = (token: string, id: string) =>
  h.call('POST', `/api/v1/assets/${id}/complete`, { token });
const read = (token: string | undefined, id: string) =>
  h.call('GET', `/api/v1/assets/${id}`, token === undefined ? {} : { token });

/** Authorize, upload and confirm one image; returns its id. */
async function uploadedImage(
  token: string,
  pageId: string,
  bytes = PNG,
  contentType = 'image/png',
) {
  const auth = await authorize(token, {
    purpose: 'PAGE_IMAGE',
    pageId,
    contentType,
    sizeBytes: bytes.length,
  });
  expect(auth.status).toBe(201);
  const id = auth.body.data.asset.id as string;
  expect((await upload(token, id, bytes, contentType)).status).toBe(200);
  expect((await complete(token, id)).status).toBe(200);
  return id;
}
const meta = (pageId: string, extra: Record<string, unknown> = {}) => ({
  purpose: 'PAGE_IMAGE',
  pageId,
  contentType: 'image/png',
  sizeBytes: PNG.length,
  ...extra,
});

describe('upload flow: authorize, upload, confirm, read', () => {
  it('stores an image and serves the same bytes back', async () => {
    const { owner, page } = await setup();
    const auth = await authorize(owner.token, meta(page.id));
    expect(auth.status).toBe(201);
    const { asset, upload: target } = auth.body.data;
    expect(asset).toMatchObject({
      status: 'PENDING',
      contentType: 'image/png',
      sizeBytes: PNG.length,
      url: `/api/v1/assets/${asset.id}`,
    });
    expect(target).toMatchObject({
      method: 'PUT',
      url: `/api/v1/assets/${asset.id}/content`,
      headers: { 'Content-Type': 'image/png' },
    });
    expect(Date.parse(target.expiresAt)).toBeGreaterThan(h.clock.now.getTime());

    expect((await upload(owner.token, asset.id, PNG)).status).toBe(200);
    const done = await complete(owner.token, asset.id);
    expect(done.body.data.asset.status).toBe('READY');

    const res = await read(owner.token, asset.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(Buffer.compare(res.raw.rawPayload, PNG)).toBe(0);
  });

  it('generates the storage key on the server', async () => {
    const { owner, page, ws } = await setup();
    const id = await uploadedImage(owner.token, page.id);
    const row = await h.deps.prisma.asset.findUnique({ where: { id } });
    expect(row).toMatchObject({
      objectKey: `${ws}/${id}`,
      workspaceId: ws,
      pageId: page.id,
      uploadedById: owner.id,
      purpose: 'PAGE_IMAGE',
    });
  });

  it('completing twice is harmless', async () => {
    const { owner, page } = await setup();
    const id = await uploadedImage(owner.token, page.id);
    expect((await complete(owner.token, id)).status).toBe(200);
  });

  it('accepts every allowed type', async () => {
    const { owner, page } = await setup();
    await uploadedImage(owner.token, page.id, JPEG, 'image/jpeg');
    await uploadedImage(
      owner.token,
      page.id,
      Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]),
      'image/gif',
    );
    await uploadedImage(
      owner.token,
      page.id,
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]),
      'image/webp',
    );
  });
});

describe('ASSET-01 rules', () => {
  it('rejects unsupported types (415) including SVG, and oversize images (413)', async () => {
    const { owner, page } = await setup();
    for (const contentType of ['image/svg+xml', 'text/html', 'application/pdf', 'image/bmp']) {
      const res = await authorize(owner.token, meta(page.id, { contentType }));
      expect(res.status).toBe(415);
      expect(errorCode(res)).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
    const big = await authorize(owner.token, meta(page.id, { sizeBytes: MAX_IMAGE_BYTES + 1 }));
    expect(big.status).toBe(413);
    expect(errorCode(big)).toBe('PAYLOAD_TOO_LARGE');
    expect(
      (await authorize(owner.token, meta(page.id, { sizeBytes: MAX_IMAGE_BYTES }))).status,
    ).toBe(201);
  });

  it('validates the request shape', async () => {
    const { owner, page } = await setup();
    for (const patch of [
      { purpose: 'AVATAR' },
      { pageId: 'nope' },
      { sizeBytes: 0 },
      { sizeBytes: 1.5 },
      { contentType: '' },
      { extra: 1 },
    ]) {
      expect((await authorize(owner.token, meta(page.id, patch))).status).toBe(400);
    }
    expect(
      (
        await authorize(owner.token, {
          purpose: 'PAGE_IMAGE',
          contentType: 'image/png',
          sizeBytes: 5,
        })
      ).status,
    ).toBe(400);
  });

  it('requires a session and editing rights on the page', async () => {
    const { owner, ws, page } = await setup();
    expect((await authorize(undefined, meta(page.id))).status).toBe(401);
    const viewer = await addMember(h, ws, owner, 'VIEWER');
    const commenter = await addMember(h, ws, owner, 'COMMENTER');
    const editor = await addMember(h, ws, owner, 'EDITOR');
    expect((await authorize(viewer.token, meta(page.id))).status).toBe(403);
    expect((await authorize(commenter.token, meta(page.id))).status).toBe(403);
    expect((await authorize(editor.token, meta(page.id))).status).toBe(201);
    const stranger = await newUser(h, 'stranger');
    expect((await authorize(stranger.token, meta(page.id))).status).toBe(404);
    expect(
      (await authorize(owner.token, meta('0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'))).status,
    ).toBe(404);
  });

  it('refuses pages in the trash', async () => {
    const { owner, page } = await setup();
    await h.call('DELETE', `/api/v1/pages/${page.id}`, { token: owner.token });
    expect((await authorize(owner.token, meta(page.id))).status).toBe(404);
  });
});

describe('ASSET-04 upload bytes', () => {
  it('only the uploader may upload, and only with the announced type', async () => {
    const { owner, ws, page } = await setup();
    const other = await addMember(h, ws, owner, 'EDITOR');
    const id = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    expect((await upload(other.token, id, PNG)).status).toBe(404);
    expect((await upload(owner.token, id, PNG, 'image/jpeg')).status).toBe(415);
    expect(
      (
        await h.call('PUT', `/api/v1/assets/${id}/content`, {
          token: owner.token,
          body: '{}',
          contentType: 'application/json',
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await h.call('PUT', `/api/v1/assets/${id}/content`, {
          token: owner.token,
          body: '<svg/>',
          contentType: 'image/svg+xml',
        })
      ).status,
    ).toBe(415);
    expect(
      (await h.call('PUT', `/api/v1/assets/${id}/content`, { body: PNG, contentType: 'image/png' }))
        .status,
    ).toBe(401);
    expect((await upload(owner.token, id, PNG)).status).toBe(200);
  });

  it('keeps the Origin check and limits the raw-body exemption to this route', async () => {
    const { owner, page } = await setup();
    const id = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    expect(
      (
        await h.call('PUT', `/api/v1/assets/${id}/content`, {
          token: owner.token,
          body: PNG,
          contentType: 'image/png',
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call('PUT', `/api/v1/assets/${id}/content`, {
          token: owner.token,
          body: PNG,
          contentType: 'image/png',
          origin: null,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call('POST', `/api/v1/assets/${id}/complete`, {
          token: owner.token,
          body: PNG,
          contentType: 'image/png',
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await h.call('POST', '/api/v1/assets/uploads', {
          token: owner.token,
          body: PNG,
          contentType: 'image/png',
        })
      ).status,
    ).toBe(415);
  });

  it('refuses bodies over the size limit', async () => {
    const { owner, page } = await setup();
    const id = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    const res = await upload(owner.token, id, Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]));
    expect(res.status).toBe(413);
  });

  it('refuses an expired authorization and an already confirmed asset', async () => {
    const { owner, page } = await setup();
    const id = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    h.clock.advance((ASSET_UPLOAD_TTL_SECONDS + 5) * 1000);
    expect((await upload(owner.token, id, PNG)).status).toBe(409);
    const done = await uploadedImage(owner.token, page.id);
    expect((await upload(owner.token, done, PNG)).status).toBe(409);
  });

  it('stops working once the uploader lost edit rights', async () => {
    const { owner, ws, page } = await setup();
    const editor = await addMember(h, ws, owner, 'EDITOR');
    const id = (await authorize(editor.token, meta(page.id))).body.data.asset.id as string;
    await h.call('PUT', `/api/v1/pages/${page.id}/permissions/${editor.id}`, {
      token: owner.token,
      body: { role: 'VIEWER' },
    });
    expect((await upload(editor.token, id, PNG)).status).toBe(403);
  });
});

describe('ASSET-02 confirmation checks what was really uploaded', () => {
  it('409 when nothing was uploaded', async () => {
    const { owner, page } = await setup();
    const id = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    expect((await complete(owner.token, id)).status).toBe(409);
  });

  it('409 and removal when the size differs from the announcement', async () => {
    const { owner, page } = await setup();
    const id = (await authorize(owner.token, meta(page.id, { sizeBytes: PNG.length + 5 }))).body
      .data.asset.id as string;
    await upload(owner.token, id, PNG);
    const res = await complete(owner.token, id);
    expect(res.status).toBe(409);
    const row = await h.deps.prisma.asset.findUnique({ where: { id } });
    expect(row?.status).toBe('PENDING');
    expect(await h.deps.storage.stat(row!.objectKey)).toBeNull();
  });

  it('409 when the bytes are not the announced image type (a script renamed to .png)', async () => {
    const { owner, page } = await setup();
    const html = Buffer.from('<script>alert(1)</script>'.padEnd(40, ' '));
    const id = (await authorize(owner.token, meta(page.id, { sizeBytes: html.length }))).body.data
      .asset.id as string;
    await upload(owner.token, id, html);
    expect((await complete(owner.token, id)).status).toBe(409);
    expect((await read(owner.token, id)).status).toBe(404);
    const jpegAsPng = (await authorize(owner.token, meta(page.id, { sizeBytes: JPEG.length }))).body
      .data.asset.id as string;
    await upload(owner.token, jpegAsPng, JPEG);
    expect((await complete(owner.token, jpegAsPng)).status).toBe(409);
  });

  it('only the uploader can confirm', async () => {
    const { owner, ws, page } = await setup();
    const other = await addMember(h, ws, owner, 'EDITOR');
    const id = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    await upload(owner.token, id, PNG);
    expect((await complete(other.token, id)).status).toBe(404);
    expect((await complete(owner.token, id)).status).toBe(200);
  });
});

describe('ASSET-03 access to images', () => {
  it('requires a session', async () => {
    const { owner, page } = await setup();
    const id = await uploadedImage(owner.token, page.id);
    expect((await read(undefined, id)).status).toBe(401);
  });

  it('lets every role that can see the page read the image, and nobody else', async () => {
    const { owner, ws, page } = await setup();
    const id = await uploadedImage(owner.token, page.id);
    for (const role of ['VIEWER', 'COMMENTER', 'EDITOR', 'ADMIN'] as const) {
      const member = await addMember(h, ws, owner, role);
      expect((await read(member.token, id)).status).toBe(200);
    }
    const stranger = await newUser(h, 'stranger');
    expect((await read(stranger.token, id)).status).toBe(404);
    const hidden = await addMember(h, ws, owner, 'VIEWER');
    await h.call('PUT', `/api/v1/pages/${page.id}/permissions/${hidden.id}`, {
      token: owner.token,
      body: { role: 'NONE' },
    });
    expect((await read(hidden.token, id)).status).toBe(404);
  });

  it('does not serve unconfirmed, unknown or trashed images', async () => {
    const { owner, page } = await setup();
    const pending = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    await upload(owner.token, pending, PNG);
    expect((await read(owner.token, pending)).status).toBe(404);
    expect((await read(owner.token, '0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')).status).toBe(404);
    expect((await read(owner.token, 'not-a-uuid')).status).toBe(400);
    const id = await uploadedImage(owner.token, page.id);
    await h.call('DELETE', `/api/v1/pages/${page.id}`, { token: owner.token });
    expect((await read(owner.token, id)).status).toBe(404);
    await h.call('POST', `/api/v1/pages/${page.id}/restore`, { token: owner.token });
    expect((await read(owner.token, id)).status).toBe(200);
  });

  it('answers 404 when the stored object has gone missing', async () => {
    const { owner, page } = await setup();
    const id = await uploadedImage(owner.token, page.id);
    const row = await h.deps.prisma.asset.findUnique({ where: { id } });
    await h.deps.storage.delete(row!.objectKey);
    expect((await read(owner.token, id)).status).toBe(404);
  });
});

describe('asset cleanup job', () => {
  it('removes abandoned uploads and images of purged pages, and keeps everything else', async () => {
    const { owner, page } = await setup();
    const abandoned = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    await upload(owner.token, abandoned, PNG);
    const fresh = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    const kept = await uploadedImage(owner.token, page.id);
    const orphan = await uploadedImage(owner.token, page.id);
    await h.deps.prisma.asset.update({ where: { id: orphan }, data: { pageId: null } });
    await h.deps.prisma.asset.update({
      where: { id: abandoned },
      data: {
        createdAt: new Date(h.clock.now.getTime() - (ASSET_PENDING_GRACE_HOURS + 1) * 3_600_000),
      },
    });
    const objectKey = (id: string) =>
      h.deps.prisma.asset.findUniqueOrThrow({ where: { id } }).then((r) => r.objectKey);
    const keys = {
      abandoned: await objectKey(abandoned),
      orphan: await objectKey(orphan),
      kept: await objectKey(kept),
    };

    const removed = await cleanupAssets(h.deps.prisma, h.deps.storage, h.clock.now);
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await h.deps.prisma.asset.findUnique({ where: { id: abandoned } })).toBeNull();
    expect(await h.deps.prisma.asset.findUnique({ where: { id: orphan } })).toBeNull();
    expect(await h.deps.storage.stat(keys.abandoned)).toBeNull();
    expect(await h.deps.storage.stat(keys.orphan)).toBeNull();
    expect(await h.deps.prisma.asset.findUnique({ where: { id: fresh } })).not.toBeNull();
    expect(await h.deps.prisma.asset.findUnique({ where: { id: kept } })).not.toBeNull();
    expect(await h.deps.storage.stat(keys.kept)).not.toBeNull();
  });

  it('leaves the row in place when the object cannot be removed, to retry later', async () => {
    const { owner, page } = await setup();
    const id = (await authorize(owner.token, meta(page.id))).body.data.asset.id as string;
    await h.deps.prisma.asset.update({
      where: { id },
      data: { createdAt: new Date(h.clock.now.getTime() - 48 * 3_600_000) },
    });
    const failing = {
      ...h.deps.storage,
      delete: () => Promise.reject(new Error('disk gone')),
    } as typeof h.deps.storage;
    await cleanupAssets(h.deps.prisma, failing, h.clock.now);
    expect(await h.deps.prisma.asset.findUnique({ where: { id } })).not.toBeNull();
  });
});

describe('local storage adapter safety', () => {
  it('refuses keys that are not <uuid>/<uuid>, so nothing escapes the storage directory', async () => {
    for (const key of [
      '../etc/passwd',
      '/etc/passwd',
      'a/b',
      '0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/../../x',
    ]) {
      await expect(h.deps.storage.put(key, Buffer.from('x'))).rejects.toThrow('Invalid object key');
      await expect(h.deps.storage.stat(key)).rejects.toThrow('Invalid object key');
    }
  });
});
