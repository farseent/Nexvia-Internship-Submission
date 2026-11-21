import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@conote/db';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AppError,
  pageParamsSchema,
  successEnvelope,
  versionListQuerySchema,
  versionListResponseSchema,
  versionParamsSchema,
  versionResponseSchema,
  type VersionMetaDto,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { rateLimitConfig } from '../plugins/security.js';
import { type AccessService } from '../workspaces/access.js';
import { USER_SUMMARY_SELECT, toUserSummary } from '../workspaces/dto.js';
import { afterCursor, decodeCursor, pageOf } from '../workspaces/pagination.js';

const VERSION_SELECT = {
  id: true,
  pageId: true,
  kind: true,
  label: true,
  sizeBytes: true,
  createdAt: true,
  contributorIds: true,
  createdBy: { select: USER_SUMMARY_SELECT },
} satisfies Prisma.DocumentSnapshotSelect;

/**
 * VER-01 … VER-03 (docs/API_CONTRACTS.md §11, D9). Listing and reading versions are REST at
 * `PAGE≥VIEWER`. Creating a snapshot and restoring a version are collaboration-server commands
 * (WEBSOCKET_PROTOCOL §7, §8) because they must be serialized with live editing.
 */
export async function registerVersionRoutes(
  scope: FastifyInstance,
  { prisma }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const general = { rateLimit: rateLimitConfig(config.rateLimits.general) };

  type Row = Awaited<ReturnType<typeof findRows>>[number];
  const findRows = (args: Parameters<typeof prisma.documentSnapshot.findMany>[0]) =>
    prisma.documentSnapshot.findMany({ ...args, select: VERSION_SELECT });

  async function toDtos(rows: readonly Row[]): Promise<VersionMetaDto[]> {
    const ids = [...new Set(rows.flatMap((row) => row.contributorIds))];
    const users =
      ids.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: ids } },
            select: USER_SUMMARY_SELECT,
          });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((row) => ({
      id: row.id,
      pageId: row.pageId,
      kind: row.kind,
      label: row.label,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy === null ? null : toUserSummary(row.createdBy),
      // A contributor whose account no longer exists is left out.
      contributors: row.contributorIds.flatMap((id) => {
        const user = byId.get(id);
        return user === undefined ? [] : [toUserSummary(user)];
      }),
    }));
  }

  // ───────────── VER-01 List versions ─────────────
  app.get(
    '/api/v1/pages/:pageId/versions',
    {
      schema: {
        params: pageParamsSchema,
        querystring: versionListQuerySchema,
        response: { 200: versionListResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const found = await access.pageAccess(user.id, request.params.pageId);
      const { kind, limit, cursor } = request.query;
      const rows = await findRows({
        where: {
          pageId: found.page.id,
          ...(kind === undefined ? {} : { kind }),
          ...afterCursor(cursor === undefined ? undefined : decodeCursor(cursor)),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const { items, nextCursor } = pageOf(rows, limit, (row) => row.createdAt);
      return reply.send(successEnvelope({ versions: await toDtos(items) }, { nextCursor }));
    },
  );

  // ───────────── VER-02 Version detail ─────────────
  app.get(
    '/api/v1/pages/:pageId/versions/:versionId',
    {
      schema: { params: versionParamsSchema, response: { 200: versionResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const found = await access.pageAccess(user.id, request.params.pageId);
      const rows = await findRows({
        where: { id: request.params.versionId, pageId: found.page.id },
        take: 1,
      });
      const [version] = await toDtos(rows);
      if (version === undefined) throw new AppError('NOT_FOUND', 'Resource not found.');
      return reply.send(successEnvelope({ version }));
    },
  );

  // ───────────── VER-03 Version state (binary) ─────────────
  app.get(
    '/api/v1/pages/:pageId/versions/:versionId/state',
    { schema: { params: versionParamsSchema }, config: general },
    async (request, reply) => {
      const { user } = authOf(request);
      const found = await access.pageAccess(user.id, request.params.pageId);
      const row = await prisma.documentSnapshot.findFirst({
        where: { id: request.params.versionId, pageId: found.page.id },
        select: { state: true },
      });
      if (row === null) throw new AppError('NOT_FOUND', 'Resource not found.');
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Cache-Control', 'private, no-store')
        .send(Buffer.from(row.state));
    },
  );
}
