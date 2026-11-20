'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, registerRequestSchema } from '@conote/shared';
import { ApiError, describeApiError, fieldErrorsFromApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { validateForm, type FieldErrors } from '@/lib/form-validation';
import { Field, FormMessage, SubmitButton } from './form-parts';

export function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);

    const checked = validateForm(registerRequestSchema, { displayName, email, password });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await register(checked.value);
      router.replace('/');
      router.refresh();
    } catch (error) {
      const fromApi = fieldErrorsFromApi(error);
      setErrors(
        error instanceof ApiError && error.code === 'EMAIL_TAKEN'
          ? { ...fromApi, email: 'An account with this email already exists.' }
          : fromApi,
      );
      setFormError(describeApiError(error));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      aria-label="Create account"
    >
      {formError ? <FormMessage kind="error">{formError}</FormMessage> : null}
      <Field
        id="displayName"
        label="Display name"
        autoComplete="name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        error={errors['displayName']}
      />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors['email']}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors['password']}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      />
      <SubmitButton busy={busy}>{busy ? 'Creating account…' : 'Create account'}</SubmitButton>
      <p className="text-sm text-slate-600">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-indigo-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
