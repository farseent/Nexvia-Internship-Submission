import { z } from 'zod';
import { currentPasswordSchema, emailSchema, successEnvelopeSchema } from './auth.js';
import { ASSIGNABLE_ROLES, PAGE_ACCESS_ROLES, WORKSPACE_ROLES } from './permissions.js';

/**
 * Workspace, membership, invitation, page and permission schemas
 * (docs/API_CONTRACTS.md §2, §5–§8, docs/DATABASE_SCHEMA.md §10; D4, D23, D24, D30).
 * Pure: no I/O. Request schemas reject unknown fields.
 */

export const WORKSPACE_NAME_MAX_LENGTH = 100;
export const PAGE_TITLE_MAX_LENGTH = 200;
export const PAGE_ICON_MAX_LENGTH = 32;
/** Maximum nesting depth: a root page has depth 1 (DATABASE_SCHEMA §4.3, initial limit). */
export const MAX_PAGE_DEPTH = 10;
/** Invitations expire after this many days (D30). */
export const INVITATION_TTL_DAYS = 7;
/** Soft-deleted pages are purged after this many days (D24). */
export const PAGE_RETENTION_DAYS = 30;

export const INVITATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'REVOKED',
  'EXPIRED',
] as const;
export type InvitationStatusValue = (typeof INVITATION_STATUSES)[number];

/** Invitation tokens are 32 random bytes in base64url (43 characters, D30). */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// ───────────── Shared primitives ─────────────

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter a workspace name' })
  .max(WORKSPACE_NAME_MAX_LENGTH, {
    error: `Use at most ${WORKSPACE_NAME_MAX_LENGTH} characters`,
  });

export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES);
export const pageAccessRoleSchema = z.enum(PAGE_ACCESS_ROLES);
export const invitationStatusSchema = z.enum(INVITATION_STATUSES);

/** Page title: 0–200 characters; an empty title displays as "Untitled" (DATABASE_SCHEMA §10). */
export const pageTitleSchema = z
  .string()
  .trim()
  .max(PAGE_TITLE_MAX_LENGTH, { error: `Use at most ${PAGE_TITLE_MAX_LENGTH} characters` });

export const pageIconSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter an icon or leave it empty' })
  .max(PAGE_ICON_MAX_LENGTH, { error: `Use at most ${PAGE_ICON_MAX_LENGTH} characters` });

export const invitationTokenSchema = z
  .string()
  .regex(INVITATION_TOKEN_PATTERN, { error: 'The invitation link is not valid' });

// ───────────── Params and query ─────────────

export const workspaceParamsSchema = z.strictObject({ workspaceId: z.uuid() });
export const memberParamsSchema = z.strictObject({ workspaceId: z.uuid(), userId: z.uuid() });
export const invitationParamsSchema = z.strictObject({
  workspaceId: z.uuid(),
  invitationId: z.uuid(),
});
export const pageParamsSchema = z.strictObject({ pageId: z.uuid() });
export const pagePermissionParamsSchema = z.strictObject({ pageId: z.uuid(), userId: z.uuid() });

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
});

export const invitationListQuerySchema = paginationQuerySchema.extend({
  status: invitationStatusSchema.optional(),
});

export const activityListQuerySchema = paginationQuerySchema.extend({
  pageId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  action: z.string().min(1).max(64).optional(),
});

export const pageActivityQuerySchema = paginationQuerySchema.extend({
  action: z.string().min(1).max(64).optional(),
});

// ───────────── Requests ─────────────

export const createWorkspaceRequestSchema = z.strictObject({ name: workspaceNameSchema });
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z.strictObject({ name: workspaceNameSchema });
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

/** `confirmName` must equal the workspace name exactly; it is compared on the server. */
export const deleteWorkspaceRequestSchema = z.strictObject({
  confirmName: z.string().min(1, { error: 'Type the workspace name to confirm' }).max(200),
});
export type DeleteWorkspaceRequest = z.infer<typeof deleteWorkspaceRequestSchema>;

export const updateMemberRoleRequestSchema = z.strictObject({ role: assignableRoleSchema });
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

export const transferOwnershipRequestSchema = z.strictObject({
  userId: z.uuid(),
  password: currentPasswordSchema,
});
export type TransferOwnershipRequest = z.infer<typeof transferOwnershipRequestSchema>;

export const createInvitationRequestSchema = z.strictObject({
  email: emailSchema,
  role: assignableRoleSchema,
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const invitationTokenRequestSchema = z.strictObject({ token: invitationTokenSchema });
export type InvitationTokenRequest = z.infer<typeof invitationTokenRequestSchema>;

export const createPageRequestSchema = z.strictObject({
  title: pageTitleSchema.optional(),
  icon: pageIconSchema.optional(),
  parentId: z.uuid().nullable().optional(),
  afterPageId: z.uuid().nullable().optional(),
});
export type CreatePageRequest = z.infer<typeof createPageRequestSchema>;

export const updatePageRequestSchema = z
  .strictObject({
    title: pageTitleSchema.optional(),
    icon: pageIconSchema.nullable().optional(),
  })
  .refine((value) => value.title !== undefined || value.icon !== undefined, {
    error: 'Provide at least one field to update',
  });
export type UpdatePageRequest = z.infer<typeof updatePageRequestSchema>;

export const movePageRequestSchema = z.strictObject({
  parentId: z.uuid().nullable(),
  afterPageId: z.uuid().nullable().optional(),
});
export type MovePageRequest = z.infer<typeof movePageRequestSchema>;

export const setPagePermissionRequestSchema = z.strictObject({ role: pageAccessRoleSchema });
export type SetPagePermissionRequest = z.infer<typeof setPagePermissionRequestSchema>;

// ───────────── Responses (docs/API_CONTRACTS.md §2) ─────────────

export const userSummarySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  presenceColor: z.string(),
  avatarUrl: z.string().nullable(),
});
export type UserSummaryDto = z.infer<typeof userSummarySchema>;

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  myRole: workspaceRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkspaceDto = z.infer<typeof workspaceSchema>;

export const memberSchema = z.object({
  user: userSummarySchema,
  /** Present only for viewers with at least the ADMIN role. */
  email: z.string().optional(),
  role: workspaceRoleSchema,
  joinedAt: z.string(),
});
export type MemberDto = z.infer<typeof memberSchema>;

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: assignableRoleSchema,
  status: invitationStatusSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
  invitedBy: userSummarySchema.nullable(),
});
export type InvitationDto = z.infer<typeof invitationSchema>;

export const effectivePageRoleSchema = z.enum(['NONE', ...WORKSPACE_ROLES]);

export const pageSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  parentId: z.uuid().nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  position: z.string(),
  myRole: effectivePageRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type PageDto = z.infer<typeof pageSchema>;

export const pagePermissionSchema = z.object({
  user: userSummarySchema,
  role: pageAccessRoleSchema,
  createdAt: z.string(),
});
export type PagePermissionDto = z.infer<typeof pagePermissionSchema>;

export const activitySchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  pageId: z.uuid().nullable(),
  actor: userSummarySchema.nullable(),
  action: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type ActivityDto = z.infer<typeof activitySchema>;

const pageMetaSchema = z.object({ nextCursor: z.string().nullable() });

function envelopeWithMeta<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data, meta: pageMetaSchema.optional() });
}

export const workspaceResponseSchema = successEnvelopeSchema(
  z.object({ workspace: workspaceSchema }),
);
export const workspaceListResponseSchema = successEnvelopeSchema(
  z.object({ workspaces: z.array(workspaceSchema) }),
);
export const memberResponseSchema = successEnvelopeSchema(z.object({ member: memberSchema }));
export const memberListResponseSchema = successEnvelopeSchema(
  z.object({ members: z.array(memberSchema) }),
);
export const invitationCreatedResponseSchema = successEnvelopeSchema(
  z.object({ invitation: invitationSchema, inviteUrl: z.string() }),
);
export const invitationListResponseSchema = envelopeWithMeta(
  z.object({ invitations: z.array(invitationSchema) }),
);
export const invitationPreviewResponseSchema = successEnvelopeSchema(
  z.object({
    workspaceName: z.string(),
    role: assignableRoleSchema,
    invitedBy: z.string().nullable(),
    emailHint: z.string(),
  }),
);
export const pageResponseSchema = successEnvelopeSchema(z.object({ page: pageSchema }));
export const pageDetailResponseSchema = successEnvelopeSchema(
  z.object({
    page: pageSchema,
    breadcrumbs: z.array(z.object({ id: z.uuid(), title: z.string() })),
  }),
);
export const pageListResponseSchema = successEnvelopeSchema(
  z.object({ pages: z.array(pageSchema) }),
);
export const trashListResponseSchema = envelopeWithMeta(z.object({ pages: z.array(pageSchema) }));
export const pageDeletedResponseSchema = successEnvelopeSchema(
  z.object({ deleteBatchId: z.uuid() }),
);
export const pagePermissionsResponseSchema = successEnvelopeSchema(
  z.object({
    overrides: z.array(pagePermissionSchema),
    inherited: z.array(
      z.object({ user: userSummarySchema, role: pageAccessRoleSchema, fromPageId: z.uuid() }),
    ),
  }),
);
export const pagePermissionResponseSchema = successEnvelopeSchema(
  z.object({ permission: pagePermissionSchema }),
);
export const activityListResponseSchema = envelopeWithMeta(
  z.object({ activity: z.array(activitySchema) }),
);

/** Invitation link in the form `<APP_URL>/invite#token=<token>` (D30). */
export function buildInviteUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/invite#token=${token}`;
}

/** Read the token from a URL fragment such as `#token=…`; null when absent or malformed. */
export function parseInviteFragment(fragment: string): string | null {
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const token = params.get('token');
  return token !== null && INVITATION_TOKEN_PATTERN.test(token) ? token : null;
}

/** `j***@example.com` style hint that does not reveal the full address (INV-05). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
