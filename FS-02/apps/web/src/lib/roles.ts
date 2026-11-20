import type { EffectivePageRole, PageAccessRole, WorkspaceRole } from '@conote/shared';

const LABELS: Record<EffectivePageRole, string> = {
  NONE: 'No access',
  VIEWER: 'Viewer',
  COMMENTER: 'Commenter',
  EDITOR: 'Editor',
  ADMIN: 'Admin',
  OWNER: 'Owner',
};

export function roleLabel(role: EffectivePageRole): string {
  return LABELS[role];
}

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  OWNER: 'Full control, including deleting the workspace and transferring ownership.',
  ADMIN: 'Manages members, invitations, settings and page permissions.',
  EDITOR: 'Creates, edits, moves and deletes pages.',
  COMMENTER: 'Reads pages and comments on them.',
  VIEWER: 'Reads pages.',
};

export const PAGE_OVERRIDE_OPTIONS: { value: PageAccessRole | 'INHERIT'; label: string }[] = [
  { value: 'INHERIT', label: 'Inherit (no override)' },
  { value: 'NONE', label: 'No access' },
  { value: 'VIEWER', label: 'Viewer' },
  { value: 'COMMENTER', label: 'Commenter' },
  { value: 'EDITOR', label: 'Editor' },
];
