import type { Metadata } from 'next';
import { CreateWorkspaceForm } from '@/components/create-workspace-form';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'New workspace · CoNote' };

export default async function NewWorkspacePage() {
  await requireUser();
  return <CreateWorkspaceForm />;
}
