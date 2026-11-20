import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { requireUser } from '@/lib/server-auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </>
  );
}
