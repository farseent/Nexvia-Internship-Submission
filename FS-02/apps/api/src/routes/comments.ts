import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@conote/db';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AppError,
  anchorFromBase64,
  anchorToBase64,
  commentParamsSchema,
  commentResponseSchema,
  createCommentRequestSchema,
  createThreadRequestSchema,
  nullResponseSchema,
  pageParamsSchema,
  successEnvelope,
  threadListQuerySchema,
  threadListResponseSchema,
  threadParamsSchema,
  threadResponseSchema,
  workspaceRoleAtLeast,
  type CommentDto,
  type ThreadDto,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { authOf } from '../auth/guard.js';
import { rateLimitConfig } from '../plugins/security.js';
import { type AccessService } from '../workspaces/access.js';
import { logActivity } from '../workspaces/activity.js';
import { USER_SUMMARY_SELECT, toUserSummary } from '../workspaces/dto.js';
import { publishPageEvent } from '../workspaces/page-events.js';
import { afterCursor, decodeCursor, pageOf } from '../workspaces/pagination.js';

const COMMENT_SELECT = {
  id: true,
  threadId: true,
  body: true,
  createdAt: true,
  author: { select: USER_SUMMARY_SELECT },
} satisfies Prisma.CommentSelect;

const THREAD_SELECT = {
  id: true,
  pageId: true,
  anchorStart: true,
  anchorEnd: true,
  quotedText: true,
  anchorStatus: true,
  createdAt: true,
  resolvedAt: true,
  createdBy: { select: USER_SUMMARY_SELECT },
  resolvedBy: { select: USER_SUMMARY_SELECT },
  // Deleted comments are never returned (DATABASE_SCHEMA §4.5).
  comments: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: COMMENT_SELECT,
  },
} satisfies Prisma.CommentThreadSelect;

type UserRow = Parameters<typeof toUserSummary>[0];
interface CommentRow {
  id: string;
  threadId: string;
  body: string;
  createdAt: Date;
  author: UserRow | null;
}
interface ThreadRow {
  id: string;
  pageId: string;
  anchorStart: Uint8Array;
  anchorEnd: Uint8Array;
  quotedText: string;
  anchorStatus: 'ACTIVE' | 'DETACHED';
  createdAt: Date;
  resolvedAt: Date | null;
  createdBy: UserRow | null;
  resolvedBy: UserRow | null;
  comments: CommentRow[];
}

export function toCommentDto(row: CommentRow): CommentDto {
  return {
    id: row.id,
    threadId: row.threadId,
    author: row.author === null ? null : toUserSummary(row.author),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toThreadDto(row: ThreadRow): ThreadDto {
  return {
    id: row.id,
    pageId: row.pageId,
    anchor: { start: anchorToBase64(row.anchorStart), end: anchorToBase64(row.anchorEnd) },
    quotedText: row.quotedText,
    anchorStatus: row.anchorStatus,
    createdBy: row.createdBy === null ? null : toUserSummary(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
    resolvedBy: row.resolvedBy === null ? null : toUserSummary(row.resolvedBy),
    comments: row.comments.map(toCommentDto),
  };
}

/**
 * CMT-01 … CMT-06 (docs/API_CONTRACTS.md §10, D8). Comments are REST operations, so a Commenter
 * on a read-only collaboration connection can use them. Registered inside the authenticated scope.
 * Every operation resolves the page and the caller's role through the shared permission
 * functions; a thread or comment on a page the caller cannot see is reported as missing.
 */
export async function registerCommentRoutes(
  scope: FastifyInstance,
  { prisma, redis, clock }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const general = { rateLimit: rateLimitConfig(config.rateLimits.general) };

  /** The page of a thread, authorized for `PAGE≥COMMENTER`; 404 when thread or page is invisible. */
  async function threadPageAccess(userId: string, threadId: string) {
    const thread = await prisma.commentThread.findUnique({
      where: { id: threadId },
      select: { id: true, pageId: true },
    });
    if (thread === null) throw new AppError('NOT_FOUND', 'Resource not found.');
    const found = await access.pageAccess(userId, thread.pageId);
    return { thread, found };
  }

  const loadThread = async (id: string): Promise<ThreadRow> => {
    return prisma.commentThread.findUniqueOrThrow({ where: { id }, select: THREAD_SELECT });
  };

  // ───────────── CMT-01 List threads ─────────────
  app.get(
    '/api/v1/pages/:pageId/threads',
    {
      schema: {
        params: pageParamsSchema,
        querystring: threadListQuerySchema,
        response: { 200: threadListResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const found = await access.pageAccess(user.id, request.params.pageId);
      const { status, limit, cursor } = request.query;
      const rows = await prisma.commentThread.findMany({
        where: {
          pageId: found.page.id,
          // A thread whose comments were all deleted is gone (DATABASE_SCHEMA §4.5).
          comments: { some: { deletedAt: null } },
          ...(status === 'open' ? { resolvedAt: null } : {}),
          ...(status === 'resolved' ? { resolvedAt: { not: null } } : {}),
          ...afterCursor(cursor === undefined ? undefined : decodeCursor(cursor)),
        },
        select: THREAD_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const { items, nextCursor } = pageOf(rows, limit, (row) => row.createdAt);
      return reply.send(successEnvelope({ threads: items.map(toThreadDto) }, { nextCursor }));
    },
  );

  // ───────────── CMT-02 Create thread ─────────────
  app.post(
    '/api/v1/pages/:pageId/threads',
    {
      schema: {
        params: pageParamsSchema,
        body: createThreadRequestSchema,
        response: { 201: threadResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const found = await access.pageAccess(user.id, request.params.pageId);
      access.requirePageRole(found, 'COMMENTER');
      const { anchor, quotedText, body } = request.body;
      const now = clock();
      const created = await prisma.$transaction(async (tx) => {
        const thread = await tx.commentThread.create({
          data: {
            pageId: found.page.id,
            anchorStart: new Uint8Array(anchorFromBase64(anchor.start)),
            anchorEnd: new Uint8Array(anchorFromBase64(anchor.end)),
            quotedText,
            createdById: user.id,
            createdAt: now,
            comments: { create: { authorId: user.id, body, createdAt: now } },
          },
          select: { id: true },
        });
        await logActivity(tx, {
          workspaceId: found.page.workspaceId,
          actorId: user.id,
          action: 'comment.thread_created',
          pageId: found.page.id,
          metadata: { threadId: thread.id },
          at: now,
        });
        return thread;
      });
      await publishPageEvent(redis, request.log, {
        type: 'comments.changed',
        pageId: found.page.id,
        at: now,
      });
      return reply
        .status(201)
        .send(successEnvelope({ thread: toThreadDto(await loadThread(created.id)) }));
    },
  );

  // ───────────── CMT-03 Reply ─────────────
  app.post(
    '/api/v1/threads/:threadId/comments',
    {
      schema: {
        params: threadParamsSchema,
        body: createCommentRequestSchema,
        response: { 201: commentResponseSchema },
      },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { thread, found } = await threadPageAccess(user.id, request.params.threadId);
      access.requirePageRole(found, 'COMMENTER');
      const now = clock();
      const comment = await prisma.comment.create({
        data: { threadId: thread.id, authorId: user.id, body: request.body.body, createdAt: now },
        select: COMMENT_SELECT,
      });
      await publishPageEvent(redis, request.log, {
        type: 'comments.changed',
        pageId: thread.pageId,
        at: now,
      });
      return reply.status(201).send(successEnvelope({ comment: toCommentDto(comment) }));
    },
  );

  // ───────────── CMT-04 Resolve / CMT-05 Reopen ─────────────
  async function changeResolved(request: FastifyRequest, threadId: string, resolve: boolean) {
    const { user } = authOf(request);
    const { thread, found } = await threadPageAccess(user.id, threadId);
    access.requirePageRole(found, 'COMMENTER');
    const now = clock();
    const changed = await prisma.$transaction(async (tx) => {
      const current = await tx.commentThread.findUniqueOrThrow({
        where: { id: thread.id },
        select: { resolvedAt: true },
      });
      if ((current.resolvedAt !== null) === resolve) return false; // idempotent
      await tx.commentThread.update({
        where: { id: thread.id },
        data: resolve
          ? { resolvedAt: now, resolvedById: user.id }
          : { resolvedAt: null, resolvedById: null },
      });
      await logActivity(tx, {
        workspaceId: found.page.workspaceId,
        actorId: user.id,
        action: resolve ? 'comment.thread_resolved' : 'comment.thread_reopened',
        pageId: thread.pageId,
        metadata: { threadId: thread.id },
        at: now,
      });
      return true;
    });
    if (changed) {
      await publishPageEvent(redis, request.log, {
        type: 'comments.changed',
        pageId: thread.pageId,
        at: now,
      });
    }
    return successEnvelope({ thread: toThreadDto(await loadThread(thread.id)) });
  }

  app.post(
    '/api/v1/threads/:threadId/resolve',
    {
      schema: { params: threadParamsSchema, response: { 200: threadResponseSchema } },
      config: general,
    },
    async (request, reply) =>
      reply.send(await changeResolved(request, request.params.threadId, true)),
  );
  app.post(
    '/api/v1/threads/:threadId/reopen',
    {
      schema: { params: threadParamsSchema, response: { 200: threadResponseSchema } },
      config: general,
    },
    async (request, reply) =>
      reply.send(await changeResolved(request, request.params.threadId, false)),
  );

  // ───────────── CMT-06 Delete comment ─────────────
  app.delete(
    '/api/v1/comments/:commentId',
    {
      schema: { params: commentParamsSchema, response: { 200: nullResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const comment = await prisma.comment.findUnique({
        where: { id: request.params.commentId },
        select: { id: true, authorId: true, deletedAt: true, thread: { select: { pageId: true } } },
      });
      if (comment === null || comment.deletedAt !== null) {
        throw new AppError('NOT_FOUND', 'Resource not found.');
      }
      const found = await access.pageAccess(user.id, comment.thread.pageId);
      const isAuthor = comment.authorId === user.id;
      const isAdmin = workspaceRoleAtLeast(found.workspaceRole, 'ADMIN');
      // The author needs to still be able to comment; admins may remove any comment.
      if (isAuthor) access.requirePageRole(found, 'COMMENTER');
      else if (!isAdmin) throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
      const now = clock();
      const result = await prisma.comment.updateMany({
        where: { id: comment.id, deletedAt: null },
        data: { deletedAt: now, deletedById: user.id },
      });
      if (result.count === 0) throw new AppError('NOT_FOUND', 'Resource not found.');
      await publishPageEvent(redis, request.log, {
        type: 'comments.changed',
        pageId: comment.thread.pageId,
        at: now,
      });
      return reply.send(successEnvelope(null));
    },
  );
}
