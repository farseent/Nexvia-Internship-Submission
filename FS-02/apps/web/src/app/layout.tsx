import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';
import { getSessionUser } from '@/lib/server-auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'CoNote',
  description: 'Real-time collaborative workspace',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Seeds client auth state from the server. Pages still verify access themselves:
  // layouts are not re-rendered on client navigation.
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <AuthProvider initialUser={user}>{children}</AuthProvider>
      </body>
    </html>
  );
}
