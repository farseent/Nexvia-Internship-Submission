import type { Metadata } from 'next';
import { WorkspaceDashboard } from '@/components/workspace-dashboard';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'Workspaces · CoNote' };

export default async function HomePage() {
  const user = await requireUser();
  return <WorkspaceDashboard displayName={user.displayName} />;
}
