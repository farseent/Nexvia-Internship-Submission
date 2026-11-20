'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';
import {
  ASSIGNABLE_ROLES,
  canInviteWithRole,
  createInvitationRequestSchema,
  decideRemoval,
  decideRoleChange,
  type AssignableRole,
  type MemberDto,
} from '@conote/shared';
import { api, describeApiError, fieldErrorsFromApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { validateForm, type FieldErrors } from '@/lib/form-validation';
import { ROLE_DESCRIPTIONS, roleLabel } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { Field, FormMessage, SubmitButton } from './form-parts';
import { useWorkspace } from './workspace-context';

/** Members, role changes, removal and invitations (docs/API_CONTRACTS.md §5–§6). */
export function MembersManager() {
  const { workspace, isAdmin } = useWorkspace();
  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      <MemberList />
      {isAdmin ? <Invitations workspaceId={workspace.id} /> : null}
    </div>
  );
}

function MemberList() {
  const { workspace } = useWorkspace();
  const { user, guard } = useAuth();
  const router = useRouter();
  const load = useCallback(() => api.listMembers(workspace.id), [workspace.id]);
  const { data, error, loading, reload } = useLoad(load);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const myRole = workspace.myRole;

  async function changeRole(member: MemberDto, role: AssignableRole) {
    setBusyUser(member.user.id);
    setActionError(null);
    try {
      await guard(() => api.changeMemberRole(workspace.id, member.user.id, role));
      reload();
    } catch (e) {
      setActionError(describeApiError(e));
    } finally {
      setBusyUser(null);
    }
  }

  async function remove(member: MemberDto, self: boolean) {
    setBusyUser(member.user.id);
    setActionError(null);
    try {
      await guard(() => api.removeMember(workspace.id, member.user.id));
      setConfirmRemove(null);
      if (self) {
        router.push('/');
        return;
      }
      reload();
    } catch (e) {
      setActionError(describeApiError(e));
    } finally {
      setBusyUser(null);
    }
  }

  if (error && data === null) return <FormMessage kind="error">{error}</FormMessage>;
  if (data === null || (loading && data === null)) {
    return <p className="text-sm text-slate-600">Loading members…</p>;
  }

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-3">
      <h2 id="members-heading" className="text-lg font-medium">
        {`People in ${workspace.name} (${data.members.length})`}
      </h2>
      {actionError ? <FormMessage kind="error">{actionError}</FormMessage> : null}
      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
        {data.members.map((member) => {
          const self = member.user.id === user?.id;
          const removal = decideRemoval(myRole, member.role, self);
          const roleOptions = ASSIGNABLE_ROLES.map((role) => ({
            role,
            allowed: decideRoleChange(myRole, member.role, role) === 'ALLOWED',
          }));
          const canChangeRole = roleOptions.some((o) => o.allowed);
          const selectId = `role-${member.user.id}`;
          return (
            <li
              key={member.user.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: member.user.presenceColor }}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.user.displayName}
                    {self ? ' (you)' : ''}
                  </p>
                  {member.email !== undefined ? (
                    <p className="truncate text-xs text-slate-500">{member.email}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canChangeRole ? (
                  <>
                    <label htmlFor={selectId} className="sr-only">
                      {`Role of ${member.user.displayName}`}
                    </label>
                    <select
                      id={selectId}
                      value={member.role}
                      disabled={busyUser === member.user.id}
                      onChange={(e) => void changeRole(member, e.target.value as AssignableRole)}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      {roleOptions.map(({ role, allowed }) => (
                        <option key={role} value={role} disabled={!allowed && role !== member.role}>
                          {roleLabel(role)}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {roleLabel(member.role)}
                  </span>
                )}
                {removal === 'ALLOWED' ? (
                  confirmRemove === member.user.id ? (
                    <span className="flex items-center gap-1 text-sm">
                      <button
                        type="button"
                        onClick={() => void remove(member, self)}
                        disabled={busyUser === member.user.id}
                        className="rounded-md bg-red-600 px-2.5 py-1.5 text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {self ? 'Confirm leave' : 'Confirm remove'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(null)}
                        className="rounded-md border border-slate-300 px-2.5 py-1.5 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(member.user.id)}
                      aria-label={
                        self
                          ? 'Leave workspace'
                          : `Remove ${member.user.displayName} from the workspace`
                      }
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
                    >
                      {self ? 'Leave' : 'Remove'}
                    </button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer">What can each role do?</summary>
        <dl className="mt-2 flex flex-col gap-1">
          {(['OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER'] as const).map((role) => (
            <div key={role} className="flex flex-col sm:flex-row sm:gap-2">
              <dt className="w-24 shrink-0 font-medium">{roleLabel(role)}</dt>
              <dd>{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

function Invitations({ workspaceId }: { workspaceId: string }) {
  const { workspace } = useWorkspace();
  const { guard } = useAuth();
  const load = useCallback(() => api.listInvitations(workspaceId), [workspaceId]);
  const { data, error, reload } = useLoad(load);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('EDITOR');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const invitableRoles = ASSIGNABLE_ROLES.filter((r) => canInviteWithRole(workspace.myRole, r));

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const checked = validateForm(createInvitationRequestSchema, { email, role });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const result = await guard(() => api.createInvitation(workspaceId, checked.value));
      setLink({ email: result.invitation.email, url: result.inviteUrl });
      setCopied(false);
      setEmail('');
      reload();
    } catch (e) {
      setErrors(fieldErrorsFromApi(e));
      setFormError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitationId: string) {
    setActionError(null);
    try {
      await guard(() => api.revokeInvitation(workspaceId, invitationId));
      reload();
    } catch (e) {
      setActionError(describeApiError(e));
    }
  }

  async function resend(invitationId: string) {
    setActionError(null);
    try {
      const result = await guard(() => api.resendInvitation(workspaceId, invitationId));
      setLink({ email: result.invitation.email, url: result.inviteUrl });
      setCopied(false);
      reload();
    } catch (e) {
      setActionError(describeApiError(e));
    }
  }

  async function copyLink() {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="invitations-heading" className="flex flex-col gap-4">
      <h2 id="invitations-heading" className="text-lg font-medium">
        Invite people
      </h2>
      <form
        onSubmit={onInvite}
        noValidate
        aria-label="Invite a member"
        className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1">
          <Field
            id="invite-email"
            label="Email address"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors['email']}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="invite-role" className="text-sm font-medium text-slate-800">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as AssignableRole)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {invitableRoles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton busy={busy}>{busy ? 'Creating link…' : 'Create invitation'}</SubmitButton>
      </form>
      {formError ? <FormMessage kind="error">{formError}</FormMessage> : null}

      {link !== null ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm"
        >
          <p className="text-green-900">
            {`Invitation link for ${link.email}. Send it to them yourself; it is shown only now and expires in 7 days.`}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              aria-label="Invitation link"
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-green-300 bg-white px-2 py-1.5 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-md border border-green-400 bg-white px-3 py-1.5 hover:bg-green-100"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      ) : null}

      {actionError ? <FormMessage kind="error">{actionError}</FormMessage> : null}
      {error && data === null ? <FormMessage kind="error">{error}</FormMessage> : null}
      {data !== null ? (
        data.invitations.length === 0 ? (
          <p className="text-sm text-slate-500">No invitations yet.</p>
        ) : (
          <ul
            aria-label="Invitations"
            className="divide-y divide-slate-200 rounded-md border border-slate-200"
          >
            {data.invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{invitation.email}</p>
                  <p className="text-xs text-slate-500">
                    {`${roleLabel(invitation.role)} · ${invitation.status.toLowerCase()}`}
                    {invitation.invitedBy !== null
                      ? ` · invited by ${invitation.invitedBy.displayName}`
                      : ''}
                  </p>
                </div>
                {invitation.status === 'PENDING' || invitation.status === 'EXPIRED' ? (
                  <div className="flex gap-2">
                    {invitation.role !== 'ADMIN' || workspace.myRole === 'OWNER' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void resend(invitation.id)}
                          aria-label={`Resend invitation to ${invitation.email}`}
                          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
                        >
                          {invitation.status === 'EXPIRED' ? 'Renew' : 'Resend'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void revoke(invitation.id)}
                          aria-label={`Revoke invitation to ${invitation.email}`}
                          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
                        >
                          Revoke
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
