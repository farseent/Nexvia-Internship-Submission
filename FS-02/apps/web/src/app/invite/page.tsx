import type { Metadata } from 'next';
import { InviteAccept } from '@/components/invite-accept';

export const metadata: Metadata = { title: 'Workspace invitation · CoNote' };

// Public route: the invitation token is in the URL fragment, which the server never sees, so
// this page cannot read it on the server. The client component reads it in the browser.
export default function InvitePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-10">
      <InviteAccept />
    </main>
  );
}
