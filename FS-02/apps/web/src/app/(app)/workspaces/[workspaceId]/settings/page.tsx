import type { Metadata } from 'next';
import { WorkspaceSettings } from '@/components/workspace-settings';

export const metadata: Metadata = { title: 'Workspace settings · CoNote' };

export default function SettingsPage() {
  return <WorkspaceSettings />;
}
