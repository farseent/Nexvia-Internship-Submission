'use client';

import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, changePasswordRequestSchema } from '@conote/shared';
import { describeApiError, fieldErrorsFromApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { validateForm, type FieldErrors } from '@/lib/form-validation';
import { Field, FormMessage, SubmitButton } from './form-parts';

export function PasswordForm({ onChanged }: { onChanged?: () => void }) {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);

    const checked = validateForm(changePasswordRequestSchema, { currentPassword, newPassword });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await changePassword(checked.value);
      setCurrentPassword('');
      setNewPassword('');
      setMessage({
        kind: 'success',
        text: 'Password changed. Your other devices have been signed out.',
      });
      onChanged?.();
    } catch (error) {
      setErrors(fieldErrorsFromApi(error));
      setMessage({ kind: 'error', text: describeApiError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      aria-label="Change password"
    >
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <Field
        id="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        error={errors['currentPassword']}
      />
      <Field
        id="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        error={errors['newPassword']}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      />
      <div>
        <SubmitButton busy={busy}>{busy ? 'Changing…' : 'Change password'}</SubmitButton>
      </div>
    </form>
  );
}
