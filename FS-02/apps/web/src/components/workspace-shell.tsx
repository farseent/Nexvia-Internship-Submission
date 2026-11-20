'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { workspaceRoleAtLeast, type PageDto, type WorkspaceDto } from '@conote/shared';
import { ApiError, api, describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { ancestorIds, buildPageTree } from '@/lib/page-tree';
import { PageTreeNav } from './page-tree-nav';
import { WorkspaceContext, type WorkspaceContextValue } from './workspace-context';
import { FormMessage } from './form-parts';

const PAGE_PATH = /^\/workspaces\/[^/]+\/pages\/([^/]+)/;

/**
 * Workspace layout: a responsive page sidebar beside the content. On small screens the
 * sidebar is a toggled panel. Loads the workspace and its page list (PAGE-02) once and
 * shares them with the pages below through context.
 */
export function WorkspaceShell({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  // Remount per workspace so all local state (workspace, errors, expanded nodes) resets.
  return (
    <WorkspaceShellInner key={workspaceId} workspaceId={workspaceId}>
      {children}
    </WorkspaceShellInner>
  );
}

function WorkspaceShellInner({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const { guard } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null);
  const [pages, setPages] = useState<PageDto[]>([]);
  const [error, setError] = useState<{ message: string; missing: boolean } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [navOpen, setNavOpen] = useState(false);
  const [creatingFor, setCreatingFor] = useState<string | 'root' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentPageId = PAGE_PATH.exec(pathname)?.[1] ?? null;

  const reloadPages = useCallback(async () => {
    const result = await guard(() => api.listPages(workspaceId));
    setPages(result.pages);
  }, [guard, workspaceId]);

  const reloadWorkspace = useCallback(async () => {
    const result = await guard(() => api.getWorkspace(workspaceId));
    setWorkspace(result.workspace);
  }, [guard, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      guard(() => api.getWorkspace(workspaceId)),
      guard(() => api.listPages(workspaceId)),
    ]).then(
      ([w, p]) => {
        if (cancelled) return;
        setWorkspace(w.workspace);
        setPages(p.pages);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError({
          message: describeApiError(e),
          missing: e instanceof ApiError && e.code === 'NOT_FOUND',
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [guard, workspaceId]);

  // Keep the current page visible: expand its ancestors when the page or page list changes.
  // Adjusting state during render (guarded, so it settles in one extra pass) avoids an effect.
  const [openedFor, setOpenedFor] = useState<{ pageId: string; pages: PageDto[] } | null>(null);
  if (
    currentPageId !== null &&
    (openedFor?.pageId !== currentPageId || openedFor.pages !== pages)
  ) {
    setOpenedFor({ pageId: currentPageId, pages });
    const toOpen = ancestorIds(pages, currentPageId);
    if (toOpen.length > 0 && !toOpen.every((id) => expanded.has(id))) {
      setExpanded(new Set([...expanded, ...toOpen]));
    }
  }

  const tree = useMemo(() => buildPageTree(pages), [pages]);

  const createPage = useCallback(
    async (parentId: string | null) => {
      setCreatingFor(parentId ?? 'root');
      setActionError(null);
      try {
        const { page } = await guard(() =>
          api.createPage(workspaceId, parentId === null ? {} : { parentId }),
        );
        await reloadPages();
        if (parentId !== null) setExpanded((previous) => new Set([...previous, parentId]));
        setNavOpen(false);
        router.push(`/workspaces/${workspaceId}/pages/${page.id}`);
      } catch (e) {
        setActionError(describeApiError(e));
      } finally {
        setCreatingFor(null);
      }
    },
    [guard, reloadPages, router, workspaceId],
  );

  if (error !== null) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 py-10">
        <FormMessage kind="error">
          {error.missing
            ? 'This workspace does not exist, or you are not a member of it.'
            : error.message}
        </FormMessage>
        <Link href="/" className="text-sm font-medium text-indigo-700 hover:underline">
          Back to your workspaces
        </Link>
      </div>
    );
  }
  if (workspace === null) return <p className="py-10 text-sm text-slate-600">Loading workspace…</p>;

  const isAdmin = workspaceRoleAtLeast(workspace.myRole, 'ADMIN');
  const canCreateRoot = workspaceRoleAtLeast(workspace.myRole, 'EDITOR');
  const value: WorkspaceContextValue = {
    workspace,
    pages,
    tree,
    canCreateRoot,
    isAdmin,
    isOwner: workspace.myRole === 'OWNER',
    reloadPages,
    reloadWorkspace,
  };

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      onClick={() => setNavOpen(false)}
      aria-current={pathname === href ? 'page' : undefined}
      className={`rounded-md px-2 py-1.5 text-sm hover:bg-slate-100 ${
        pathname === href ? 'bg-slate-100 font-medium' : ''
      }`}
    >
      {label}
    </Link>
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="flex flex-col gap-4 md:flex-row md:gap-8">
        <div className="flex items-center justify-between md:hidden">
          <Link href={`/workspaces/${workspace.id}`} className="truncate font-medium">
            {workspace.name}
          </Link>
          <button
            type="button"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
            aria-controls="workspace-sidebar"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {navOpen ? 'Close pages' : 'Pages'}
          </button>
        </div>

        <aside
          id="workspace-sidebar"
          aria-label="Workspace navigation"
          className={`${navOpen ? 'flex' : 'hidden'} w-full shrink-0 flex-col gap-4 md:flex md:w-64`}
        >
          <div className="hidden min-w-0 md:block">
            <Link
              href={`/workspaces/${workspace.id}`}
              className="block truncate text-base font-semibold tracking-tight"
            >
              {workspace.name}
            </Link>
            <p className="text-xs text-slate-500">Your role: {workspace.myRole.toLowerCase()}</p>
          </div>

          <nav aria-label="Workspace sections" className="flex flex-col gap-0.5">
            {navLink(`/workspaces/${workspace.id}/members`, 'Members & invitations')}
            {navLink(`/workspaces/${workspace.id}/settings`, 'Settings')}
            {canCreateRoot ? navLink(`/workspaces/${workspace.id}/trash`, 'Trash') : null}
          </nav>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pages
              </h2>
              {canCreateRoot ? (
                <button
                  type="button"
                  onClick={() => void createPage(null)}
                  disabled={creatingFor === 'root'}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
                >
                  {creatingFor === 'root' ? 'Creating…' : 'New page'}
                </button>
              ) : null}
            </div>
            {actionError ? <FormMessage kind="error">{actionError}</FormMessage> : null}
            {tree.length === 0 ? (
              <p className="text-sm text-slate-500">
                {canCreateRoot ? 'No pages yet. Create the first one.' : 'No pages to show.'}
              </p>
            ) : (
              <PageTreeNav
                nodes={tree}
                workspaceId={workspace.id}
                currentPageId={currentPageId}
                expanded={expanded}
                onToggle={(id) =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onAddChild={(parentId) => void createPage(parentId)}
                busyParentId={creatingFor === 'root' ? null : creatingFor}
                onNavigate={() => setNavOpen(false)}
              />
            )}
          </div>
        </aside>

        <section className="min-w-0 flex-1">{children}</section>
      </div>
    </WorkspaceContext.Provider>
  );
}
