import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  apiEnvSchema,
  assetUrl,
  createAssetUploadRequestSchema,
  detectImageType,
  isAllowedImageType,
  parseAssetUrl,
} from './index.js';

const ID = '0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const bytes = (...values: number[]) => Uint8Array.from(values);

describe('detectImageType', () => {
  it('recognizes the allowed formats by their leading bytes', () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectImageType(new TextEncoder().encode('GIF89a....'))).toBe('image/gif');
    expect(detectImageType(new TextEncoder().encode('GIF87a....'))).toBe('image/gif');
    expect(detectImageType(new TextEncoder().encode('RIFF\u0001\u0002\u0003\u0004WEBPVP8 '))).toBe(
      'image/webp',
    );
  });
  it('refuses everything else, including SVG, HTML and short input', () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      '<html>',
      'RIFF....WAVEfmt ',
      '',
    ]) {
      expect(detectImageType(new TextEncoder().encode(text))).toBeNull();
    }
    expect(detectImageType(bytes(0x89, 0x50))).toBeNull();
  });
});

describe('asset helpers', () => {
  it('builds and parses only the stable URL', () => {
    expect(assetUrl(ID)).toBe(`/api/v1/assets/${ID}`);
    expect(parseAssetUrl(assetUrl(ID))).toBe(ID);
    for (const bad of [
      `${assetUrl(ID)}/x`,
      `${assetUrl(ID)}?a=1`,
      `https://x.co${assetUrl(ID)}`,
      '/api/v1/assets/not-a-uuid',
      5,
      null,
    ]) {
      expect(parseAssetUrl(bad)).toBeNull();
    }
  });
  it('allows four raster types', () => {
    expect(['image/png', 'image/jpeg', 'image/gif', 'image/webp'].every(isAllowedImageType)).toBe(
      true,
    );
    expect(isAllowedImageType('image/svg+xml')).toBe(false);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
  it('validates the upload request shape', () => {
    const ok = { purpose: 'PAGE_IMAGE', pageId: ID, contentType: 'image/png', sizeBytes: 10 };
    expect(createAssetUploadRequestSchema.safeParse(ok).success).toBe(true);
    for (const patch of [
      { purpose: 'AVATAR' },
      { pageId: 'x' },
      { sizeBytes: 0 },
      { sizeBytes: 1.5 },
      { extra: true },
    ]) {
      expect(createAssetUploadRequestSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
    }
  });
});

describe('ASSET_STORAGE_DIR', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://a',
    REDIS_URL: 'redis://a',
    APP_URL: 'http://localhost:3000',
  };
  it('defaults to a relative directory and can be set', () => {
    expect(apiEnvSchema.parse(base).ASSET_STORAGE_DIR).toBe('.data/assets');
    expect(apiEnvSchema.parse({ ...base, ASSET_STORAGE_DIR: '/var/data' }).ASSET_STORAGE_DIR).toBe(
      '/var/data',
    );
    expect(apiEnvSchema.safeParse({ ...base, ASSET_STORAGE_DIR: '' }).success).toBe(false);
  });
});
