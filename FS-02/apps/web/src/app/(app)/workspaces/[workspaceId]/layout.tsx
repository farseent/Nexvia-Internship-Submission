import type { ReactNode } from 'react';
import { WorkspaceShell } from '@/components/workspace-shell';
import { requireUser } from '@/lib/server-auth';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  await requireUser();
  const { workspaceId } = await params;
  return <WorkspaceShell workspaceId={workspaceId}>{children}</WorkspaceShell>;
}
