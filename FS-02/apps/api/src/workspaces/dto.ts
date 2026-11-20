import type {
  ActivityDto,
  EffectivePageRole,
  InvitationDto,
  MemberDto,
  PageDto,
  PagePermissionDto,
  UserSummaryDto,
  WorkspaceDto,
  WorkspaceRole,
  InvitationStatusValue,
  AssignableRole,
} from '@conote/shared';
import type { PageRow } from './access.js';

export interface UserSummaryRow {
  id: string;
  displayName: string;
  presenceColor: string;
}

export const USER_SUMMARY_SELECT = { id: true, displayName: true, presenceColor: true } as const;

export function toUserSummary(user: UserSummaryRow): UserSummaryDto {
  // Avatars arrive with Phase 4 (assets).
  return {
    id: user.id,
    displayName: user.displayName,
    presenceColor: user.presenceColor,
    avatarUrl: null,
  };
}

export function toWorkspaceDto(
  workspace: { id: string; name: string; createdAt: Date; updatedAt: Date },
  myRole: WorkspaceRole,
): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    myRole,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

export function toMemberDto(
  member: { role: WorkspaceRole; createdAt: Date; user: UserSummaryRow & { email: string } },
  includeEmail: boolean,
): MemberDto {
  return {
    user: toUserSummary(member.user),
    ...(includeEmail ? { email: member.user.email } : {}),
    role: member.role,
    joinedAt: member.createdAt.toISOString(),
  };
}

/** A pending invitation past its expiry is reported as EXPIRED (derived, never stored). */
export function effectiveInvitationStatus(
  invitation: { status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED'; expiresAt: Date },
  now: Date,
): InvitationStatusValue {
  if (invitation.status === 'PENDING' && invitation.expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED';
  }
  return invitation.status;
}

export function toInvitationDto(
  invitation: {
    id: string;
    email: string;
    role: WorkspaceRole;
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
    expiresAt: Date;
    createdAt: Date;
    invitedBy: UserSummaryRow | null;
  },
  now: Date,
): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    // The database forbids OWNER invitations (CHECK invitations_role_not_owner).
    role: invitation.role as AssignableRole,
    status: effectiveInvitationStatus(invitation, now),
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    invitedBy: invitation.invitedBy === null ? null : toUserSummary(invitation.invitedBy),
  };
}

export function toPageDto(page: PageRow, myRole: EffectivePageRole): PageDto {
  return {
    id: page.id,
    workspaceId: page.workspaceId,
    parentId: page.parentId,
    title: page.title,
    icon: page.icon,
    position: page.position,
    myRole,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
    deletedAt: page.deletedAt === null ? null : page.deletedAt.toISOString(),
  };
}

export function toPagePermissionDto(permission: {
  role: 'NONE' | 'VIEWER' | 'COMMENTER' | 'EDITOR';
  createdAt: Date;
  user: UserSummaryRow;
}): PagePermissionDto {
  return {
    user: toUserSummary(permission.user),
    role: permission.role,
    createdAt: permission.createdAt.toISOString(),
  };
}

export function toActivityDto(entry: {
  id: string;
  workspaceId: string;
  pageId: string | null;
  action: string;
  metadata: unknown;
  createdAt: Date;
  actor: UserSummaryRow | null;
}): ActivityDto {
  const metadata =
    typeof entry.metadata === 'object' && entry.metadata !== null && !Array.isArray(entry.metadata)
      ? (entry.metadata as Record<string, unknown>)
      : null;
  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    pageId: entry.pageId,
    actor: entry.actor === null ? null : toUserSummary(entry.actor),
    action: entry.action,
    metadata,
    createdAt: entry.createdAt.toISOString(),
  };
}
