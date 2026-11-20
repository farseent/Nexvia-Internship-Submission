import type { ReactNode } from 'react';
import { redirectIfSignedIn } from '@/lib/server-auth';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  await redirectIfSignedIn();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <p className="text-2xl font-semibold tracking-tight">CoNote</p>
      {children}
    </main>
  );
}
