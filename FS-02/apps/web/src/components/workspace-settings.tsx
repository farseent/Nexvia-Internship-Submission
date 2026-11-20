'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';
import { transferOwnershipRequestSchema, updateWorkspaceRequestSchema } from '@conote/shared';
import { api, describeApiError, fieldErrorsFromApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { validateForm, type FieldErrors } from '@/lib/form-validation';
import { useLoad } from '@/lib/use-load';
import { Field, FormMessage, SubmitButton } from './form-parts';
import { useWorkspace } from './workspace-context';

/** Rename, transfer ownership, leave and delete (WS-04, WS-05, WS-08, WS-09). */
export function WorkspaceSettings() {
  const { isAdmin, isOwner } = useWorkspace();
  return (
    <div className="flex max-w-xl flex-col gap-10">
      <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
      {isAdmin ? (
        <RenameForm />
      ) : (
        <p className="text-sm text-slate-600">Only admins can change workspace details.</p>
      )}
      {isOwner ? <TransferOwnership /> : <LeaveWorkspace />}
      {isOwner ? <DeleteWorkspace /> : null}
    </div>
  );
}

function RenameForm() {
  const { workspace, reloadWorkspace } = useWorkspace();
  const { guard } = useAuth();
  const [name, setName] = useState(workspace.name);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    const checked = validateForm(updateWorkspaceRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await guard(() => api.renameWorkspace(workspace.id, checked.value));
      await reloadWorkspace();
      setMessage({ kind: 'success', text: 'Workspace renamed.' });
    } catch (e) {
      setErrors(fieldErrorsFromApi(e));
      setMessage({ kind: 'error', text: describeApiError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="rename-heading" className="flex flex-col gap-3">
      <h2 id="rename-heading" className="text-lg font-medium">
        Details
      </h2>
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Rename workspace"
        className="flex flex-col gap-3"
      >
        {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
        <Field
          id="settings-name"
          label="Workspace name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          error={errors['name']}
        />
        <div>
          <SubmitButton busy={busy}>{busy ? 'Saving…' : 'Save name'}</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function TransferOwnership() {
  const { workspace, reloadWorkspace } = useWorkspace();
  const { user, guard } = useAuth();
  const load = useCallback(() => api.listMembers(workspace.id), [workspace.id]);
  const { data } = useLoad(load);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = (data?.members ?? []).filter((m) => m.user.id !== user?.id);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    const checked = validateForm(transferOwnershipRequestSchema, { userId, password });
    if (!checked.ok) {
      setErrors(
        checked.errors['userId'] !== undefined
          ? { ...checked.errors, userId: 'Choose the new owner' }
          : checked.errors,
      );
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await guard(() => api.transferOwnership(workspace.id, checked.value));
      await reloadWorkspace();
      setPassword('');
      setUserId('');
      setMessage({ kind: 'success', text: 'Ownership transferred. You are now an admin.' });
    } catch (e) {
      setErrors(fieldErrorsFromApi(e));
      setMessage({ kind: 'error', text: describeApiError(e) });
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="transfer-heading" className="flex flex-col gap-3">
      <h2 id="transfer-heading" className="text-lg font-medium">
        Transfer ownership
      </h2>
      <p className="text-sm text-slate-600">
        The new owner gets full control and you become an admin. Confirm with your password.
      </p>
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Transfer ownership"
        className="flex flex-col gap-3"
      >
        {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="transfer-user" className="text-sm font-medium text-slate-800">
            New owner
          </label>
          <select
            id="transfer-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Choose a member…</option>
            {candidates.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.displayName}
              </option>
            ))}
          </select>
          {errors['userId'] ? <p className="text-xs text-red-700">{errors['userId']}</p> : null}
        </div>
        <Field
          id="transfer-password"
          label="Your password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors['password']}
        />
        <div>
          <SubmitButton busy={busy}>{busy ? 'Transferring…' : 'Transfer ownership'}</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function LeaveWorkspace() {
  const { workspace } = useWorkspace();
  const { user, guard } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (user === null) return;
    setBusy(true);
    setError(null);
    try {
      await guard(() => api.removeMember(workspace.id, user.id));
      router.push('/');
    } catch (e) {
      setError(describeApiError(e));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="leave-heading" className="flex flex-col gap-3">
      <h2 id="leave-heading" className="text-lg font-medium">
        Leave workspace
      </h2>
      <p className="text-sm text-slate-600">
        You will lose access until someone invites you again.
      </p>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void leave()}
            disabled={busy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
          >
            Confirm leave
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
          >
            Leave workspace
          </button>
        </div>
      )}
    </section>
  );
}

function DeleteWorkspace() {
  const { workspace } = useWorkspace();
  const { guard } = useAuth();
  const router = useRouter();
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || confirmName.trim() !== workspace.name) return;
    setBusy(true);
    setError(null);
    try {
      await guard(() => api.deleteWorkspace(workspace.id, { confirmName }));
      router.push('/');
    } catch (e) {
      setError(describeApiError(e));
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="delete-heading"
      className="flex flex-col gap-3 rounded-md border border-red-200 p-4"
    >
      <h2 id="delete-heading" className="text-lg font-medium text-red-800">
        Delete workspace
      </h2>
      <p className="text-sm text-slate-700">
        This permanently deletes the workspace, all its pages, members and invitations. It cannot be
        undone.
      </p>
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Delete workspace"
        className="flex flex-col gap-3"
      >
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Field
          id="delete-confirm"
          label={`Type “${workspace.name}” to confirm`}
          autoComplete="off"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
        />
        <div>
          <button
            type="submit"
            disabled={busy || confirmName.trim() !== workspace.name}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete this workspace'}
          </button>
        </div>
      </form>
    </section>
  );
}
