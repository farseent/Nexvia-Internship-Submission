'use client';

import Link from 'next/link';
import { useCallback, useSyncExternalStore } from 'react';
import { api } from '@/lib/api-client';
import { readStoredInvite } from '@/lib/invite-storage';
import { roleLabel } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { FormMessage } from './form-parts';

// The stored invite lives in browser storage, outside React, so read it as an external store.
const subscribeNever = () => () => {};
const hasPendingInvite = () => readStoredInvite() !== null;

/** Home page: the workspaces the user belongs to, with a way to create one. */
export function WorkspaceDashboard({ displayName }: { displayName: string }) {
  const load = useCallback(() => api.listWorkspaces(), []);
  const { data, error, loading, reload } = useLoad(load);

  const pendingInvite = useSyncExternalStore(subscribeNever, hasPendingInvite, () => false);

  const workspaces = data?.workspaces ?? null;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6" aria-labelledby="dashboard-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="dashboard-title" className="text-2xl font-semibold tracking-tight">
          {`Welcome, ${displayName}`}
        </h1>
        <Link
          href="/workspaces/new"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New workspace
        </Link>
      </div>

      {pendingInvite ? (
        <p className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
          You have a workspace invitation waiting.{' '}
          <Link href="/invite" className="font-medium underline">
            Review invitation
          </Link>
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Your workspaces</h2>
        {error ? (
          <div className="flex flex-col gap-2">
            <FormMessage kind="error">{error}</FormMessage>
            <button
              type="button"
              onClick={reload}
              className="w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Try again
            </button>
          </div>
        ) : loading && workspaces === null ? (
          <p className="text-sm text-slate-600">Loading workspaces…</p>
        ) : workspaces !== null && workspaces.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-600">
            <p>You are not in any workspace yet.</p>
            <p className="mt-1">
              Create one to get started, or open an invitation link someone sent you.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {(workspaces ?? []).map((workspace) => (
              <li key={workspace.id}>
                <Link
                  href={`/workspaces/${workspace.id}`}
                  className="flex h-full flex-col gap-1 rounded-md border border-slate-200 p-4 hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <span className="truncate font-medium">{workspace.name}</span>
                  <span className="text-xs text-slate-500">{roleLabel(workspace.myRole)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
