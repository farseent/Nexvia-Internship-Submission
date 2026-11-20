import { resolveEffectivePageRole, type EffectivePageRole } from '@conote/shared';
import type { PrismaClient } from './client.js';

/**
 * The collaboration server's authorization lookup (docs/WEBSOCKET_PROTOCOL.md §4, §10).
 *
 * It repeats, on purpose and from PostgreSQL alone, what the API's `AccessService` decides, and
 * it calls the same pure function (`resolveEffectivePageRole`, D23), so the two cannot disagree
 * about roles. Nothing the client sent is an input: only identifiers from a verified token.
 */
export type CollabAccessDenial =
  /** The session does not exist, is revoked, or has expired (idle or absolute). */
  | 'SESSION_INVALID'
  /** The session belongs to another user than the token's subject. */
  | 'SESSION_MISMATCH'
  /** The page does not exist or is in the trash. */
  | 'PAGE_NOT_FOUND'
  /** The workspace was deleted or the user is not (or no longer) a member. */
  | 'NOT_A_MEMBER'
  /** The user's effective role on the page is `NONE`. */
  | 'ACCESS_REMOVED';

export type CollabAccessDecision =
  | { ok: true; role: Exclude<EffectivePageRole, 'NONE'>; workspaceId: string }
  | { ok: false; reason: CollabAccessDenial };

export interface CollabAccessQuery {
  userId: string;
  sessionId: string;
  pageId: string;
  /** The current time, for session expiry. */
  now: Date;
}

interface ChainRow {
  id: string;
  depth: number;
}

export async function resolveCollabAccess(
  prisma: PrismaClient,
  query: CollabAccessQuery,
): Promise<CollabAccessDecision> {
  const { userId, sessionId, pageId, now } = query;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true, absoluteExpiresAt: true },
  });
  if (
    session === null ||
    session.revokedAt !== null ||
    now.getTime() >= session.expiresAt.getTime() ||
    now.getTime() >= session.absoluteExpiresAt.getTime()
  ) {
    return { ok: false, reason: 'SESSION_INVALID' };
  }
  if (session.userId !== userId) return { ok: false, reason: 'SESSION_MISMATCH' };

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { workspaceId: true, deletedAt: true },
  });
  if (page === null || page.deletedAt !== null) return { ok: false, reason: 'PAGE_NOT_FOUND' };

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId } },
    select: { role: true },
  });
  if (member === null) return { ok: false, reason: 'NOT_A_MEMBER' };

  const chain = await prisma.$queryRaw<ChainRow[]>`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId", 0 AS depth FROM pages WHERE id = ${pageId}::uuid
      UNION ALL
      SELECT p.id, p."parentId", c.depth + 1
      FROM pages p JOIN chain c ON p.id = c."parentId"
    )
    SELECT id, depth::int AS depth FROM chain ORDER BY depth`;
  const overrides = await prisma.pagePermission.findMany({
    where: { userId, pageId: { in: chain.map((entry) => entry.id) } },
    select: { pageId: true, role: true },
  });
  const byPage = new Map(overrides.map((override) => [override.pageId, override.role]));
  const role = resolveEffectivePageRole({
    workspaceRole: member.role,
    overrideChain: chain.map((entry) => byPage.get(entry.id) ?? null),
  });
  if (role === 'NONE') return { ok: false, reason: 'ACCESS_REMOVED' };
  return { ok: true, role, workspaceId: page.workspaceId };
}
