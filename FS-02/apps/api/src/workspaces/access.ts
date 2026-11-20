import type { Prisma, PrismaClient } from '@conote/db';
import {
  AppError,
  resolveEffectivePageRole,
  roleAtLeast,
  workspaceRoleAtLeast,
  type EffectivePageRole,
  type PageAccessRole,
  type WorkspaceRole,
} from '@conote/shared';

/** Any Prisma client: the shared one or a transaction client. */
export type Db = Prisma.TransactionClient;

/** Page columns the API reads. */
export const PAGE_SELECT = {
  id: true,
  workspaceId: true,
  parentId: true,
  title: true,
  icon: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deleteBatchId: true,
} as const;

export interface PageRow {
  id: string;
  workspaceId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  position: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deleteBatchId: string | null;
}

export interface ChainEntry {
  id: string;
  parentId: string | null;
  /** 0 for the page itself, 1 for its parent, and so on up to the root. */
  depth: number;
}

/** The page and all its ancestors, page first. Includes soft-deleted pages. */
export async function ancestorChain(db: Db, pageId: string): Promise<ChainEntry[]> {
  return db.$queryRaw<ChainEntry[]>`
    WITH RECURSIVE chain AS (
      SELECT id, "parentId", 0 AS depth FROM pages WHERE id = ${pageId}::uuid
      UNION ALL
      SELECT p.id, p."parentId", c.depth + 1
      FROM pages p JOIN chain c ON p.id = c."parentId"
    )
    SELECT id, "parentId", depth::int AS depth FROM chain ORDER BY depth`;
}

/** The page and every descendant with its depth below the page (page = 1). Includes soft-deleted pages. */
export async function subtreeDepths(
  db: Db,
  pageId: string,
): Promise<{ id: string; depth: number }[]> {
  return db.$queryRaw<{ id: string; depth: number }[]>`
    WITH RECURSIVE sub AS (
      SELECT id, 1 AS depth FROM pages WHERE id = ${pageId}::uuid
      UNION ALL
      SELECT p.id, s.depth + 1 FROM pages p JOIN sub s ON p."parentId" = s.id
    )
    SELECT id, depth::int AS depth FROM sub`;
}

/**
 * Serialize structural changes of one workspace: page tree edits and membership changes
 * take this transaction-scoped advisory lock before reading, and hold it to commit
 * (docs/API_CONTRACTS.md PAGE-05). Must be called inside a transaction.
 */
export async function lockWorkspace(tx: Db, workspaceId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}::text, 0::bigint))::text AS locked`;
}

export interface PageAccess {
  page: PageRow;
  workspaceRole: WorkspaceRole;
  /** Effective role on the page (never `NONE`: that is reported as 404). */
  role: EffectivePageRole;
  /** The page's own override first, then each ancestor's (null = none). */
  overrideChain: (PageAccessRole | null)[];
  chain: ChainEntry[];
}

/**
 * Authorization lookups. Every API permission decision goes through here and through the
 * pure functions in `@conote/shared` (D23); the web client never decides access.
 *
 * Status rules (D23): a caller who cannot see a resource gets 404 (existence is not
 * revealed); a caller who can see it but lacks the role gets 403.
 */
export class AccessService {
  constructor(private readonly prisma: PrismaClient) {}

  /** The user's role in the workspace, or null when not a member. */
  async membership(db: Db, workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const row = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    return row === null ? null : row.role;
  }

  /** Member with at least `minimum`; 404 for non-members, 403 for insufficient role. */
  async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    minimum: WorkspaceRole,
    db: Db = this.prisma,
  ): Promise<WorkspaceRole> {
    const role = await this.membership(db, workspaceId, userId);
    if (role === null) throw new AppError('NOT_FOUND', 'Resource not found.');
    if (!workspaceRoleAtLeast(role, minimum)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
    }
    return role;
  }

  /**
   * Resolve the user's effective access to a page. Missing pages, deleted pages (unless
   * `includeDeleted`), non-members and effective role `NONE` all raise 404.
   */
  async pageAccess(
    userId: string,
    pageId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<PageAccess> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: PAGE_SELECT,
    });
    if (page === null || (page.deletedAt !== null && options.includeDeleted !== true)) {
      throw new AppError('NOT_FOUND', 'Resource not found.');
    }
    const workspaceRole = await this.membership(this.prisma, page.workspaceId, userId);
    if (workspaceRole === null) throw new AppError('NOT_FOUND', 'Resource not found.');

    const chain = await ancestorChain(this.prisma, pageId);
    const overrides = await this.prisma.pagePermission.findMany({
      where: { userId, pageId: { in: chain.map((entry) => entry.id) } },
      select: { pageId: true, role: true },
    });
    const byPage = new Map(overrides.map((o) => [o.pageId, o.role]));
    const overrideChain = chain.map((entry) => byPage.get(entry.id) ?? null);
    const role = resolveEffectivePageRole({ workspaceRole, overrideChain });
    if (role === 'NONE') throw new AppError('NOT_FOUND', 'Resource not found.');
    return { page, workspaceRole, role, overrideChain, chain };
  }

  /** 403 unless the effective role reaches `minimum`. */
  requirePageRole(access: PageAccess, minimum: WorkspaceRole): void {
    if (!roleAtLeast(access.role, minimum)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
    }
  }

  /**
   * Authorize placing a page under `parentId` (create/move) and return the actor's effective role
   * there. `null` means the workspace root, which needs `WS≥EDITOR`; otherwise the actor needs
   * `PAGE≥EDITOR` on the parent. The caller must already be a member of `workspaceId`. A parent
   * in another workspace is an invalid reference (409 INVALID_MOVE) unless the caller cannot see
   * it, in which case it is reported as missing.
   */
  async authorizeDestination(
    userId: string,
    workspaceId: string,
    parentId: string | null,
  ): Promise<EffectivePageRole> {
    if (parentId === null) {
      return this.requireWorkspaceRole(userId, workspaceId, 'EDITOR');
    }
    const parent = await this.prisma.page.findUnique({
      where: { id: parentId },
      select: { workspaceId: true },
    });
    if (parent === null) throw new AppError('NOT_FOUND', 'Resource not found.');
    if (parent.workspaceId !== workspaceId) {
      const other = await this.membership(this.prisma, parent.workspaceId, userId);
      if (other === null) throw new AppError('NOT_FOUND', 'Resource not found.');
      throw new AppError('INVALID_MOVE', 'The move is not allowed.');
    }
    const access = await this.pageAccess(userId, parentId);
    this.requirePageRole(access, 'EDITOR');
    return access.role;
  }
}

export interface PageNode {
  id: string;
  parentId: string | null;
}

/**
 * Effective role of one user for every page of a workspace, from one pass over the tree
 * (same rules as `resolveEffectivePageRole`, used for list endpoints).
 */
export function computeEffectiveRoles(
  pages: readonly PageNode[],
  workspaceRole: WorkspaceRole,
  overrides: ReadonlyMap<string, PageAccessRole>,
): Map<string, EffectivePageRole> {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const result = new Map<string, EffectivePageRole>();
  for (const page of pages) {
    const overrideChain: (PageAccessRole | null)[] = [];
    let cursor: PageNode | undefined = page;
    // Bounded walk: the tree is acyclic by construction, the cap is a safety net.
    for (let hops = 0; cursor !== undefined && hops < 64; hops += 1) {
      overrideChain.push(overrides.get(cursor.id) ?? null);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
    result.set(page.id, resolveEffectivePageRole({ workspaceRole, overrideChain }));
  }
  return result;
}

/** Sort siblings by position (code-unit order), then id. */
export function bySiblingOrder<T extends { id: string; position: string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
