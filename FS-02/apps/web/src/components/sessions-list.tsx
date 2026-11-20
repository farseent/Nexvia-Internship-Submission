'use client';

import { useEffect, useState } from 'react';
import type { SessionInfoDto } from '@conote/shared';
import { describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { FormMessage } from './form-parts';

export function SessionsList({ reloadKey = 0 }: { reloadKey?: number }) {
  const { listSessions, revokeSession } = useAuth();
  const [sessions, setSessions] = useState<SessionInfoDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listSessions().then(
      (list) => {
        if (cancelled) return;
        setSessions(list);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeApiError(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [listSessions, reloadKey, refreshKey]);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await revokeSession(id);
      setRefreshKey((n) => n + 1);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setRevoking(null);
    }
  }

  if (error && sessions === null) return <FormMessage kind="error">{error}</FormMessage>;
  if (sessions === null) return <p className="text-sm text-slate-600">Loading sessions…</p>;

  return (
    <div className="flex flex-col gap-3">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-slate-900">
                  {session.userAgent ?? 'Unknown device'}
                </p>

                {session.current ? (
                  <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800">
                    This device
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-slate-500">
                Last active {new Date(session.lastSeenAt).toLocaleString()}
              </p>
            </div>

            {session.current ? null : (
              <button
                type="button"
                onClick={() => void revoke(session.id)}
                disabled={revoking === session.id}
                className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
              >
                {revoking === session.id ? 'Signing out…' : 'Sign out'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
