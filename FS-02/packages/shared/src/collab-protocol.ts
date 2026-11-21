import { z } from 'zod';
import { ACCESS_EVENT_TYPES } from './auth.js';
import { SNAPSHOT_KINDS, SNAPSHOT_LABEL_MAX } from './comments.js';

/**
 * The wire contract between the API (which signs collaboration tokens), the collaboration
 * server (which verifies them) and the web client (docs/WEBSOCKET_PROTOCOL.md §4, §7, §9).
 * Pure: no I/O, no Yjs.
 */

// ───────────── Collaboration token (D22) ─────────────

export const COLLAB_TOKEN_ISSUER = 'conote-api';
export const COLLAB_TOKEN_AUDIENCE = 'conote-collab';
/** A token is only used to open one connection, so it lives for one minute (D22). */
export const COLLAB_TOKEN_TTL_SECONDS = 60;
/** Tolerated clock difference between the API and the collaboration server. */
export const COLLAB_TOKEN_CLOCK_TOLERANCE_SECONDS = 5;
export const COLLAB_TOKEN_ALGORITHM = 'EdDSA';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/**
 * Claims of a collaboration token. The token carries identities only: the role is never in
 * the token because the collaboration server computes it from the database on every
 * connection (WEBSOCKET_PROTOCOL §4).
 */
export const collabTokenClaimsSchema = z.object({
  iss: z.literal(COLLAB_TOKEN_ISSUER),
  aud: z.literal(COLLAB_TOKEN_AUDIENCE),
  /** User id. */
  sub: uuid,
  /** Session id: the connection ends when this session ends. */
  sid: uuid,
  /** Page id; must equal the page of the requested document name. */
  pid: uuid,
  jti: z.string().min(8).max(64),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type CollabTokenClaims = z.infer<typeof collabTokenClaimsSchema>;

/** `PAGE-10` response (docs/API_CONTRACTS.md §7). `role` and `readOnly` are hints for the UI. */
export const collabTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  collabUrl: z.string(),
  documentName: z.string(),
  role: z.enum(['VIEWER', 'COMMENTER', 'EDITOR', 'ADMIN', 'OWNER']),
  readOnly: z.boolean(),
});
export type CollabTokenResponse = z.infer<typeof collabTokenResponseSchema>;

// ───────────── Close reasons (WEBSOCKET_PROTOCOL §9) ─────────────

/**
 * Logical close reasons and their WebSocket close codes. Hocuspocus closes one document
 * channel with a reason string and the whole socket with a code, so the reason name is what
 * travels on the document channel and the code is used where the socket itself is closed.
 */
export const COLLAB_CLOSE = {
  NORMAL: { code: 1000, reason: 'NORMAL' },
  SERVER_RESTARTING: { code: 1012, reason: 'SERVER_RESTARTING' },
  MESSAGE_TOO_LARGE: { code: 1009, reason: 'MESSAGE_TOO_LARGE' },
  PROTOCOL_VIOLATION: { code: 4400, reason: 'PROTOCOL_VIOLATION' },
  AUTH_FAILED: { code: 4401, reason: 'AUTH_FAILED' },
  ACCESS_DENIED: { code: 4403, reason: 'ACCESS_DENIED' },
  PAGE_NOT_FOUND: { code: 4404, reason: 'PAGE_NOT_FOUND' },
  ACCESS_REVOKED: { code: 4410, reason: 'ACCESS_REVOKED' },
  RATE_LIMITED: { code: 4429, reason: 'RATE_LIMITED' },
  TRY_AGAIN_LATER: { code: 4503, reason: 'TRY_AGAIN_LATER' },
} as const;
export type CollabCloseName = keyof typeof COLLAB_CLOSE;

// ───────────── Application messages (layer 3, WEBSOCKET_PROTOCOL §7) ─────────────

export const COLLAB_MESSAGE_VERSION = 1;
/** Application messages are tiny JSON strings; anything bigger is rejected unparsed. */
export const COLLAB_MAX_APP_MESSAGE_BYTES = 8 * 1024;

export const ACCESS_REVOKED_REASONS = [
  'SESSION_REVOKED',
  'MEMBER_REMOVED',
  'ACCESS_REMOVED',
  'PAGE_DELETED',
  'WORKSPACE_DELETED',
] as const;
export type AccessRevokedReason = (typeof ACCESS_REVOKED_REASONS)[number];

export const APP_ERROR_CODES = [
  'INVALID_MESSAGE',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

/** Messages the server sends (Phase 6 access/shutdown/error; Phase 8 versions, comments, responses). */
const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('access.changed'),
    payload: z
      .object({
        readOnly: z.boolean(),
        role: z.enum(['VIEWER', 'COMMENTER', 'EDITOR', 'ADMIN', 'OWNER']),
      })
      .strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('access.revoked'),
    payload: z.object({ reason: z.enum(ACCESS_REVOKED_REASONS) }).strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('server.shutting_down'),
    payload: z.object({}).strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('response'),
    replyTo: z.string().optional(),
    payload: z
      .object({
        ok: z.literal(true),
        result: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('version.created'),
    payload: z
      .object({
        versionId: z.uuid(),
        kind: z.enum(SNAPSHOT_KINDS),
        label: z.string().nullable(),
        createdBy: z.uuid().nullable(),
      })
      .strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('version.restore.started'),
    payload: z.object({ restoredBy: z.uuid() }).strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('version.restored'),
    payload: z
      .object({
        versionId: z.uuid(),
        preRestoreVersionId: z.uuid(),
        restoredBy: z.uuid(),
      })
      .strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('version.restore.failed'),
    payload: z.object({ reason: z.string().max(200) }).strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('comments.changed'),
    payload: z.object({ pageId: z.uuid() }).strict(),
  }),
  z.object({
    v: z.literal(COLLAB_MESSAGE_VERSION),
    type: z.literal('error'),
    replyTo: z.string().optional(),
    payload: z.object({ code: z.enum(APP_ERROR_CODES), message: z.string().max(200) }).strict(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(serverMessageSchema.parse(message));
}

/** Parse a message from the server; `null` when it is not a registered, well-formed message. */
export function parseServerMessage(raw: string): ServerMessage | null {
  if (raw.length > COLLAB_MAX_APP_MESSAGE_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = serverMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * The envelope every client message must have. Phase 6 registers no client commands (version
 * commands arrive with Phase 8), so after this check every client message is answered with
 * `error INVALID_MESSAGE`; the check still tells a malformed message from an unknown type.
 */
export const clientEnvelopeSchema = z.object({
  v: z.literal(COLLAB_MESSAGE_VERSION),
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(64).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>;

export function parseClientEnvelope(raw: string): ClientEnvelope | null {
  if (raw.length > COLLAB_MAX_APP_MESSAGE_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = clientEnvelopeSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// ───────────── Client commands (Phase 8, WEBSOCKET_PROTOCOL §7) ─────────────

export const versionCreatePayloadSchema = z
  .object({ label: z.string().trim().min(1).max(SNAPSHOT_LABEL_MAX).optional() })
  .strict();
export const versionRestorePayloadSchema = z.object({ versionId: z.uuid() }).strict();

export type ClientCommand =
  | { type: 'version.create'; id: string | undefined; payload: { label?: string | undefined } }
  | { type: 'version.restore'; id: string | undefined; payload: { versionId: string } };

/**
 * Validate a client envelope as a registered command. `unknown_type` for a type the server
 * does not register, `invalid` for a registered type with a bad payload.
 */
export function parseClientCommand(
  envelope: ClientEnvelope,
): { ok: true; command: ClientCommand } | { ok: false; why: 'unknown_type' | 'invalid' } {
  switch (envelope.type) {
    case 'version.create': {
      const parsed = versionCreatePayloadSchema.safeParse(envelope.payload);
      return parsed.success
        ? { ok: true, command: { type: 'version.create', id: envelope.id, payload: parsed.data } }
        : { ok: false, why: 'invalid' };
    }
    case 'version.restore': {
      const parsed = versionRestorePayloadSchema.safeParse(envelope.payload);
      return parsed.success
        ? { ok: true, command: { type: 'version.restore', id: envelope.id, payload: parsed.data } }
        : { ok: false, why: 'invalid' };
    }
    default:
      return { ok: false, why: 'unknown_type' };
  }
}

// ───────────── Access events (Redis channel `conote:events:access`, §10) ─────────────

/** Validates an access event received from Redis: anything else is ignored. */
export const accessEventSchema = z.object({
  v: z.literal(1),
  type: z.enum(ACCESS_EVENT_TYPES),
  userId: uuid.optional(),
  sessionId: uuid.optional(),
  workspaceId: uuid.optional(),
  pageId: uuid.optional(),
  at: z.string().max(40),
});
