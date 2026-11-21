import { z } from 'zod';
import { successEnvelopeSchema } from './auth.js';
import { paginationQuerySchema, userSummarySchema } from './workspaces.js';

/**
 * Comment and version-history schemas (docs/API_CONTRACTS.md §10, §11; D8, D9).
 * Pure: no I/O, no Yjs. Request schemas reject unknown fields.
 */

export const COMMENT_BODY_MAX_LENGTH = 5000;
export const QUOTED_TEXT_MAX_LENGTH = 500;
export const SNAPSHOT_LABEL_MAX = 120;
/** An encoded Yjs relative position is a few dozen bytes; the limit only stops abuse. */
export const ANCHOR_MAX_BYTES = 512;
export const THREAD_STATUSES = ['open', 'resolved', 'all'] as const;
export const SNAPSHOT_KINDS = ['AUTO', 'MANUAL', 'PRE_RESTORE'] as const;
export const ANCHOR_STATUSES = ['ACTIVE', 'DETACHED'] as const;

/** Redis channel for page events (WEBSOCKET_PROTOCOL §10); at-most-once, never a source of truth. */
export const PAGE_EVENTS_CHANNEL = 'conote:events:page';

export const pageEventSchema = z.object({
  v: z.literal(1),
  type: z.enum(['comments.changed', 'document.restored']),
  pageId: z.uuid(),
  at: z.string().max(40),
});
export type PageEvent = z.infer<typeof pageEventSchema>;

// ───────────── Anchors ─────────────

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Base64 of an encoded Yjs relative position; opaque to the API (D8). */
export const anchorBytesSchema = z
  .string()
  .min(1)
  .max(Math.ceil((ANCHOR_MAX_BYTES * 4) / 3) + 4)
  .regex(BASE64_PATTERN, { error: 'The anchor is not valid base64' })
  .refine((value) => Buffer.from(value, 'base64').length <= ANCHOR_MAX_BYTES, {
    error: 'The anchor is too large',
  });

export const commentBodySchema = z
  .string()
  .trim()
  .min(1, { error: 'Write a comment' })
  .max(COMMENT_BODY_MAX_LENGTH, { error: `Use at most ${COMMENT_BODY_MAX_LENGTH} characters` });

export const snapshotLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(SNAPSHOT_LABEL_MAX, { error: `Use at most ${SNAPSHOT_LABEL_MAX} characters` });

// ───────────── Params and query ─────────────

export const threadParamsSchema = z.strictObject({ threadId: z.uuid() });
export const commentParamsSchema = z.strictObject({ commentId: z.uuid() });
export const versionParamsSchema = z.strictObject({ pageId: z.uuid(), versionId: z.uuid() });

export const threadListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(THREAD_STATUSES).default('open'),
});
export const versionListQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(SNAPSHOT_KINDS).optional(),
});

// ───────────── Requests ─────────────

export const createThreadRequestSchema = z.strictObject({
  anchor: z.strictObject({ start: anchorBytesSchema, end: anchorBytesSchema }),
  quotedText: z.string().max(QUOTED_TEXT_MAX_LENGTH),
  body: commentBodySchema,
});
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

export const createCommentRequestSchema = z.strictObject({ body: commentBodySchema });
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

// ───────────── Responses ─────────────

export const commentSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  author: userSummarySchema.nullable(),
  body: z.string(),
  createdAt: z.string(),
});
export type CommentDto = z.infer<typeof commentSchema>;

export const threadSchema = z.object({
  id: z.uuid(),
  pageId: z.uuid(),
  anchor: z.object({ start: z.string(), end: z.string() }),
  quotedText: z.string(),
  anchorStatus: z.enum(ANCHOR_STATUSES),
  createdBy: userSummarySchema.nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: userSummarySchema.nullable(),
  comments: z.array(commentSchema),
});
export type ThreadDto = z.infer<typeof threadSchema>;

export const versionMetaSchema = z.object({
  id: z.uuid(),
  pageId: z.uuid(),
  kind: z.enum(SNAPSHOT_KINDS),
  label: z.string().nullable(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
  createdBy: userSummarySchema.nullable(),
  contributors: z.array(userSummarySchema),
});
export type VersionMetaDto = z.infer<typeof versionMetaSchema>;

const listMetaSchema = z.object({ nextCursor: z.string().nullable() });
function envelopeWithMeta<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data, meta: listMetaSchema.optional() });
}

export const threadListResponseSchema = envelopeWithMeta(
  z.object({ threads: z.array(threadSchema) }),
);
export const threadResponseSchema = successEnvelopeSchema(z.object({ thread: threadSchema }));
export const commentResponseSchema = successEnvelopeSchema(z.object({ comment: commentSchema }));
export const versionListResponseSchema = envelopeWithMeta(
  z.object({ versions: z.array(versionMetaSchema) }),
);
export const versionResponseSchema = successEnvelopeSchema(
  z.object({ version: versionMetaSchema }),
);

/** Encode / decode anchors for transport (JSON carries base64). */
export function anchorToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
export function anchorFromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}
