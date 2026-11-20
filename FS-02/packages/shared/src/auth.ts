import { z } from 'zod';

/**
 * Authentication and user schemas shared by the API and the web client
 * (docs/API_CONTRACTS.md §3–§4, docs/DATABASE_SCHEMA.md §10; D4, D5).
 * Pure: no I/O. Request schemas reject unknown fields.
 */

export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 80;

/** Session cookie name (docs/ARCHITECTURE.md §10.2): `__Host-` needs `Secure`, so production only. */
export const SESSION_COOKIE_NAME_PRODUCTION = '__Host-conote_session';
export const SESSION_COOKIE_NAME_DEVELOPMENT = 'conote_session';

export function sessionCookieName(nodeEnv: 'development' | 'test' | 'production'): string {
  return nodeEnv === 'production'
    ? SESSION_COOKIE_NAME_PRODUCTION
    : SESSION_COOKIE_NAME_DEVELOPMENT;
}

/** Redis pub/sub channel for access events (docs/WEBSOCKET_PROTOCOL.md §10). */
export const ACCESS_EVENTS_CHANNEL = 'conote:events:access';

export const ACCESS_EVENT_TYPES = [
  'session.revoked',
  'member.role_changed',
  'member.removed',
  'workspace.deleted',
  'page.access_changed',
] as const;
export type AccessEventType = (typeof ACCESS_EVENT_TYPES)[number];

/** docs/WEBSOCKET_PROTOCOL.md §10: `session.*` events carry user/session ids, the others workspace/page ids. */
export interface AccessEvent {
  v: 1;
  type: AccessEventType;
  userId?: string;
  sessionId?: string;
  workspaceId?: string;
  pageId?: string;
  /** ISO 8601 UTC timestamp. */
  at: string;
}

/** Initial presence colours (assigned at registration; the user can change them). */
export const PRESENCE_COLORS: readonly string[] = [
  '#E11D48',
  '#EA580C',
  '#CA8A04',
  '#16A34A',
  '#0D9488',
  '#0284C7',
  '#4F46E5',
  '#9333EA',
  '#C026D3',
  '#475569',
];

export const emailSchema = z
  .string()
  .max(512)
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }).max(EMAIL_MAX_LENGTH));

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: `Use at least ${PASSWORD_MIN_LENGTH} characters` })
  .max(PASSWORD_MAX_LENGTH, { error: `Use at most ${PASSWORD_MAX_LENGTH} characters` });

/** Existing passwords are checked, not policy-validated; the length cap bounds hashing work. */
export const currentPasswordSchema = z
  .string()
  .min(1, { error: 'Enter your password' })
  .max(PASSWORD_MAX_LENGTH);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter a display name' })
  .max(DISPLAY_NAME_MAX_LENGTH, {
    error: `Use at most ${DISPLAY_NAME_MAX_LENGTH} characters`,
  });

export const presenceColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, { error: 'Use a colour in #RRGGBB format' })
  .transform((value) => value.toUpperCase());

export const registerRequestSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
  displayName: displayNameSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: currentPasswordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** USER-02. Avatar changes arrive with Phase 4, so `avatarAssetId` is rejected as an unknown field. */
export const updateProfileRequestSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    presenceColor: presenceColorSchema.optional(),
  })
  .refine((value) => value.displayName !== undefined || value.presenceColor !== undefined, {
    error: 'Provide at least one field to update',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** Body of requests that take no payload (logout): absent or `{}`. */
export const emptyBodySchema = z.strictObject({}).optional();

export const sessionIdParamsSchema = z.strictObject({ sessionId: z.uuid() });

// ───────────── Response shapes (docs/API_CONTRACTS.md §2) ─────────────

/** Serialization strips unknown keys, so a password hash can never leave through this schema. */
export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  presenceColor: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userSchema>;

export const sessionInfoSchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
export type SessionInfoDto = z.infer<typeof sessionInfoSchema>;

/** Success envelope schema for response serialization (D31). */
export function successEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data, meta: z.object({}).optional() });
}

export const userResponseSchema = successEnvelopeSchema(z.object({ user: userSchema }));
export const sessionResponseSchema = successEnvelopeSchema(
  z.object({ user: userSchema, session: sessionInfoSchema }),
);
export const sessionListResponseSchema = successEnvelopeSchema(
  z.object({ sessions: z.array(sessionInfoSchema) }),
);
export const nullResponseSchema = successEnvelopeSchema(z.null());
