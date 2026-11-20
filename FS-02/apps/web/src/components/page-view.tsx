'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { roleAtLeast } from '@conote/shared';
import { api, describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { descendantIds, displayTitle, flattenTree } from '@/lib/page-tree';
import { roleLabel } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { PageEditor } from './editor/page-editor';
import { FormMessage } from './form-parts';
import { PagePermissionsPanel } from './page-permissions-panel';
import { canEditPageDto, useWorkspace } from './workspace-context';

/**
 * One page: breadcrumbs, title, the rich-text editor, structure actions (move, delete) and,
 * for workspace admins, the permissions panel. The editor is single-user for now; real-time
 * sync arrives in Phases 5 and 6.
 */
export function PageView({ pageId }: { pageId: string }) {
  // Remount per page so all local state (delete confirmation, panels, errors, title draft) resets.
  return <PageViewInner key={pageId} pageId={pageId} />;
}

export function PageViewInner({ pageId }: { pageId: string }) {
  const { workspace, tree, canCreateRoot, isAdmin, reloadPages } = useWorkspace();
  const { guard } = useAuth();
  const router = useRouter();
  const load = useCallback(() => api.getPage(pageId), [pageId]);
  const { data, error, errorCode, loading, reload } = useLoad(load);

  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);

  const current = data !== null && data.page.id === pageId ? data : null;
  const moveTargets = useMemo(() => {
    if (current === null) return [];
    const excluded = descendantIds(tree, pageId);
    return flattenTree(tree).filter(({ page }) => !excluded.has(page.id) && canEditPageDto(page));
  }, [current, tree, pageId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (current === null) {
    if (error) {
      return (
        <div className="flex max-w-xl flex-col gap-3">
          <FormMessage kind="error">
            {errorCode === 'NOT_FOUND'
              ? 'This page does not exist, or you cannot access it.'
              : error}
          </FormMessage>
          <Link
            href={`/workspaces/${workspace.id}`}
            className="text-sm font-medium text-indigo-700 hover:underline"
          >
            Back to the workspace
          </Link>
        </div>
      );
    }
    return <p className="text-sm text-slate-600">{loading ? 'Loading page…' : ''}</p>;
  }

  const { page, breadcrumbs } = current;
  const canEdit = roleAtLeast(page.myRole, 'EDITOR');

  const saveTitle = () =>
    run(async () => {
      const title = draftTitle ?? page.title;
      if (title === page.title) return;
      await guard(() => api.updatePage(pageId, { title }));
      await reloadPages();
      reload();
    });

  const move = (value: string) =>
    run(async () => {
      const parentId = value === 'ROOT' ? null : value;
      await guard(() => api.movePage(pageId, { parentId }));
      await reloadPages();
      reload();
    });

  const remove = () =>
    run(async () => {
      await guard(() => api.deletePage(pageId));
      await reloadPages();
      router.push(`/workspaces/${workspace.id}`);
    });

  return (
    <article className="flex max-w-4xl flex-col gap-5" aria-label={displayTitle(page.title)}>
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href={`/workspaces/${workspace.id}`} className="hover:underline">
              {workspace.name}
            </Link>
          </li>
          {breadcrumbs.map((crumb) => (
            <li key={crumb.id} className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              <Link
                href={`/workspaces/${workspace.id}/pages/${crumb.id}`}
                className="hover:underline"
              >
                {displayTitle(crumb.title)}
              </Link>
            </li>
          ))}
          <li className="flex items-center gap-1" aria-current="page">
            <span aria-hidden="true">/</span>
            <span className="text-slate-800">{displayTitle(page.title)}</span>
          </li>
        </ol>
      </nav>

      {actionError ? <FormMessage kind="error">{actionError}</FormMessage> : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="page-title" className="sr-only">
          Page title
        </label>
        <input
          id="page-title"
          value={draftTitle ?? page.title}
          maxLength={200}
          readOnly={!canEdit}
          placeholder="Untitled"
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="w-full rounded-md border border-transparent px-1 py-1 text-3xl font-semibold tracking-tight hover:border-slate-200 focus:border-indigo-600 focus:outline-none read-only:hover:border-transparent"
        />
        <p className="px-1 text-xs text-slate-500">
          Your access: {roleLabel(page.myRole)}
          {canEdit ? '' : ' (read only)'}
        </p>
      </div>

      <PageEditor key={page.id} pageId={page.id} canEdit={canEdit} />

      {canEdit || isAdmin ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          {canEdit ? (
            <div className="flex items-center gap-2">
              <label htmlFor="move-target" className="text-sm text-slate-700">
                Move to
              </label>
              <select
                id="move-target"
                value=""
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value !== '') void move(e.target.value);
                }}
                className="max-w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Choose a location…</option>
                {canCreateRoot ? <option value="ROOT">Workspace root</option> : null}
                {moveTargets.map(({ page: target, level }) => (
                  <option key={target.id} value={target.id}>
                    {`${'– '.repeat(level)}${displayTitle(target.title)}`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {isAdmin ? (
            <button
              type="button"
              onClick={() => setShowPermissions((open) => !open)}
              aria-expanded={showPermissions}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Permissions
            </button>
          ) : null}

          {canEdit ? (
            confirmingDelete ? (
              <span className="flex items-center gap-2 text-sm">
                <span>Move this page and its subpages to the trash?</span>
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-700 disabled:opacity-60"
                >
                  Move to trash
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {isAdmin && showPermissions ? <PagePermissionsPanel pageId={pageId} /> : null}
    </article>
  );
}
