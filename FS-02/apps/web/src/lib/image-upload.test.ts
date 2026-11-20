import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES } from '@conote/shared';
import { ImageUploadError, checkImageFile, uploadPageImage } from './image-upload';

afterEach(() => vi.unstubAllGlobals());

describe('checkImageFile', () => {
  it('accepts the four raster types up to the limit', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(() => checkImageFile({ type, size: MAX_IMAGE_BYTES })).not.toThrow();
    }
  });

  it('rejects other types (including SVG), empty and oversized files with readable messages', () => {
    expect(() => checkImageFile({ type: 'image/svg+xml', size: 10 })).toThrow(
      /PNG, JPEG, GIF or WebP/,
    );
    expect(() => checkImageFile({ type: 'application/pdf', size: 10 })).toThrow(ImageUploadError);
    expect(() => checkImageFile({ type: 'image/png', size: 0 })).toThrow(/empty/);
    expect(() => checkImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toThrow(
      /at most 5 MB/,
    );
  });
});

describe('uploadPageImage', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'My chart.final.png', { type: 'image/png' });
  const asset = {
    id: 'a1',
    status: 'PENDING',
    contentType: 'image/png',
    sizeBytes: 3,
    url: '/api/v1/assets/a1',
  };
  const reply = (status: number, data: unknown) =>
    new Response(
      JSON.stringify(
        status < 400
          ? { success: true, data }
          : { success: false, error: { code: data, message: 'x', requestId: 'r' } },
      ),
      {
        status,
        headers: { 'content-type': 'application/json' },
      },
    );

  it('runs authorize, upload and confirm in order and returns the stable URL', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url}`);
        if (url === '/api/v1/assets/uploads')
          return reply(201, {
            asset,
            upload: {
              url: '/api/v1/assets/a1/content',
              method: 'PUT',
              headers: { 'Content-Type': 'image/png' },
              expiresAt: '2026-11-15T00:00:00.000Z',
            },
          });
        if (url.endsWith('/content')) return reply(200, null);
        return reply(200, { asset: { ...asset, status: 'READY' } });
      }),
    );
    await expect(uploadPageImage('p1', file)).resolves.toEqual({
      url: '/api/v1/assets/a1',
      alt: 'My chart.final',
    });
    expect(calls).toEqual([
      'POST /api/v1/assets/uploads',
      'PUT /api/v1/assets/a1/content',
      'POST /api/v1/assets/a1/complete',
    ]);
  });

  it('sends nothing for a file that is not allowed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      uploadPageImage('p1', new File(['x'], 'a.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow(ImageUploadError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['UNSUPPORTED_MEDIA_TYPE', 415, /not supported/],
    ['PAYLOAD_TOO_LARGE', 413, /too large/],
    ['FORBIDDEN', 403, /permission/],
    ['CONFLICT', 409, /try again/],
  ])('turns %s into a readable message and stops', async (code, status, message) => {
    const fetchMock = vi.fn(async () => reply(status, code));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadPageImage('p1', file)).rejects.toThrow(message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure without leaking details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const error = await uploadPageImage('p1', file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageUploadError);
    expect((error as Error).message).not.toMatch(/TypeError|fetch failed/);
  });
});
