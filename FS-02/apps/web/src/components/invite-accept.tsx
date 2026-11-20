'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { parseInviteFragment, type AssignableRole } from '@conote/shared';
import { api, describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { clearStoredInvite, readStoredInvite, storeInvite } from '@/lib/invite-storage';
import { roleLabel } from '@/lib/roles';
import { FormMessage } from './form-parts';

interface Preview {
  workspaceName: string;
  role: AssignableRole;
  invitedBy: string | null;
  emailHint: string;
}

// The invite token lives outside React (URL fragment, then stored copy), so read it as an external store.
const subscribeNever = () => () => {};
function readToken(): string | null {
  return parseInviteFragment(window.location.hash) ?? readStoredInvite();
}

/**
 * Accept or decline an invitation link (`/invite#token=…`). The token comes from the URL
 * fragment, so it is never sent to a server until the person acts on it (D30).
 */
export function InviteAccept() {
  const { user, guard } = useAuth();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const token = useSyncExternalStore<string | null | undefined>(
    subscribeNever,
    readToken,
    () => undefined, // server/hydration: shows "Loading invitation…"
  );

  useEffect(() => {
    const fromUrl = parseInviteFragment(window.location.hash);
    if (fromUrl !== null) storeInvite(fromUrl);
  }, []);

  useEffect(() => {
    if (typeof token !== 'string') return;
    let cancelled = false;
    api.previewInvitation(token).then(
      (result) => {
        if (!cancelled) setPreview(result);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeApiError(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    if (typeof token !== 'string') return;
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await guard(() => api.acceptInvitation(token));
      clearStoredInvite();
      router.push(`/workspaces/${workspace.id}`);
    } catch (e) {
      setError(describeApiError(e));
      setBusy(false);
    }
  }

  async function decline() {
    if (typeof token !== 'string') return;
    setBusy(true);
    setError(null);
    try {
      await guard(() => api.declineInvitation(token));
      clearStoredInvite();
      router.push('/');
    } catch (e) {
      setError(describeApiError(e));
      setBusy(false);
    }
  }

  if (token === undefined) return <p className="text-sm text-slate-600">Loading invitation…</p>;
  if (token === null) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace invitation</h1>
        <FormMessage kind="error">
          This link does not contain a valid invitation. Ask the person who invited you to send it
          again.
        </FormMessage>
        <Link href="/" className="text-sm font-medium text-indigo-700 hover:underline">
          Go to CoNote
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Workspace invitation</h1>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {preview === null ? (
        error ? null : (
          <p className="text-sm text-slate-600">Checking the invitation…</p>
        )
      ) : (
        <>
          <p className="text-slate-700">
            {preview.invitedBy !== null ? `${preview.invitedBy} invited you` : 'You were invited'}{' '}
            to join <strong>{preview.workspaceName}</strong> as{' '}
            {roleLabel(preview.role).toLowerCase()}.
          </p>
          <p className="text-sm text-slate-500">
            {`This invitation is for ${preview.emailHint}. You must be signed in with that address.`}
          </p>
          {user === null ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>Sign in or create an account with that email address to continue.</p>
              <div className="flex gap-3">
                <Link
                  href="/login"
                  className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50"
                >
                  Create account
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void accept()}
                disabled={busy}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Accept invitation
              </button>
              <button
                type="button"
                onClick={() => void decline()}
                disabled={busy}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
