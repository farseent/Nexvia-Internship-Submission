/**
 * Roles and the effective-permission function (D23). This is the single source of
 * role logic: the API, and later the collaboration server, call these pure
 * functions and never re-implement role comparisons (CLAUDE.md §7).
 * Pure: no I/O.
 */

/** Workspace roles, lowest to highest. */
export const WORKSPACE_ROLES = ['VIEWER', 'COMMENTER', 'EDITOR', 'ADMIN', 'OWNER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Per-user page overrides (stored in `page_permissions`). */
export const PAGE_ACCESS_ROLES = ['NONE', 'VIEWER', 'COMMENTER', 'EDITOR'] as const;
export type PageAccessRole = (typeof PAGE_ACCESS_ROLES)[number];

/** Roles that can be granted through invitations and role changes (never `OWNER`). */
export const ASSIGNABLE_ROLES = ['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Effective access to one page: `NONE` means no access. */
export type EffectivePageRole = 'NONE' | WorkspaceRole;

const RANK: Record<EffectivePageRole, number> = {
  NONE: 0,
  VIEWER: 1,
  COMMENTER: 2,
  EDITOR: 3,
  ADMIN: 4,
  OWNER: 5,
};

/** True when `role` is at least `minimum` (`NONE` is below every real role). */
export function roleAtLeast(role: EffectivePageRole, minimum: WorkspaceRole): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Workspace role of `null` means "not a member". */
export function workspaceRoleAtLeast(role: WorkspaceRole | null, minimum: WorkspaceRole): boolean {
  return role !== null && RANK[role] >= RANK[minimum];
}

export interface ResolvePageRoleInput {
  /** The user's role in the page's workspace; `null` for non-members. */
  workspaceRole: WorkspaceRole | null;
  /**
   * The user's override on the page itself (index 0), then on its parent, grandparent
   * and so on up to the root. `null` = no override on that page.
   */
  overrideChain: readonly (PageAccessRole | null)[];
}

/**
 * Effective page role for one user (D23, first match wins):
 * 1. non-member → NONE (external guests are out of scope, U9);
 * 2. OWNER/ADMIN → full access, never restrictable;
 * 3. the override on the page, else on the nearest ancestor with one;
 * 4. the workspace role (EDITOR/COMMENTER/VIEWER).
 * An override of `NONE` denies access.
 */
export function resolveEffectivePageRole(input: ResolvePageRoleInput): EffectivePageRole {
  const { workspaceRole, overrideChain } = input;
  if (workspaceRole === null) return 'NONE';
  if (workspaceRole === 'OWNER' || workspaceRole === 'ADMIN') return workspaceRole;
  for (const override of overrideChain) {
    if (override !== null) return override;
  }
  return workspaceRole;
}

export const canReadPage = (role: EffectivePageRole): boolean => roleAtLeast(role, 'VIEWER');
export const canCommentOnPage = (role: EffectivePageRole): boolean =>
  roleAtLeast(role, 'COMMENTER');
export const canEditPage = (role: EffectivePageRole): boolean => roleAtLeast(role, 'EDITOR');

// ───────────── Workspace management rules (PROJECT_MASTER §5) ─────────────

export type ManagementDecision = 'ALLOWED' | 'FORBIDDEN' | 'OWNER_PROTECTED';

/** Inviting needs `ADMIN`; only the owner may invite with the `ADMIN` role. */
export function canInviteWithRole(actor: WorkspaceRole, invitedRole: AssignableRole): boolean {
  if (!workspaceRoleAtLeast(actor, 'ADMIN')) return false;
  return invitedRole !== 'ADMIN' || actor === 'OWNER';
}

/**
 * Changing a member's role. The owner's role never changes (use ownership transfer);
 * an Admin manages only members at or below Editor and may only assign such roles.
 */
export function decideRoleChange(
  actor: WorkspaceRole,
  target: WorkspaceRole,
  newRole: AssignableRole,
): ManagementDecision {
  if (!workspaceRoleAtLeast(actor, 'ADMIN')) return 'FORBIDDEN';
  if (target === 'OWNER') return 'OWNER_PROTECTED';
  if (actor === 'OWNER') return 'ALLOWED';
  // actor is ADMIN
  if (target === 'ADMIN' || newRole === 'ADMIN') return 'FORBIDDEN';
  return 'ALLOWED';
}

/**
 * Removing a member, or leaving (`self`). The owner can neither be removed nor leave.
 * Admins remove only non-Admin members; the owner may also remove Admins.
 */
export function decideRemoval(
  actor: WorkspaceRole,
  target: WorkspaceRole,
  self: boolean,
): ManagementDecision {
  if (target === 'OWNER') return 'OWNER_PROTECTED';
  if (self) return 'ALLOWED';
  if (!workspaceRoleAtLeast(actor, 'ADMIN')) return 'FORBIDDEN';
  if (actor === 'ADMIN' && target === 'ADMIN') return 'FORBIDDEN';
  return 'ALLOWED';
}

/** A page override may only target members who are not Admin/Owner (D23). */
export function canRestrictMember(target: WorkspaceRole): boolean {
  return target !== 'OWNER' && target !== 'ADMIN';
}
