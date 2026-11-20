import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AppError,
  canRestrictMember,
  nullResponseSchema,
  pageParamsSchema,
  pagePermissionParamsSchema,
  pagePermissionResponseSchema,
  pagePermissionsResponseSchema,
  setPagePermissionRequestSchema,
  successEnvelope,
  workspaceRoleAtLeast,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { rateLimitConfig } from '../plugins/security.js';
import { publishAccessEvents } from '../workspaces/access-events.js';
import { type AccessService, lockWorkspace } from '../workspaces/access.js';
import { logActivity } from '../workspaces/activity.js';
import { USER_SUMMARY_SELECT, toPagePermissionDto, toUserSummary } from '../workspaces/dto.js';

const PERMISSION_SELECT = {
  userId: true,
  pageId: true,
  role: true,
  createdAt: true,
  user: { select: USER_SUMMARY_SELECT },
} as const;

/** PP-01 … PP-03 (docs/API_CONTRACTS.md §8, D23). Registered inside the authenticated scope. */
export async function registerPagePermissionRoutes(
  scope: FastifyInstance,
  { prisma, redis, clock }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const general = { rateLimit: rateLimitConfig(config.rateLimits.general) };

  /** The page, with `WS≥ADMIN` required (404 when the caller cannot see it, 403 when not admin). */
  async function adminPageAccess(userId: string, pageId: string) {
    const found = await access.pageAccess(userId, pageId);
    if (!workspaceRoleAtLeast(found.workspaceRole, 'ADMIN')) {
      throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
    }
    return found;
  }

  // ───────────── PP-01 List overrides ─────────────
  app.get(
    '/api/v1/pages/:pageId/permissions',
    {
      schema: { params: pageParamsSchema, response: { 200: pagePermissionsResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const found = await adminPageAccess(user.id, request.params.pageId);
      const ancestors = found.chain.slice(1);

      const [own, inheritedRows] = await Promise.all([
        prisma.pagePermission.findMany({
          where: { pageId: found.page.id },
          select: PERMISSION_SELECT,
          orderBy: { createdAt: 'asc' },
        }),
        ancestors.length === 0
          ? Promise.resolve([])
          : prisma.pagePermission.findMany({
              where: { pageId: { in: ancestors.map((a) => a.id) } },
              select: PERMISSION_SELECT,
            }),
      ]);

      // Per user, the nearest ancestor's override is the one that applies; a user with an
      // override on this very page is already fully described by `overrides`.
      const depthOf = new Map(ancestors.map((a) => [a.id, a.depth]));
      const ownUsers = new Set(own.map((o) => o.userId));
      const nearest = new Map<string, (typeof inheritedRows)[number]>();
      for (const row of inheritedRows) {
        if (ownUsers.has(row.userId)) continue;
        const current = nearest.get(row.userId);
        if (
          current === undefined ||
          (depthOf.get(row.pageId) ?? 0) < (depthOf.get(current.pageId) ?? 0)
        ) {
          nearest.set(row.userId, row);
        }
      }
      return reply.send(
        successEnvelope({
          overrides: own.map(toPagePermissionDto),
          inherited: [...nearest.values()].map((row) => ({
            user: toUserSummary(row.user),
            role: row.role,
            fromPageId: row.pageId,
          })),
        }),
      );
    },
  );

  // ───────────── PP-02 Set an override (upsert) ─────────────
  app.put(
    '/api/v1/pages/:pageId/permissions/:userId',
    {
      schema: {
        params: pagePermissionParamsSchema,
        body: setPagePermissionRequestSchema,
        response: { 200: pagePermissionResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { pageId, userId: targetId } = request.params;
      const { role } = request.body;
      const now = clock();
      const found = await adminPageAccess(user.id, pageId);
      const { workspaceId } = found.page;

      const permission = await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const targetRole = await access.membership(tx, workspaceId, targetId);
        if (targetRole === null) throw new AppError('NOT_FOUND', 'Resource not found.');
        // Admins and the owner always have full access (D23): never restrictable.
        if (!canRestrictMember(targetRole)) {
          throw new AppError('CANNOT_RESTRICT_ADMIN', 'Admins and owners cannot be restricted.');
        }
        const saved = await tx.pagePermission.upsert({
          where: { pageId_userId: { pageId, userId: targetId } },
          create: { pageId, userId: targetId, role, createdById: user.id },
          update: { role },
          select: PERMISSION_SELECT,
        });
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'page.permission_set',
          pageId,
          metadata: { userId: targetId, role },
          at: now,
        });
        return saved;
      });

      await publishAccessEvents(redis, request.log, [
        { type: 'page.access_changed', workspaceId, pageId, userId: targetId, at: now },
      ]);
      return reply.send(successEnvelope({ permission: toPagePermissionDto(permission) }));
    },
  );

  // ───────────── PP-03 Remove an override ─────────────
  app.delete(
    '/api/v1/pages/:pageId/permissions/:userId',
    {
      schema: { params: pagePermissionParamsSchema, response: { 200: nullResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { pageId, userId: targetId } = request.params;
      const now = clock();
      const found = await adminPageAccess(user.id, pageId);
      const { workspaceId } = found.page;

      await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const removed = await tx.pagePermission.deleteMany({ where: { pageId, userId: targetId } });
        if (removed.count === 0) throw new AppError('NOT_FOUND', 'Resource not found.');
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'page.permission_removed',
          pageId,
          metadata: { userId: targetId },
          at: now,
        });
      });

      await publishAccessEvents(redis, request.log, [
        { type: 'page.access_changed', workspaceId, pageId, userId: targetId, at: now },
      ]);
      return reply.send(successEnvelope(null));
    },
  );
}
