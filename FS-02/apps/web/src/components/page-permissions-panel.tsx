'use client';

import { useCallback, useState } from 'react';
import { canRestrictMember, type PageAccessRole } from '@conote/shared';
import { api, describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { displayTitle } from '@/lib/page-tree';
import { PAGE_OVERRIDE_OPTIONS, roleLabel } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { FormMessage } from './form-parts';
import { useWorkspace } from './workspace-context';

/**
 * Per-member access overrides for one page (D23). Workspace admins only; the server
 * enforces that, this panel is only shown to admins. Admins and the owner always have full
 * access and cannot be restricted.
 */
export function PagePermissionsPanel({ pageId }: { pageId: string }) {
  const { workspace, pages } = useWorkspace();
  const { guard } = useAuth();
  const load = useCallback(async () => {
    const [permissions, members] = await Promise.all([
      api.listPagePermissions(pageId),
      api.listMembers(workspace.id),
    ]);
    return { permissions, members: members.members };
  }, [pageId, workspace.id]);
  const { data, error, loading, reload } = useLoad(load);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function change(userId: string, value: PageAccessRole | 'INHERIT') {
    setBusyUser(userId);
    setActionError(null);
    try {
      await guard(() =>
        value === 'INHERIT'
          ? api.removePagePermission(pageId, userId)
          : api.setPagePermission(pageId, userId, value),
      );
      reload();
    } catch (e) {
      setActionError(describeApiError(e));
    } finally {
      setBusyUser(null);
    }
  }

  if (error && data === null) return <FormMessage kind="error">{error}</FormMessage>;
  if (data === null || loading)
    return <p className="text-sm text-slate-600">Loading permissions…</p>;

  const restrictable = data.members.filter((m) => canRestrictMember(m.role));
  const titleOf = (id: string) => displayTitle(pages.find((p) => p.id === id)?.title ?? '');

  return (
    <section
      aria-label="Page permissions"
      className="flex flex-col gap-3 rounded-md border border-slate-200 p-4"
    >
      <div>
        <h2 className="text-base font-medium">Who can access this page</h2>
        <p className="text-sm text-slate-600">
          By default everyone uses their workspace role. Set an override to restrict or widen access
          to this page and its subpages. Admins and the owner always have full access.
        </p>
      </div>
      {actionError ? <FormMessage kind="error">{actionError}</FormMessage> : null}
      {restrictable.length === 0 ? (
        <p className="text-sm text-slate-500">There are no members whose access can be changed.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {restrictable.map((member) => {
            const own = data.permissions.overrides.find((o) => o.user.id === member.user.id);
            const inherited = data.permissions.inherited.find((i) => i.user.id === member.user.id);
            const selectId = `override-${member.user.id}`;
            return (
              <li
                key={member.user.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.user.displayName}</p>
                  <p className="text-xs text-slate-500">
                    Workspace role: {roleLabel(member.role)}
                    {own === undefined && inherited !== undefined
                      ? ` · inherits ${roleLabel(inherited.role)} from “${titleOf(inherited.fromPageId)}”`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor={selectId} className="sr-only">
                    {`Access to this page for ${member.user.displayName}`}
                  </label>
                  <select
                    id={selectId}
                    value={own?.role ?? 'INHERIT'}
                    disabled={busyUser === member.user.id}
                    onChange={(e) =>
                      void change(member.user.id, e.target.value as PageAccessRole | 'INHERIT')
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    {PAGE_OVERRIDE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
