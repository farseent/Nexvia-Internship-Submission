import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { isUniqueConstraintError } from '@conote/db';
import {
  AppError,
  INVITATION_TTL_DAYS,
  buildInviteUrl,
  canInviteWithRole,
  createInvitationRequestSchema,
  invitationCreatedResponseSchema,
  invitationListQuerySchema,
  invitationListResponseSchema,
  invitationParamsSchema,
  invitationPreviewResponseSchema,
  invitationTokenRequestSchema,
  maskEmail,
  nullResponseSchema,
  successEnvelope,
  workspaceParamsSchema,
  workspaceResponseSchema,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { generateSessionToken, hashToken } from '../auth/tokens.js';
import { rateLimitConfig } from '../plugins/security.js';
import { type AccessService, lockWorkspace } from '../workspaces/access.js';
import { logActivity } from '../workspaces/activity.js';
import { USER_SUMMARY_SELECT, toInvitationDto, toWorkspaceDto } from '../workspaces/dto.js';
import { afterCursor, decodeCursor, pageOf } from '../workspaces/pagination.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  invitedBy: { select: USER_SUMMARY_SELECT },
} as const;

/** One generic answer for every unusable token, so the response never says why (D30). */
const invalidInvitation = () => new AppError('INVITATION_INVALID', 'The invitation is invalid.');

/** INV-05: unauthenticated; the invitation token is the bearer credential. */
export async function registerInvitationPublicRoutes(
  root: FastifyInstance,
  { prisma, clock }: Dependencies,
  config: ApiConfig,
): Promise<void> {
  const app = root.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/api/v1/invitations/preview',
    {
      schema: {
        body: invitationTokenRequestSchema,
        response: { 200: invitationPreviewResponseSchema },
      },
      config: { rateLimit: rateLimitConfig(config.rateLimits.invitation) },
    },
    async (request, reply) => {
      const invitation = await prisma.invitation.findUnique({
        where: { tokenHash: hashToken(request.body.token) },
        select: {
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          workspace: { select: { name: true } },
          invitedBy: { select: { displayName: true } },
        },
      });
      if (
        invitation === null ||
        invitation.status !== 'PENDING' ||
        invitation.expiresAt.getTime() <= clock().getTime()
      ) {
        throw invalidInvitation();
      }
      return reply.send(
        successEnvelope({
          workspaceName: invitation.workspace.name,
          role: invitation.role as 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER',
          invitedBy: invitation.invitedBy === null ? null : invitation.invitedBy.displayName,
          emailHint: maskEmail(invitation.email),
        }),
      );
    },
  );
}

/** INV-01 … INV-04, INV-06 and INV-07 (decline). Registered inside the authenticated scope. */
export async function registerInvitationRoutes(
  scope: FastifyInstance,
  { prisma, clock }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const general = { rateLimit: rateLimitConfig(config.rateLimits.general) };
  const strict = { rateLimit: rateLimitConfig(config.rateLimits.invitation) };

  const expiryFrom = (now: Date): Date => new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS);

  // ───────────── INV-01 Create ─────────────
  app.post(
    '/api/v1/workspaces/:workspaceId/invitations',
    {
      schema: {
        params: workspaceParamsSchema,
        body: createInvitationRequestSchema,
        response: { 201: invitationCreatedResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const { email, role } = request.body;
      const now = clock();

      const actorRole = await access.requireWorkspaceRole(user.id, workspaceId, 'ADMIN');
      if (!canInviteWithRole(actorRole, role)) {
        throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
      }

      const token = generateSessionToken();
      let invitation;
      try {
        invitation = await prisma.$transaction(async (tx) => {
          await lockWorkspace(tx, workspaceId);
          const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
          if (existingUser !== null) {
            const membership = await access.membership(tx, workspaceId, existingUser.id);
            if (membership !== null) throw new AppError('ALREADY_MEMBER', 'Already a member.');
          }
          // An expired PENDING row would block the one-pending-per-email index: retire it.
          await tx.invitation.updateMany({
            where: { workspaceId, email, status: 'PENDING', expiresAt: { lte: now } },
            data: { status: 'REVOKED', revokedAt: now },
          });
          const pending = await tx.invitation.findFirst({
            where: { workspaceId, email, status: 'PENDING' },
            select: { id: true },
          });
          if (pending !== null) {
            throw new AppError('INVITATION_EXISTS', 'A pending invitation already exists.');
          }
          const created = await tx.invitation.create({
            data: {
              workspaceId,
              email,
              role,
              tokenHash: hashToken(token),
              invitedById: user.id,
              expiresAt: expiryFrom(now),
              createdAt: now,
            },
            select: INVITATION_SELECT,
          });
          await logActivity(tx, {
            workspaceId,
            actorId: user.id,
            action: 'member.invited',
            metadata: { invitationId: created.id, role },
            at: now,
          });
          return created;
        });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new AppError('INVITATION_EXISTS', 'A pending invitation already exists.');
        }
        throw err;
      }

      return reply.code(201).send(
        successEnvelope({
          invitation: toInvitationDto(invitation, now),
          inviteUrl: buildInviteUrl(config.appUrl, token),
        }),
      );
    },
  );

  // ───────────── INV-02 List ─────────────
  app.get(
    '/api/v1/workspaces/:workspaceId/invitations',
    {
      schema: {
        params: workspaceParamsSchema,
        querystring: invitationListQuerySchema,
        response: { 200: invitationListResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId } = request.params;
      const { status, limit, cursor } = request.query;
      const now = clock();
      await access.requireWorkspaceRole(user.id, workspaceId, 'ADMIN');

      // EXPIRED is derived: a PENDING row whose expiry has passed.
      const statusFilter =
        status === undefined
          ? {}
          : status === 'PENDING'
            ? { status: 'PENDING' as const, expiresAt: { gt: now } }
            : status === 'EXPIRED'
              ? { status: 'PENDING' as const, expiresAt: { lte: now } }
              : { status };
      const rows = await prisma.invitation.findMany({
        where: {
          workspaceId,
          ...statusFilter,
          ...afterCursor(cursor === undefined ? undefined : decodeCursor(cursor)),
        },
        select: INVITATION_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const { items, nextCursor } = pageOf(rows, limit, (row) => row.createdAt);
      return reply.send(
        successEnvelope(
          { invitations: items.map((row) => toInvitationDto(row, now)) },
          { nextCursor },
        ),
      );
    },
  );

  // ───────────── INV-03 Revoke ─────────────
  app.delete(
    '/api/v1/workspaces/:workspaceId/invitations/:invitationId',
    {
      schema: { params: invitationParamsSchema, response: { 200: nullResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId, invitationId } = request.params;
      const now = clock();
      const actorRole = await access.requireWorkspaceRole(user.id, workspaceId, 'ADMIN');

      await prisma.$transaction(async (tx) => {
        const invitation = await tx.invitation.findFirst({
          where: { id: invitationId, workspaceId },
          select: { status: true, role: true },
        });
        if (invitation === null) throw new AppError('NOT_FOUND', 'Resource not found.');
        if (!canInviteWithRole(actorRole, invitation.role as 'ADMIN' | 'EDITOR')) {
          throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
        }
        const revoked = await tx.invitation.updateMany({
          where: { id: invitationId, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: now },
        });
        if (revoked.count === 0) {
          throw new AppError('CONFLICT', 'The invitation is not pending.');
        }
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'invitation.revoked',
          metadata: { invitationId },
          at: now,
        });
      });
      return reply.send(successEnvelope(null));
    },
  );

  // ───────────── INV-04 Resend (rotate the token) ─────────────
  app.post(
    '/api/v1/workspaces/:workspaceId/invitations/:invitationId/resend',
    {
      schema: {
        params: invitationParamsSchema,
        response: { 200: invitationCreatedResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { workspaceId, invitationId } = request.params;
      const now = clock();
      const actorRole = await access.requireWorkspaceRole(user.id, workspaceId, 'ADMIN');
      const token = generateSessionToken();

      const invitation = await prisma.$transaction(async (tx) => {
        const current = await tx.invitation.findFirst({
          where: { id: invitationId, workspaceId },
          select: { status: true, role: true },
        });
        if (current === null) throw new AppError('NOT_FOUND', 'Resource not found.');
        if (!canInviteWithRole(actorRole, current.role as 'ADMIN' | 'EDITOR')) {
          throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
        }
        const updated = await tx.invitation.updateMany({
          where: { id: invitationId, status: 'PENDING' },
          data: { tokenHash: hashToken(token), expiresAt: expiryFrom(now) },
        });
        if (updated.count === 0) throw new AppError('CONFLICT', 'The invitation is not pending.');
        await logActivity(tx, {
          workspaceId,
          actorId: user.id,
          action: 'invitation.resent',
          metadata: { invitationId },
          at: now,
        });
        return tx.invitation.findUniqueOrThrow({
          where: { id: invitationId },
          select: INVITATION_SELECT,
        });
      });
      return reply.send(
        successEnvelope({
          invitation: toInvitationDto(invitation, now),
          inviteUrl: buildInviteUrl(config.appUrl, token),
        }),
      );
    },
  );

  // ───────────── INV-06 Accept ─────────────
  app.post(
    '/api/v1/invitations/accept',
    {
      schema: { body: invitationTokenRequestSchema, response: { 200: workspaceResponseSchema } },
      config: strict,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const now = clock();
      const found = await prisma.invitation.findUnique({
        where: { tokenHash: hashToken(request.body.token) },
        select: {
          id: true,
          workspaceId: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
        },
      });
      // One generic error for unknown, used, expired, revoked and wrong-account invitations.
      if (
        found === null ||
        found.status !== 'PENDING' ||
        found.expiresAt.getTime() <= now.getTime() ||
        found.email !== user.email
      ) {
        throw invalidInvitation();
      }

      const workspace = await prisma.$transaction(async (tx) => {
        await lockWorkspace(tx, found.workspaceId);
        // Single use: only one concurrent accept can flip PENDING → ACCEPTED.
        const claimed = await tx.invitation.updateMany({
          where: { id: found.id, status: 'PENDING', expiresAt: { gt: now } },
          data: { status: 'ACCEPTED', acceptedById: user.id, acceptedAt: now },
        });
        if (claimed.count === 0) throw invalidInvitation();

        const existing = await access.membership(tx, found.workspaceId, user.id);
        if (existing === null) {
          await tx.workspaceMember.create({
            data: { workspaceId: found.workspaceId, userId: user.id, role: found.role },
            select: { id: true },
          });
          await logActivity(tx, {
            workspaceId: found.workspaceId,
            actorId: user.id,
            action: 'member.joined',
            metadata: { invitationId: found.id, role: found.role },
            at: now,
          });
        }
        const row = await tx.workspace.findUniqueOrThrow({
          where: { id: found.workspaceId },
          select: { id: true, name: true, createdAt: true, updatedAt: true },
        });
        return { row, role: existing ?? found.role };
      });
      return reply.send(
        successEnvelope({ workspace: toWorkspaceDto(workspace.row, workspace.role) }),
      );
    },
  );

  // ───────────── INV-07 Decline (the invitee's "reject", DECISIONS D48) ─────────────
  app.post(
    '/api/v1/invitations/decline',
    {
      schema: { body: invitationTokenRequestSchema, response: { 200: nullResponseSchema } },
      config: strict,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const now = clock();
      const found = await prisma.invitation.findUnique({
        where: { tokenHash: hashToken(request.body.token) },
        select: { id: true, workspaceId: true, email: true, status: true, expiresAt: true },
      });
      if (
        found === null ||
        found.status !== 'PENDING' ||
        found.expiresAt.getTime() <= now.getTime() ||
        found.email !== user.email
      ) {
        throw invalidInvitation();
      }
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.invitation.updateMany({
          where: { id: found.id, status: 'PENDING' },
          data: { status: 'DECLINED', revokedAt: now },
        });
        if (claimed.count === 0) throw invalidInvitation();
        await logActivity(tx, {
          workspaceId: found.workspaceId,
          actorId: user.id,
          action: 'member.declined',
          metadata: { invitationId: found.id },
          at: now,
        });
      });
      return reply.send(successEnvelope(null));
    },
  );
}
