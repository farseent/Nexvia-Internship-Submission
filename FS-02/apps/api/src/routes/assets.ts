import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Asset } from '@conote/db';
import {
  ALLOWED_IMAGE_TYPES,
  ASSET_UPLOAD_TTL_SECONDS,
  AppError,
  MAX_IMAGE_BYTES,
  assetParamsSchema,
  assetResponseSchema,
  assetUploadResponseSchema,
  assetUrl,
  createAssetUploadRequestSchema,
  detectImageType,
  emptyBodySchema,
  isAllowedImageType,
  nullResponseSchema,
  successEnvelope,
  type AssetDto,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { rateLimitConfig } from '../plugins/security.js';
import { objectKeyFor } from '../storage/storage-adapter.js';
import type { AccessService } from '../workspaces/access.js';

const notFound = () => new AppError('NOT_FOUND', 'Resource not found.');

export function toAssetDto(
  asset: Pick<Asset, 'id' | 'status' | 'contentType' | 'sizeBytes'>,
): AssetDto {
  return {
    id: asset.id,
    status: asset.status,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    url: assetUrl(asset.id),
  };
}

/** The longest signature `detectImageType` looks at (WebP: 12 bytes). */
const SIGNATURE_BYTES = 16;

/**
 * ASSET-01 … ASSET-04: image upload and access (docs/API_CONTRACTS.md §9, D10, D55).
 * Only page images exist so far; avatars follow later.
 */
export async function registerAssetRoutes(
  scope: FastifyInstance,
  { prisma, clock, storage }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const limited = { rateLimit: rateLimitConfig(config.rateLimits.assetUpload) };

  /** The caller's own asset, still tied to a page they may edit; otherwise 404 / 403. */
  async function ownAssetForEditing(userId: string, assetId: string): Promise<Asset> {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (asset === null || asset.uploadedById !== userId || asset.pageId === null) throw notFound();
    const pageAccess = await access.pageAccess(userId, asset.pageId);
    access.requirePageRole(pageAccess, 'EDITOR');
    return asset;
  }

  // Raw image bytes are only accepted on ASSET-04, in this encapsulated scope, so every
  // other route keeps rejecting non-JSON bodies.
  await scope.register(async (uploadScope) => {
    uploadScope.addContentTypeParser(
      [...ALLOWED_IMAGE_TYPES],
      { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES },
      (_request, body, done) => done(null, body),
    );

    // ───────────── ASSET-04 Upload bytes (adapters that receive uploads through the API) ─────────────
    uploadScope.withTypeProvider<ZodTypeProvider>().put(
      '/api/v1/assets/:assetId/content',
      {
        schema: { params: assetParamsSchema, response: { 200: nullResponseSchema } },
        bodyLimit: MAX_IMAGE_BYTES,
        config: limited,
      },
      async (request, reply) => {
        if (!storage.receivesUploadsThroughApi) throw notFound();
        const { user } = authOf(request);
        const asset = await ownAssetForEditing(user.id, request.params.assetId);
        if (asset.status !== 'PENDING')
          throw new AppError('CONFLICT', 'The upload was already completed.');
        if (clock().getTime() > asset.createdAt.getTime() + ASSET_UPLOAD_TTL_SECONDS * 1000) {
          throw new AppError('CONFLICT', 'The upload authorization has expired.');
        }
        const declared = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        if (declared !== asset.contentType) {
          throw new AppError(
            'UNSUPPORTED_MEDIA_TYPE',
            'The content type does not match the upload authorization.',
          );
        }
        await storage.put(asset.objectKey, request.body as Buffer);
        return reply.send(successEnvelope(null));
      },
    );
  });

  const app = scope.withTypeProvider<ZodTypeProvider>();

  // ───────────── ASSET-01 Authorize an upload ─────────────
  app.post(
    '/api/v1/assets/uploads',
    {
      schema: {
        body: createAssetUploadRequestSchema,
        response: { 201: assetUploadResponseSchema },
      },
      config: limited,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { pageId, contentType, sizeBytes } = request.body;

      const pageAccess = await access.pageAccess(user.id, pageId);
      access.requirePageRole(pageAccess, 'EDITOR');

      const normalizedType = contentType.trim().toLowerCase();
      if (!isAllowedImageType(normalizedType)) {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'This image type is not supported.');
      }
      if (sizeBytes > MAX_IMAGE_BYTES) {
        throw new AppError('PAYLOAD_TOO_LARGE', 'The image is too large.');
      }

      const id = randomUUID();
      const now = clock();
      const asset = await prisma.asset.create({
        data: {
          id,
          workspaceId: pageAccess.page.workspaceId,
          pageId,
          uploadedById: user.id,
          purpose: 'PAGE_IMAGE',
          objectKey: objectKeyFor(pageAccess.page.workspaceId, id),
          contentType: normalizedType,
          sizeBytes,
          createdAt: now,
        },
      });
      const expiresAt = new Date(now.getTime() + ASSET_UPLOAD_TTL_SECONDS * 1000);
      const target = storage.createUploadTarget({
        assetId: id,
        contentType: normalizedType,
        expiresAt,
      });
      return reply.code(201).send(
        successEnvelope({
          asset: toAssetDto(asset),
          upload: { ...target, expiresAt: target.expiresAt.toISOString() },
        }),
      );
    },
  );

  // ───────────── ASSET-02 Confirm an upload ─────────────
  app.post(
    '/api/v1/assets/:assetId/complete',
    {
      schema: {
        params: assetParamsSchema,
        body: emptyBodySchema,
        response: { 200: assetResponseSchema },
      },
      config: limited,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const asset = await ownAssetForEditing(user.id, request.params.assetId);
      if (asset.status === 'READY')
        return reply.send(successEnvelope({ asset: toAssetDto(asset) }));

      const mismatch = async (message: string): Promise<never> => {
        await storage.delete(asset.objectKey);
        throw new AppError('CONFLICT', message);
      };
      const stored = await storage.stat(asset.objectKey);
      if (stored === null) throw new AppError('CONFLICT', 'The image has not been uploaded.');
      if (stored.sizeBytes !== asset.sizeBytes)
        return mismatch('The uploaded image does not match what was announced.');
      const head = await storage.readHead(asset.objectKey, SIGNATURE_BYTES);
      if (head === null || detectImageType(head) !== asset.contentType) {
        return mismatch('The uploaded file is not the announced image type.');
      }

      const ready = await prisma.asset.update({
        where: { id: asset.id },
        data: { status: 'READY' },
      });
      return reply.send(successEnvelope({ asset: toAssetDto(ready) }));
    },
  );

  // ───────────── ASSET-03 Read an image ─────────────
  app.get(
    '/api/v1/assets/:assetId',
    {
      schema: { params: assetParamsSchema },
      config: { rateLimit: rateLimitConfig(config.rateLimits.general) },
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const asset = await prisma.asset.findUnique({ where: { id: request.params.assetId } });
      if (asset === null || asset.status !== 'READY' || asset.pageId === null) throw notFound();
      await access.pageAccess(user.id, asset.pageId); // 404 unless at least VIEWER
      const object = await storage.open(asset.objectKey);
      if (object === null) {
        request.log.warn({ assetId: asset.id }, 'asset object missing in storage');
        throw notFound();
      }
      return reply
        .header('Content-Type', asset.contentType)
        .header('Content-Length', object.sizeBytes)
        .header('Content-Disposition', 'inline')
        .send(object.stream);
    },
  );
}
