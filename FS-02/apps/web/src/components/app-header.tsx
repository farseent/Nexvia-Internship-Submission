'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export function AppHeader() {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (user === null) return null;

  async function onLogout() {
    setBusy(true);
    setFailed(false);
    try {
      await logout();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          CoNote
        </Link>
        <nav className="flex items-center gap-4 text-sm" aria-label="Account">
          <Link href="/profile" className="flex items-center gap-2 hover:underline">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: user.presenceColor }}
            />
            {user.displayName}
          </Link>
          <button
            type="button"
            onClick={() => void onLogout()}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
          {failed ? (
            <span role="alert" className="text-xs text-red-700">
              Could not sign out. Try again.
            </span>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
