import type { Metadata } from 'next';
import { WorkspaceHome } from '@/components/workspace-home';

export const metadata: Metadata = { title: 'Workspace · CoNote' };

export default function WorkspacePage() {
  return <WorkspaceHome />;
}
