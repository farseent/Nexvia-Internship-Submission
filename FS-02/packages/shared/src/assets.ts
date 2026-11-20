import { z } from 'zod';
import { successEnvelopeSchema } from './auth.js';

/**
 * Asset (image) constants and schemas (docs/API_CONTRACTS.md §9, D10, D55).
 * Pure: no I/O. Request schemas reject unknown fields.
 */

/**
 * Image types accepted for upload, with the file extension used in messages only. SVG is
 * deliberately absent: it can carry script and is served from the application's origin (D55).
 */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

/** Largest accepted image (D55). Starting value, not tuned. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** How long an upload authorization stays usable (seconds). */
export const ASSET_UPLOAD_TTL_SECONDS = 10 * 60;

/** A `PENDING` asset older than this is abandoned and removed by the cleanup job (hours). */
export const ASSET_PENDING_GRACE_HOURS = 24;

export const ASSET_STATUSES = ['PENDING', 'READY'] as const;
export type AssetStatusValue = (typeof ASSET_STATUSES)[number];

/** Purposes in the data model (DATABASE_SCHEMA §4). Only `PAGE_IMAGE` is accepted until avatars ship. */
export const ASSET_PURPOSES = ['PAGE_IMAGE', 'AVATAR'] as const;

const ASSET_URL_PATTERN =
  /^\/api\/v1\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The stable, same-origin URL under which an asset is referenced in documents (ASSET-03). */
export function assetUrl(assetId: string): string {
  return `/api/v1/assets/${assetId}`;
}

/** The asset id when `value` is exactly a stable asset URL, otherwise `null`. */
export function parseAssetUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = ASSET_URL_PATTERN.exec(value);
  return match?.[1] ?? null;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * The image type the leading bytes of a file actually have, or `null` when they match none of
 * the allowed types. Used to confirm that an uploaded object is what the client declared.
 */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // "GIF87a" / "GIF89a"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) return 'image/gif';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif';
  // "RIFF" + 4 size bytes + "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
}

// ───────────── Schemas ─────────────

export const assetParamsSchema = z.strictObject({ assetId: z.uuid() });

/**
 * ASSET-01 request. `contentType` and `sizeBytes` are checked against the allow-list and the
 * limit by the route (so the failures are 415 and 413 rather than a generic 400).
 */
export const createAssetUploadRequestSchema = z.strictObject({
  purpose: z.literal('PAGE_IMAGE'),
  pageId: z.uuid(),
  contentType: z.string().min(1).max(127),
  sizeBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export type CreateAssetUploadRequest = z.infer<typeof createAssetUploadRequestSchema>;

export const assetSchema = z.object({
  id: z.uuid(),
  status: z.enum(ASSET_STATUSES),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  /** Stable URL, see `assetUrl`. */
  url: z.string(),
});
export type AssetDto = z.infer<typeof assetSchema>;

export const assetUploadTargetSchema = z.object({
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type AssetUploadTarget = z.infer<typeof assetUploadTargetSchema>;

export const assetUploadResponseSchema = successEnvelopeSchema(
  z.object({ asset: assetSchema, upload: assetUploadTargetSchema }),
);
export const assetResponseSchema = successEnvelopeSchema(z.object({ asset: assetSchema }));
