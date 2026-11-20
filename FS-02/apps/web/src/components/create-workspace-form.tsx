'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createWorkspaceRequestSchema } from '@conote/shared';
import { api, describeApiError, fieldErrorsFromApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { validateForm, type FieldErrors } from '@/lib/form-validation';
import { Field, FormMessage, SubmitButton } from './form-parts';

export function CreateWorkspaceForm() {
  const { guard } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const checked = validateForm(createWorkspaceRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { workspace } = await guard(() => api.createWorkspace(checked.value));
      router.push(`/workspaces/${workspace.id}`);
    } catch (error) {
      setErrors(fieldErrorsFromApi(error));
      setFormError(describeApiError(error));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create a workspace</h1>
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4"
        aria-label="Create workspace"
      >
        {formError ? <FormMessage kind="error">{formError}</FormMessage> : null}
        <Field
          id="workspace-name"
          label="Workspace name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          error={errors['name']}
          hint="For example, a team, a project or a class. You become its owner."
        />
        <div className="flex items-center gap-3">
          <SubmitButton busy={busy}>{busy ? 'Creating…' : 'Create workspace'}</SubmitButton>
          <Link href="/" className="text-sm text-slate-600 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
