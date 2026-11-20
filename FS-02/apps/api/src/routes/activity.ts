import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  activityListQuerySchema,
  activityListResponseSchema,
  pageActivityQuerySchema,
  pageParamsSchema,
  successEnvelope,
  workspaceParamsSchema,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { rateLimitConfig } from '../plugins/security.js';
import { type AccessService } from '../workspaces/access.js';
import { USER_SUMMARY_SELECT, toActivityDto } from '../workspaces/dto.js';
import { afterCursor, decodeCursor, pageOf } from '../workspaces/pagination.js';

const ACTIVITY_SELECT = {
  id: true,
  workspaceId: true,
  pageId: true,
  action: true,
  metadata: true,
  createdAt: true,
  actor: { select: USER_SUMMARY_SELECT },
} as const;

/** ACT-01, ACT-02 (docs/API_CONTRACTS.md §12). Registered inside the authenticated scope. */
export async function registerActivityRoutes(
  scope: FastifyInstance,
  { prisma }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const general = { rateLimit: rateLimitConfig(config.rateLimits.general) };

  // ───────────── ACT-01 Workspace activity ─────────────
  app.get(
    '/api/v1/workspaces/:workspaceId/activity',
    {
      schema: {
        params: workspaceParamsSchema,
        querystring: activityListQuerySchema,
        response: { 200: activityListResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const { pageId, actorId, action, limit, cursor } = request.query;
      await access.requireWorkspaceRole(user.id, workspaceId, 'ADMIN');
      const rows = await prisma.activityLog.findMany({
        where: {
          workspaceId,
          ...(pageId === undefined ? {} : { pageId }),
          ...(actorId === undefined ? {} : { actorId }),
          ...(action === undefined ? {} : { action }),
          ...afterCursor(cursor === undefined ? undefined : decodeCursor(cursor)),
        },
        select: ACTIVITY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const { items, nextCursor } = pageOf(rows, limit, (row) => row.createdAt);
      return reply.send(successEnvelope({ activity: items.map(toActivityDto) }, { nextCursor }));
    },
  );

  // ───────────── ACT-02 Page activity ─────────────
  app.get(
    '/api/v1/pages/:pageId/activity',
    {
      schema: {
        params: pageParamsSchema,
        querystring: pageActivityQuerySchema,
        response: { 200: activityListResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const found = await access.pageAccess(user.id, request.params.pageId);
      const { action, limit, cursor } = request.query;
      const rows = await prisma.activityLog.findMany({
        where: {
          pageId: found.page.id,
          ...(action === undefined ? {} : { action }),
          ...afterCursor(cursor === undefined ? undefined : decodeCursor(cursor)),
        },
        select: ACTIVITY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const { items, nextCursor } = pageOf(rows, limit, (row) => row.createdAt);
      return reply.send(successEnvelope({ activity: items.map(toActivityDto) }, { nextCursor }));
    },
  );
}
