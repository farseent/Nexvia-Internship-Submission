import { z } from 'zod';

/*
 * Presence (Phase 7, docs/WEBSOCKET_PROTOCOL.md §6, §18, D61).
 *
 * Awareness is the Yjs layer for ephemeral state: who is here and where their cursor is. It
 * is untrusted input, because any client can put anything into it. The collaboration server
 * therefore never relays what a client sends. It builds the state that is relayed:
 *
 *   { user: { id, name, color }, cursor?: { anchor, head } }
 *
 * `user` comes from the verified connection and from PostgreSQL, `cursor` is the only field
 * taken from the client, and only after it has been validated. Everything here is pure so the
 * server, the editor and the web app apply the same rules.
 */

/** The awareness field the editor binding writes the cursor to (y-prosemirror's default). */
export const AWARENESS_CURSOR_FIELD = 'cursor';

/**
 * A client awareness state larger than this (as JSON, in bytes) is not trusted to hold a
 * cursor: its cursor is dropped. A real state is about 150 bytes (WEBSOCKET_PROTOCOL §11).
 */
export const AWARENESS_MAX_STATE_BYTES = 1024;

/**
 * How long a server (y-protocols `outdatedTimeout`, a constant of the library) keeps an
 * awareness state that is not renewed. Clients renew theirs every half of it (15 s). It
 * bounds how long a client that vanished without closing its socket (network loss, laptop
 * sleep) is still shown; the server checks every `AWARENESS_TIMEOUT_MS / 10`.
 */
export const AWARENESS_TIMEOUT_MS = 30_000;

/** How long a user's last awareness state may be gone before a leave notice is shown (§6). */
export const PRESENCE_LEAVE_GRACE_MS = 3_000;

/** After connecting, users already present are the starting point, not news (§18.5). */
export const PRESENCE_QUIET_MS = 1_500;

const nonNegativeSafeInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const yjsId = z.strictObject({ client: nonNegativeSafeInt, clock: nonNegativeSafeInt });

/**
 * `Y.RelativePosition` as JSON. Strict and bounded: the editor binding feeds this to Yjs when
 * it draws a collaborator's cursor, so a malformed value must never get that far.
 */
export const relativePositionJsonSchema = z.strictObject({
  type: yjsId.nullable().optional(),
  tname: z.string().max(64).nullable().optional(),
  item: yjsId.nullable().optional(),
  assoc: z.number().int().min(-1).max(1).optional(),
});

export const awarenessCursorSchema = z.strictObject({
  anchor: relativePositionJsonSchema,
  head: relativePositionJsonSchema,
});
export type AwarenessCursor = z.infer<typeof awarenessCursorSchema>;

const PRESENCE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Who is shown. Everything about a person that other collaborators get to see. */
export const presenceIdentitySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  color: z.string().regex(PRESENCE_COLOR_PATTERN),
});
export type PresenceIdentity = z.infer<typeof presenceIdentitySchema>;

/** The awareness state as the server relays it. */
export interface PresenceState {
  user: PresenceIdentity;
  cursor?: AwarenessCursor;
}

export function isPresenceColor(value: unknown): value is string {
  return typeof value === 'string' && PRESENCE_COLOR_PATTERN.test(value);
}

/** A stored colour as a display colour. Falls back to a neutral grey for corrupt data. */
export function normalizePresenceColor(value: unknown): string {
  return isPresenceColor(value) ? value.toUpperCase() : '#64748B';
}

const encoder = new TextEncoder();

function jsonByteLength(value: unknown): number {
  try {
    return encoder.encode(JSON.stringify(value) ?? '').length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The state the server relays for a client's awareness update (WEBSOCKET_PROTOCOL §18.2).
 *
 * `identity` is built by the server for this connection and replaces whatever the client wrote
 * in `user`, so a forged id, name or colour has no effect at all. The cursor is kept only when
 * it is a well-formed pair of relative positions and the whole state is within the size limit.
 * Any other field is dropped. Never throws.
 */
export function sanitizeClientAwareness(raw: unknown, identity: PresenceIdentity): PresenceState {
  const state: PresenceState = { user: { ...identity } };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return state;
  if (jsonByteLength(raw) > AWARENESS_MAX_STATE_BYTES) return state;
  const cursor = (raw as Record<string, unknown>)[AWARENESS_CURSOR_FIELD];
  if (cursor === undefined || cursor === null) return state;
  const parsed = awarenessCursorSchema.safeParse(cursor);
  if (parsed.success) state.cursor = parsed.data;
  return state;
}

/**
 * A state received from the server, checked again before it is drawn: the client does not
 * assume that what arrives is well formed. `null` for anything that is not a valid state.
 * A cursor that is not valid is dropped; the person is still present.
 */
export function parseRelayedAwareness(raw: unknown): PresenceState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const user = presenceIdentitySchema.safeParse(record.user);
  if (!user.success) return null;
  const state: PresenceState = { user: user.data };
  const cursor = awarenessCursorSchema.safeParse(record[AWARENESS_CURSOR_FIELD]);
  if (cursor.success) state.cursor = cursor.data;
  return state;
}

/** One person in the online list, however many tabs they have open. */
export interface PresenceCollaborator {
  userId: string;
  name: string;
  color: string;
  /** Open connections of this person (tabs), at least 1. */
  connections: number;
  /** Whether any of their connections currently shows a cursor. */
  hasCursor: boolean;
  isSelf: boolean;
}

/**
 * The online collaborators from an awareness state map: one entry per user id (§6), the
 * current person first and the others by name. `self` is the current person as known from
 * the session, not from awareness (the server's echo of one's own state is not needed), and
 * is always listed; other tabs of the same person are counted in `connections`.
 */
export function deriveCollaborators(
  states: ReadonlyMap<number, unknown>,
  selfClientId: number,
  self: { id: string; name: string; color: string } | null,
): PresenceCollaborator[] {
  const byUser = new Map<string, PresenceCollaborator>();
  if (self) {
    byUser.set(self.id, {
      userId: self.id,
      name: self.name,
      color: normalizePresenceColor(self.color),
      connections: 1,
      hasCursor: false,
      isSelf: true,
    });
  }
  for (const [clientId, raw] of states) {
    if (clientId === selfClientId) continue;
    const state = parseRelayedAwareness(raw);
    if (state === null) continue;
    const existing = byUser.get(state.user.id);
    if (existing) {
      existing.connections += 1;
      existing.hasCursor ||= state.cursor !== undefined;
      continue;
    }
    byUser.set(state.user.id, {
      userId: state.user.id,
      name: state.user.name,
      color: state.user.color.toUpperCase(),
      connections: 1,
      hasCursor: state.cursor !== undefined,
      isSelf: false,
    });
  }
  const all = [...byUser.values()];
  return [
    ...all.filter((c) => c.isSelf),
    ...all
      .filter((c) => !c.isSelf)
      .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId)),
  ];
}

/** Up to two capital letters for an avatar: "Ada Lovelace" → "AL", "ada" → "A". */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) return '?';
  const letters = (word: string): string => Array.from(word)[0]?.toUpperCase() ?? '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return letters(first) + (last === undefined ? '' : letters(last));
}

/** Black or white, whichever is easier to read on `background` (a `#RRGGBB` colour). */
export function readableTextColor(background: string): '#000000' | '#FFFFFF' {
  const hex = normalizePresenceColor(background).slice(1);
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // Contrast with white is 1.05 / (L + 0.05), with black (L + 0.05) / 0.05: pick the larger.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#FFFFFF' : '#000000';
}
