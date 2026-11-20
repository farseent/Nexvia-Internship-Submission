import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AppError,
  MAX_PAGE_DEPTH,
  createPageRequestSchema,
  movePageRequestSchema,
  nullResponseSchema,
  pageDeletedResponseSchema,
  pageDetailResponseSchema,
  pageListResponseSchema,
  pageParamsSchema,
  pageResponseSchema,
  paginationQuerySchema,
  resolveEffectivePageRole,
  roleAtLeast,
  successEnvelope,
  trashListResponseSchema,
  updatePageRequestSchema,
  workspaceParamsSchema,
  workspaceRoleAtLeast,
  type EffectivePageRole,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { rateLimitConfig } from '../plugins/security.js';
import { publishAccessEvents } from '../workspaces/access-events.js';
import {
  type AccessService,
  PAGE_SELECT,
  ancestorChain,
  bySiblingOrder,
  computeEffectiveRoles,
  lockWorkspace,
  subtreeDepths,
  type Db,
} from '../workspaces/access.js';
import { logActivity } from '../workspaces/activity.js';
import { toPageDto } from '../workspaces/dto.js';
import { decodeCursor, pageOf } from '../workspaces/pagination.js';
import { applyPlacementUpdates, listSiblings, planPlacement } from '../workspaces/placement.js';

/** Live pages of a subtree rooted at `pageId` (the page included), for soft deletion. */
async function liveSubtreeIds(db: Db, pageId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM pages WHERE id = ${pageId}::uuid AND "deletedAt" IS NULL
      UNION ALL
      SELECT p.id FROM pages p JOIN sub s ON p."parentId" = s.id WHERE p."deletedAt" IS NULL
    )
    SELECT id FROM sub`;
  return rows.map((row) => row.id);
}

/** Pages of one delete batch under `pageId` (the page included), for restoration. */
async function batchSubtreeIds(db: Db, pageId: string, batchId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM pages WHERE id = ${pageId}::uuid
      UNION ALL
      SELECT p.id FROM pages p JOIN sub s ON p."parentId" = s.id
      WHERE p."deletedAt" IS NOT NULL AND p."deleteBatchId" = ${batchId}::uuid
    )
    SELECT id FROM sub`;
  return rows.map((row) => row.id);
}

const notFound = () => new AppError('NOT_FOUND', 'Resource not found.');
const invalidMove = () => new AppError('INVALID_MOVE', 'The move is not allowed.');

/** PAGE-01 … PAGE-09 (docs/API_CONTRACTS.md §7). PAGE-10 (collab token) arrives with Phase 6. */
export async function registerPageRoutes(
  scope: FastifyInstance,
  { prisma, redis, clock }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const general = { rateLimit: rateLimitConfig(config.rateLimits.general) };

  /** The caller's role on a page after a structural change; `NONE` when it left their reach. */
  async function roleAfterChange(userId: string, pageId: string): Promise<EffectivePageRole> {
    try {
      return (await access.pageAccess(userId, pageId)).role;
    } catch (err) {
      if (err instanceof AppError && err.code === 'NOT_FOUND') return 'NONE';
      throw err;
    }
  }

  // ───────────── PAGE-01 Create ─────────────
  app.post(
    '/api/v1/workspaces/:workspaceId/pages',
    {
      schema: {
        params: workspaceParamsSchema,
        body: createPageRequestSchema,
        response: { 201: pageResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const { title, icon, afterPageId } = request.body;
      const parentId = request.body.parentId ?? null;
      const now = clock();

      // Membership first, so a stranger never learns anything about the workspace's pages.
      await access.requireWorkspaceRole(user.id, workspaceId, 'VIEWER');
      const myRole = await access.authorizeDestination(user.id, workspaceId, parentId);

      const page = await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        if (parentId !== null) {
          const parent = await tx.page.findUnique({
            where: { id: parentId },
            select: { workspaceId: true, deletedAt: true },
          });
          if (parent === null || parent.workspaceId !== workspaceId || parent.deletedAt !== null) {
            throw invalidMove();
          }
          const chain = await ancestorChain(tx, parentId);
          if (chain.length + 1 > MAX_PAGE_DEPTH) throw invalidMove();
        }
        const placement = planPlacement(await listSiblings(tx, workspaceId, parentId), afterPageId);
        await applyPlacementUpdates(tx, placement);
        const created = await tx.page.create({
          data: {
            workspaceId,
            parentId,
            title: title ?? 'Untitled',
            icon: icon ?? null,
            position: placement.position,
            createdById: user.id,
          },
          select: PAGE_SELECT,
        });
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'page.created',
          pageId: created.id,
          metadata: { parentId },
          at: now,
        });
        return created;
      });
      return reply.code(201).send(successEnvelope({ page: toPageDto(page, myRole) }));
    },
  );

  // ───────────── PAGE-02 List (flat; the client builds the tree) ─────────────
  app.get(
    '/api/v1/workspaces/:workspaceId/pages',
    {
      schema: { params: workspaceParamsSchema, response: { 200: pageListResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const workspaceRole = await access.requireWorkspaceRole(user.id, workspaceId, 'VIEWER');
      const [pages, overrides] = await Promise.all([
        prisma.page.findMany({ where: { workspaceId, deletedAt: null }, select: PAGE_SELECT }),
        prisma.pagePermission.findMany({
          where: { userId: user.id, page: { workspaceId } },
          select: { pageId: true, role: true },
        }),
      ]);
      const roles = computeEffectiveRoles(
        pages,
        workspaceRole,
        new Map(overrides.map((o) => [o.pageId, o.role])),
      );
      const visible = pages
        .filter((page) => roleAtLeast(roles.get(page.id) ?? 'NONE', 'VIEWER'))
        .sort((a, b) => {
          if (a.parentId !== b.parentId) {
            if (a.parentId === null) return -1;
            if (b.parentId === null) return 1;
            return a.parentId < b.parentId ? -1 : 1;
          }
          return bySiblingOrder(a, b);
        });
      return reply.send(
        successEnvelope({
          pages: visible.map((page) => toPageDto(page, roles.get(page.id) ?? 'NONE')),
        }),
      );
    },
  );

  // ───────────── PAGE-03 Get one page with breadcrumbs ─────────────
  app.get(
    '/api/v1/pages/:pageId',
    {
      schema: { params: pageParamsSchema, response: { 200: pageDetailResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const found = await access.pageAccess(user.id, request.params.pageId);

      // Ancestors the caller can see, root first. Each ancestor's role uses its own override chain.
      const visibleAncestors = found.chain.slice(1).filter((entry, i) => {
        const role = resolveEffectivePageRole({
          workspaceRole: found.workspaceRole,
          overrideChain: found.overrideChain.slice(i + 1),
        });
        return roleAtLeast(role, 'VIEWER') && entry.id !== found.page.id;
      });
      const titles =
        visibleAncestors.length === 0
          ? []
          : await prisma.page.findMany({
              where: { id: { in: visibleAncestors.map((a) => a.id) } },
              select: { id: true, title: true },
            });
      const titleById = new Map(titles.map((t) => [t.id, t.title]));
      const breadcrumbs = visibleAncestors
        .slice()
        .reverse()
        .map((entry) => ({ id: entry.id, title: titleById.get(entry.id) ?? 'Untitled' }));
      return reply.send(successEnvelope({ page: toPageDto(found.page, found.role), breadcrumbs }));
    },
  );

  // ───────────── PAGE-04 Update title / icon ─────────────
  app.patch(
    '/api/v1/pages/:pageId',
    {
      schema: {
        params: pageParamsSchema,
        body: updatePageRequestSchema,
        response: { 200: pageResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { title, icon } = request.body;
      const now = clock();
      const found = await access.pageAccess(user.id, request.params.pageId);
      access.requirePageRole(found, 'EDITOR');

      const page = await prisma.$transaction(async (tx) => {
        const updated = await tx.page.update({
          where: { id: found.page.id },
          data: {
            ...(title === undefined ? {} : { title }),
            ...(icon === undefined ? {} : { icon }),
          },
          select: PAGE_SELECT,
        });
        if (title !== undefined && title !== found.page.title) {
          await logActivity(tx, {
            workspaceId: found.page.workspaceId,
            actorId: user.id,
            action: 'page.renamed',
            pageId: found.page.id,
            at: now,
          });
        }
        return updated;
      });
      return reply.send(successEnvelope({ page: toPageDto(page, found.role) }));
    },
  );

  // ───────────── PAGE-05 Move ─────────────
  app.post(
    '/api/v1/pages/:pageId/move',
    {
      schema: {
        params: pageParamsSchema,
        body: movePageRequestSchema,
        response: { 200: pageResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { parentId: newParentId, afterPageId } = request.body;
      const now = clock();
      const found = await access.pageAccess(user.id, request.params.pageId);
      access.requirePageRole(found, 'EDITOR');
      const { workspaceId } = found.page;
      const pageId = found.page.id;
      await access.authorizeDestination(user.id, workspaceId, newParentId);
      if (newParentId === pageId || afterPageId === pageId) throw invalidMove();

      await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const current = await tx.page.findUnique({
          where: { id: pageId },
          select: { parentId: true, deletedAt: true },
        });
        if (current === null || current.deletedAt !== null) throw notFound();

        let parentDepth = 0;
        if (newParentId !== null) {
          const parent = await tx.page.findUnique({
            where: { id: newParentId },
            select: { workspaceId: true, deletedAt: true },
          });
          if (parent === null || parent.workspaceId !== workspaceId || parent.deletedAt !== null) {
            throw invalidMove();
          }
          const chain = await ancestorChain(tx, newParentId);
          // Moving under itself or one of its own descendants would create a cycle.
          if (chain.some((entry) => entry.id === pageId)) throw invalidMove();
          parentDepth = chain.length;
        }
        const subtree = await subtreeDepths(tx, pageId);
        const height = subtree.reduce((max, entry) => Math.max(max, entry.depth), 1);
        if (parentDepth + height > MAX_PAGE_DEPTH) throw invalidMove();

        const placement = planPlacement(
          await listSiblings(tx, workspaceId, newParentId, pageId),
          afterPageId,
        );
        await applyPlacementUpdates(tx, placement);
        await tx.page.update({
          where: { id: pageId },
          data: { parentId: newParentId, position: placement.position },
          select: { id: true },
        });
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'page.moved',
          pageId,
          metadata: { from: current.parentId, to: newParentId },
          at: now,
        });
      });

      await publishAccessEvents(redis, request.log, [
        { type: 'page.access_changed', workspaceId, pageId, at: now },
      ]);
      const page = await prisma.page.findUniqueOrThrow({
        where: { id: pageId },
        select: PAGE_SELECT,
      });
      return reply.send(
        successEnvelope({ page: toPageDto(page, await roleAfterChange(user.id, pageId)) }),
      );
    },
  );

  // ───────────── PAGE-06 Delete (soft, whole subtree) ─────────────
  app.delete(
    '/api/v1/pages/:pageId',
    {
      schema: { params: pageParamsSchema, response: { 200: pageDeletedResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const now = clock();
      const found = await access.pageAccess(user.id, request.params.pageId);
      access.requirePageRole(found, 'EDITOR');
      const { workspaceId } = found.page;
      const pageId = found.page.id;
      const deleteBatchId = randomUUID();

      await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const ids = await liveSubtreeIds(tx, pageId);
        if (ids.length === 0) throw notFound();
        // Descendants deleted earlier keep their own batch, so restoring this batch leaves them.
        await tx.page.updateMany({
          where: { id: { in: ids } },
          data: { deletedAt: now, deletedById: user.id, deleteBatchId },
        });
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'page.deleted',
          pageId,
          metadata: { deleteBatchId, pages: ids.length },
          at: now,
        });
      });

      await publishAccessEvents(redis, request.log, [
        { type: 'page.access_changed', workspaceId, pageId, at: now },
      ]);
      return reply.send(successEnvelope({ deleteBatchId }));
    },
  );

  // ───────────── PAGE-07 Restore ─────────────
  app.post(
    '/api/v1/pages/:pageId/restore',
    {
      schema: { params: pageParamsSchema, response: { 200: pageResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const now = clock();
      // Effective role is computed ignoring the deleted flag.
      const found = await access.pageAccess(user.id, request.params.pageId, {
        includeDeleted: true,
      });
      access.requirePageRole(found, 'EDITOR');
      if (found.page.deletedAt === null) throw new AppError('CONFLICT', 'The page is not deleted.');
      const { workspaceId } = found.page;
      const pageId = found.page.id;

      await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const current = await tx.page.findUnique({
          where: { id: pageId },
          select: { parentId: true, deletedAt: true, deleteBatchId: true },
        });
        if (current === null) throw notFound();
        if (current.deletedAt === null) throw new AppError('CONFLICT', 'The page is not deleted.');

        const ids =
          current.deleteBatchId === null
            ? [pageId]
            : await batchSubtreeIds(tx, pageId, current.deleteBatchId);

        // Back under the original parent when it is alive and the depth limit allows;
        // otherwise as a workspace root (PAGE-07).
        let targetParent: string | null = null;
        if (current.parentId !== null) {
          const parent = await tx.page.findUnique({
            where: { id: current.parentId },
            select: { deletedAt: true },
          });
          if (parent !== null && parent.deletedAt === null) {
            const chain = await ancestorChain(tx, current.parentId);
            const subtree = await subtreeDepths(tx, pageId);
            const height = subtree.reduce((max, entry) => Math.max(max, entry.depth), 1);
            if (chain.length + height <= MAX_PAGE_DEPTH) targetParent = current.parentId;
          }
        }
        // Always placed last: the old key may collide with siblings added since.
        const placement = planPlacement(
          await listSiblings(tx, workspaceId, targetParent),
          undefined,
        );
        await applyPlacementUpdates(tx, placement);
        await tx.page.updateMany({
          where: { id: { in: ids } },
          data: { deletedAt: null, deletedById: null, deleteBatchId: null },
        });
        await tx.page.update({
          where: { id: pageId },
          data: { parentId: targetParent, position: placement.position },
          select: { id: true },
        });
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'page.restored',
          pageId,
          metadata: { pages: ids.length, parentId: targetParent },
          at: now,
        });
      });

      const page = await prisma.page.findUniqueOrThrow({
        where: { id: pageId },
        select: PAGE_SELECT,
      });
      return reply.send(
        successEnvelope({ page: toPageDto(page, await roleAfterChange(user.id, pageId)) }),
      );
    },
  );

  // ───────────── PAGE-08 Trash ─────────────
  app.get(
    '/api/v1/workspaces/:workspaceId/trash',
    {
      schema: {
        params: workspaceParamsSchema,
        querystring: paginationQuerySchema,
        response: { 200: trashListResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const { limit, cursor } = request.query;
      const workspaceRole = await access.requireWorkspaceRole(user.id, workspaceId, 'EDITOR');

      const [pages, overrides] = await Promise.all([
        prisma.page.findMany({ where: { workspaceId }, select: PAGE_SELECT }),
        prisma.pagePermission.findMany({
          where: { userId: user.id, page: { workspaceId } },
          select: { pageId: true, role: true },
        }),
      ]);
      const byId = new Map(pages.map((p) => [p.id, p]));
      const roles = computeEffectiveRoles(
        pages,
        workspaceRole,
        new Map(overrides.map((o) => [o.pageId, o.role])),
      );
      // Batch roots: deleted pages whose parent was not deleted in the same operation.
      const roots = pages.filter((page) => {
        if (page.deletedAt === null) return false;
        const parent = page.parentId === null ? undefined : byId.get(page.parentId);
        const insideBatch =
          parent !== undefined &&
          parent.deletedAt !== null &&
          parent.deleteBatchId === page.deleteBatchId;
        return !insideBatch && roleAtLeast(roles.get(page.id) ?? 'NONE', 'EDITOR');
      });
      roots.sort((a, b) => {
        const at = (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0);
        return at !== 0 ? at : a.id < b.id ? 1 : -1;
      });
      const after = cursor === undefined ? undefined : decodeCursor(cursor);
      const remaining =
        after === undefined
          ? roots
          : roots.filter((page) => {
              const t = page.deletedAt?.getTime() ?? 0;
              return t < after.at.getTime() || (t === after.at.getTime() && page.id < after.id);
            });
      const { items, nextCursor } = pageOf(
        remaining.slice(0, limit + 1),
        limit,
        (page) => page.deletedAt ?? page.createdAt,
      );
      return reply.send(
        successEnvelope(
          { pages: items.map((page) => toPageDto(page, roles.get(page.id) ?? 'NONE')) },
          { nextCursor },
        ),
      );
    },
  );

  // ───────────── PAGE-09 Purge (permanent) ─────────────
  app.post(
    '/api/v1/pages/:pageId/purge',
    {
      schema: { params: pageParamsSchema, response: { 200: nullResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const now = clock();
      const page = await prisma.page.findUnique({
        where: { id: request.params.pageId },
        select: { id: true, workspaceId: true, deletedAt: true },
      });
      if (page === null) throw notFound();
      const role = await access.membership(prisma, page.workspaceId, user.id);
      if (role === null) throw notFound();
      if (!workspaceRoleAtLeast(role, 'ADMIN')) {
        throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
      }
      if (page.deletedAt === null) {
        throw new AppError('CONFLICT', 'Only a deleted page can be purged.');
      }

      await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, page.workspaceId);
        // The page row disappears, so the log keeps its id in metadata only.
        await logActivity(tx, {
          workspaceId: page.workspaceId,
          actorId: user.id,
          action: 'page.purged',
          metadata: { pageId: page.id },
          at: now,
        });
        // Cascades to descendants, overrides and (in later phases) document data.
        await tx.page.delete({ where: { id: page.id }, select: { id: true } });
      });
      return reply.send(successEnvelope(null));
    },
  );
}
