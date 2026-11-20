'use client';

import { useCallback, useState } from 'react';
import { PAGE_RETENTION_DAYS } from '@conote/shared';
import { api, describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { displayTitle } from '@/lib/page-tree';
import { useLoad } from '@/lib/use-load';
import { FormMessage } from './form-parts';
import { useWorkspace } from './workspace-context';

/** Deleted pages (PAGE-08): restore, or purge permanently (admins). */
export function TrashList() {
  const { workspace, isAdmin, canCreateRoot, reloadPages } = useWorkspace();
  const { guard } = useAuth();
  const load = useCallback(() => api.listTrash(workspace.id), [workspace.id]);
  const { data, error, reload } = useLoad(load);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(pageId: string, action: () => Promise<unknown>) {
    setBusyId(pageId);
    setActionError(null);
    try {
      await guard(action);
      setConfirmPurge(null);
      await reloadPages();
      reload();
    } catch (e) {
      setActionError(describeApiError(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!canCreateRoot) {
    return <p className="text-sm text-slate-600">Only editors and above can see the trash.</p>;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
      <p className="text-sm text-slate-600">
        {`Deleted pages are kept for ${PAGE_RETENTION_DAYS} days, then removed permanently.`}
      </p>
      {actionError ? <FormMessage kind="error">{actionError}</FormMessage> : null}
      {error && data === null ? <FormMessage kind="error">{error}</FormMessage> : null}
      {data === null ? (
        error ? null : (
          <p className="text-sm text-slate-600">Loading…</p>
        )
      ) : data.pages.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
          The trash is empty.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {data.pages.map((page) => (
            <li
              key={page.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{displayTitle(page.title)}</p>
                <p className="text-xs text-slate-500">
                  {page.deletedAt !== null
                    ? `Deleted ${new Date(page.deletedAt).toLocaleString()}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === page.id}
                  onClick={() => void act(page.id, () => api.restorePage(page.id))}
                  aria-label={`Restore ${displayTitle(page.title)}`}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                >
                  Restore
                </button>
                {isAdmin ? (
                  confirmPurge === page.id ? (
                    <span className="flex items-center gap-1 text-sm">
                      <button
                        type="button"
                        disabled={busyId === page.id}
                        onClick={() => void act(page.id, () => api.purgePage(page.id))}
                        className="rounded-md bg-red-600 px-2.5 py-1.5 text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        Delete forever
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmPurge(null)}
                        className="rounded-md border border-slate-300 px-2.5 py-1.5 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmPurge(page.id)}
                      aria-label={`Permanently delete ${displayTitle(page.title)}`}
                      className="rounded-md border border-red-300 px-2.5 py-1.5 text-sm text-red-700 hover:bg-red-50"
                    >
                      Delete permanently
                    </button>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
