import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AppError,
  WORKSPACE_ROLES,
  decideRemoval,
  decideRoleChange,
  createWorkspaceRequestSchema,
  deleteWorkspaceRequestSchema,
  memberListResponseSchema,
  memberParamsSchema,
  memberResponseSchema,
  nullResponseSchema,
  successEnvelope,
  transferOwnershipRequestSchema,
  updateMemberRoleRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceListResponseSchema,
  workspaceParamsSchema,
  workspaceResponseSchema,
  workspaceRoleAtLeast,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { verifyPassword } from '../auth/passwords.js';
import { createAccountLimiter } from '../plugins/account-limiter.js';
import { rateLimitConfig } from '../plugins/security.js';
import { publishAccessEvents } from '../workspaces/access-events.js';
import { type AccessService, lockWorkspace } from '../workspaces/access.js';
import { logActivity } from '../workspaces/activity.js';
import { USER_SUMMARY_SELECT, toMemberDto, toWorkspaceDto } from '../workspaces/dto.js';

const WORKSPACE_SELECT = { id: true, name: true, createdAt: true, updatedAt: true } as const;

/** WS-01 … WS-09 (docs/API_CONTRACTS.md §5). Registered inside the authenticated scope. */
export async function registerWorkspaceRoutes(
  scope: FastifyInstance,
  { prisma, redis, clock }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const general = { rateLimit: rateLimitConfig(config.rateLimits.general) };
  const limitTransfer = createAccountLimiter(scope)(config.rateLimits.password, 'transfer-user');

  // ───────────── WS-01 Create ─────────────
  app.post(
    '/api/v1/workspaces',
    {
      schema: { body: createWorkspaceRequestSchema, response: { 201: workspaceResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const now = clock();
      const workspace = await prisma.$transaction(async (tx) => {
        // The workspace and its OWNER membership are created together; the deferred
        // constraint trigger checks "exactly one owner" at commit.
        const created = await tx.workspace.create({
          data: {
            name: request.body.name,
            createdById: user.id,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
          select: WORKSPACE_SELECT,
        });
        await logActivity(tx, {
          workspaceId: created.id,
          actorId: user.id,
          action: 'workspace.created',
          at: now,
        });
        return created;
      });
      return reply
        .code(201)
        .send(successEnvelope({ workspace: toWorkspaceDto(workspace, 'OWNER') }));
    },
  );

  // ───────────── WS-02 List ─────────────
  app.get(
    '/api/v1/workspaces',
    { schema: { response: { 200: workspaceListResponseSchema } }, config: general },
    async (request, reply) => {
      const { user } = authOf(request);
      const memberships = await prisma.workspaceMember.findMany({
        where: { userId: user.id },
        select: { role: true, workspace: { select: WORKSPACE_SELECT } },
        orderBy: { createdAt: 'asc' },
      });
      return reply.send(
        successEnvelope({
          workspaces: memberships.map((m) => toWorkspaceDto(m.workspace, m.role)),
        }),
      );
    },
  );

  // ───────────── WS-03 Get ─────────────
  app.get(
    '/api/v1/workspaces/:workspaceId',
    {
      schema: { params: workspaceParamsSchema, response: { 200: workspaceResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const role = await access.requireWorkspaceRole(user.id, workspaceId, 'VIEWER');
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: WORKSPACE_SELECT,
      });
      if (workspace === null) throw new AppError('NOT_FOUND', 'Resource not found.');
      return reply.send(successEnvelope({ workspace: toWorkspaceDto(workspace, role) }));
    },
  );

  // ───────────── WS-04 Update ─────────────
  app.patch(
    '/api/v1/workspaces/:workspaceId',
    {
      schema: {
        params: workspaceParamsSchema,
        body: updateWorkspaceRequestSchema,
        response: { 200: workspaceResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const now = clock();
      const role = await access.requireWorkspaceRole(user.id, workspaceId, 'ADMIN');
      const workspace = await prisma.$transaction(async (tx) => {
        const updated = await tx.workspace.update({
          where: { id: workspaceId },
          data: { name: request.body.name },
          select: WORKSPACE_SELECT,
        });
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'workspace.updated',
          at: now,
        });
        return updated;
      });
      return reply.send(successEnvelope({ workspace: toWorkspaceDto(workspace, role) }));
    },
  );

  // ───────────── WS-05 Delete ─────────────
  app.delete(
    '/api/v1/workspaces/:workspaceId',
    {
      schema: {
        params: workspaceParamsSchema,
        body: deleteWorkspaceRequestSchema,
        response: { 200: nullResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      await access.requireWorkspaceRole(user.id, workspaceId, 'OWNER');
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true },
      });
      if (workspace === null) throw new AppError('NOT_FOUND', 'Resource not found.');
      // Safeguard: the caller must retype the exact name (the owner only; see WS-05).
      if (request.body.confirmName.trim() !== workspace.name) {
        throw new AppError(
          'VALIDATION_ERROR',
          'The confirmation does not match the workspace name.',
          {
            details: [{ path: 'confirmName', message: 'The name does not match' }],
          },
        );
      }
      await prisma.workspace.delete({ where: { id: workspaceId }, select: { id: true } });
      await publishAccessEvents(redis, request.log, [
        { type: 'workspace.deleted', workspaceId, at: clock() },
      ]);
      return reply.send(successEnvelope(null));
    },
  );

  // ───────────── WS-06 List members ─────────────
  app.get(
    '/api/v1/workspaces/:workspaceId/members',
    {
      schema: { params: workspaceParamsSchema, response: { 200: memberListResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const role = await access.requireWorkspaceRole(user.id, workspaceId, 'VIEWER');
      const includeEmail = workspaceRoleAtLeast(role, 'ADMIN');
      const rows = await prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: {
          role: true,
          createdAt: true,
          user: { select: { ...USER_SUMMARY_SELECT, email: true } },
        },
      });
      rows.sort(
        (a, b) =>
          WORKSPACE_ROLES.indexOf(b.role) - WORKSPACE_ROLES.indexOf(a.role) ||
          a.user.displayName.localeCompare(b.user.displayName) ||
          (a.user.id < b.user.id ? -1 : 1),
      );
      return reply.send(
        successEnvelope({ members: rows.map((row) => toMemberDto(row, includeEmail)) }),
      );
    },
  );

  // ───────────── WS-07 Change a member's role ─────────────
  app.patch(
    '/api/v1/workspaces/:workspaceId/members/:userId',
    {
      schema: {
        params: memberParamsSchema,
        body: updateMemberRoleRequestSchema,
        response: { 200: memberResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId, userId: targetId } = request.params;
      const { role: newRole } = request.body;
      const now = clock();

      const result = await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const actorRole = await access.requireWorkspaceRole(user.id, workspaceId, 'VIEWER', tx);
        if (!workspaceRoleAtLeast(actorRole, 'ADMIN')) {
          throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
        }
        const target = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: targetId } },
          select: { role: true },
        });
        if (target === null) throw new AppError('NOT_FOUND', 'Resource not found.');
        const decision = decideRoleChange(actorRole, target.role, newRole);
        if (decision === 'OWNER_PROTECTED') {
          throw new AppError('OWNER_PROTECTED', 'The owner cannot be removed or demoted.');
        }
        if (decision === 'FORBIDDEN') {
          throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
        }
        const changed = target.role !== newRole;
        const member = await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId: targetId } },
          data: { role: newRole },
          select: {
            role: true,
            createdAt: true,
            user: { select: { ...USER_SUMMARY_SELECT, email: true } },
          },
        });
        if (changed) {
          await logActivity(tx, {
            workspaceId,
            actorId: user.id,
            action: 'member.role_changed',
            metadata: { userId: targetId, from: target.role, to: newRole },
            at: now,
          });
        }
        return { member, changed };
      });

      if (result.changed) {
        await publishAccessEvents(redis, request.log, [
          { type: 'member.role_changed', workspaceId, userId: targetId, at: now },
        ]);
      }
      return reply.send(successEnvelope({ member: toMemberDto(result.member, true) }));
    },
  );

  // ───────────── WS-08 Remove a member / leave ─────────────
  app.delete(
    '/api/v1/workspaces/:workspaceId/members/:userId',
    {
      schema: { params: memberParamsSchema, response: { 200: nullResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId, userId: targetId } = request.params;
      const self = targetId === user.id;
      const now = clock();

      await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        const actorRole = await access.requireWorkspaceRole(user.id, workspaceId, 'VIEWER', tx);
        // Removing someone else needs ADMIN; answer 403 before looking the target up, so a
        // plain member cannot probe who belongs to the workspace.
        if (!self && !workspaceRoleAtLeast(actorRole, 'ADMIN')) {
          throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
        }
        const target = self
          ? { role: actorRole }
          : await tx.workspaceMember.findUnique({
              where: { workspaceId_userId: { workspaceId, userId: targetId } },
              select: { role: true },
            });
        if (target === null) throw new AppError('NOT_FOUND', 'Resource not found.');
        const decision = decideRemoval(actorRole, target.role, self);
        if (decision === 'OWNER_PROTECTED') {
          throw new AppError('OWNER_PROTECTED', 'The owner cannot be removed or demoted.');
        }
        if (decision === 'FORBIDDEN') {
          throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
        }
        // Page overrides of the member in this workspace go with the membership (WS-08).
        await tx.pagePermission.deleteMany({
          where: { userId: targetId, page: { workspaceId } },
        });
        await tx.workspaceMember.delete({
          where: { workspaceId_userId: { workspaceId, userId: targetId } },
          select: { id: true },
        });
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: self ? 'member.left' : 'member.removed',
          metadata: { userId: targetId, role: target.role },
          at: now,
        });
      });

      await publishAccessEvents(redis, request.log, [
        { type: 'member.removed', workspaceId, userId: targetId, at: now },
      ]);
      return reply.send(successEnvelope(null));
    },
  );

  // ───────────── WS-09 Transfer ownership ─────────────
  app.post(
    '/api/v1/workspaces/:workspaceId/transfer-ownership',
    {
      schema: {
        params: workspaceParamsSchema,
        body: transferOwnershipRequestSchema,
        response: { 200: workspaceResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const { userId: targetId, password } = request.body;
      const now = clock();

      await access.requireWorkspaceRole(user.id, workspaceId, 'OWNER');
      if (targetId === user.id) {
        throw new AppError('VALIDATION_ERROR', 'Choose another member.', {
          details: [{ path: 'userId', message: 'Choose another member' }],
        });
      }
      await limitTransfer(request, reply, user.id);

      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      if (row === null || !(await verifyPassword(row.passwordHash, password))) {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
      }

      const workspace = await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, workspaceId);
        // Re-check under the lock: ownership may have changed while the password was verified.
        await access.requireWorkspaceRole(user.id, workspaceId, 'OWNER', tx);
        const target = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: targetId } },
          select: { role: true },
        });
        if (target === null) throw new AppError('NOT_FOUND', 'Resource not found.');
        // The "one owner" unique index is checked per statement, so the current owner steps
        // down first; the deferred trigger verifies exactly one owner again at commit.
        await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId: user.id } },
          data: { role: 'ADMIN' },
          select: { id: true },
        });
        await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId: targetId } },
          data: { role: 'OWNER' },
          select: { id: true },
        });
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'ownership.transferred',
          metadata: { from: user.id, to: targetId },
          at: now,
        });
        return tx.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
          select: WORKSPACE_SELECT,
        });
      });

      await publishAccessEvents(redis, request.log, [
        { type: 'member.role_changed', workspaceId, userId: user.id, at: now },
        { type: 'member.role_changed', workspaceId, userId: targetId, at: now },
      ]);
      return reply.send(successEnvelope({ workspace: toWorkspaceDto(workspace, 'ADMIN') }));
    },
  );
}
