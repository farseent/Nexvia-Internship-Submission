'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { displayTitle } from '@/lib/page-tree';
import { FormMessage } from './form-parts';
import { useWorkspace } from './workspace-context';

/** Landing view of a workspace: its top-level pages, or a prompt to create the first one. */
export function WorkspaceHome() {
  const { workspace, tree, canCreateRoot, reloadPages } = useWorkspace();
  const { guard } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createFirstPage() {
    setBusy(true);
    setError(null);
    try {
      const { page } = await guard(() => api.createPage(workspace.id, {}));
      await reloadPages();
      router.push(`/workspaces/${workspace.id}/pages/${page.id}`);
    } catch (e) {
      setError(describeApiError(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {tree.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-600">
          <p>
            {canCreateRoot
              ? 'This workspace has no pages yet.'
              : 'There are no pages you can open yet.'}
          </p>
          {canCreateRoot ? (
            <button
              type="button"
              onClick={() => void createFirstPage()}
              disabled={busy}
              className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create the first page'}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-600">Pick a page from the sidebar, or open one below.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {tree.map(({ page }) => (
              <li key={page.id}>
                <Link
                  href={`/workspaces/${workspace.id}/pages/${page.id}`}
                  className="block truncate rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <span aria-hidden="true" className="mr-1">
                    {page.icon ?? '📄'}
                  </span>
                  {displayTitle(page.title)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
