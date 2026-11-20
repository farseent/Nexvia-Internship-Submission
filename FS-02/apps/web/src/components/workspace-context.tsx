'use client';

import { createContext, useContext } from 'react';
import { roleAtLeast, type PageDto, type WorkspaceDto } from '@conote/shared';
import type { PageNode } from '@/lib/page-tree';

export interface WorkspaceContextValue {
  workspace: WorkspaceDto;
  pages: PageDto[];
  tree: PageNode[];
  /** Workspace role at least EDITOR (may create root pages). */
  canCreateRoot: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  reloadPages(): Promise<void>;
  reloadWorkspace(): Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error('useWorkspace must be used inside <WorkspaceShell>.');
  return value;
}

/** Whether the caller may edit a page, from the effective role the API reported. */
export function canEditPageDto(page: PageDto): boolean {
  return roleAtLeast(page.myRole, 'EDITOR');
}
