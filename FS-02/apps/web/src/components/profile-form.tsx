'use client';

import { useState, type FormEvent } from 'react';
import { PRESENCE_COLORS, updateProfileRequestSchema } from '@conote/shared';
import { describeApiError, fieldErrorsFromApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { validateForm, type FieldErrors } from '@/lib/form-validation';
import { Field, FormMessage, SubmitButton } from './form-parts';

export function ProfileForm() {
  const { user, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [presenceColor, setPresenceColor] = useState(user?.presenceColor ?? PRESENCE_COLORS[0]!);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (user === null) return null;
  // Keep the user's current colour selectable even if it is no longer in the palette.
  const swatches = PRESENCE_COLORS.includes(user.presenceColor)
    ? PRESENCE_COLORS
    : [user.presenceColor, ...PRESENCE_COLORS];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage(null);

    const checked = validateForm(updateProfileRequestSchema, { displayName, presenceColor });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await updateProfile(checked.value);
      setMessage({ kind: 'success', text: 'Profile updated.' });
    } catch (error) {
      setErrors(fieldErrorsFromApi(error));
      setMessage({ kind: 'error', text: describeApiError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Profile">
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <Field
        id="profile-email"
        label="Email"
        value={user.email}
        readOnly
        disabled
        hint="Email cannot be changed."
      />
      <Field
        id="profile-displayName"
        label="Display name"
        autoComplete="name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        error={errors['displayName']}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-800">Presence colour</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Presence colour">
          {swatches.map((color) => (
            <label key={color} className="cursor-pointer">
              <input
                type="radio"
                name="presenceColor"
                value={color}
                checked={presenceColor.toUpperCase() === color.toUpperCase()}
                onChange={() => setPresenceColor(color)}
                className="peer sr-only"
              />
              <span
                aria-label={color}
                style={{ backgroundColor: color }}
                className="block h-8 w-8 rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-slate-900 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500"
              />
            </label>
          ))}
        </div>
        {errors['presenceColor'] ? (
          <p className="text-xs text-red-700">{errors['presenceColor']}</p>
        ) : null}
      </fieldset>
      <div>
        <SubmitButton busy={busy}>{busy ? 'Saving…' : 'Save changes'}</SubmitButton>
      </div>
    </form>
  );
}
