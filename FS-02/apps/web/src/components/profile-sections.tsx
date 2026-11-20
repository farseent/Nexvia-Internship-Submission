'use client';

import { useState } from 'react';
import { PasswordForm } from './password-form';
import { ProfileForm } from './profile-form';
import { SessionsList } from './sessions-list';

/** Profile, password and active sessions. Reloads the session list after a password change. */
export function ProfileSections() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <>
      <section aria-labelledby="profile-heading" className="flex max-w-md flex-col gap-4">
        <h2 id="profile-heading" className="text-lg font-semibold">
          Profile
        </h2>
        <ProfileForm />
      </section>
      <section aria-labelledby="password-heading" className="flex max-w-md flex-col gap-4">
        <h2 id="password-heading" className="text-lg font-semibold">
          Password
        </h2>
        <PasswordForm onChanged={() => setReloadKey((n) => n + 1)} />
      </section>
      <section aria-labelledby="sessions-heading" className="flex flex-col gap-4">
        <h2 id="sessions-heading" className="text-lg font-semibold">
          Where you are signed in
        </h2>
        <SessionsList reloadKey={reloadKey} />
      </section>
    </>
  );
}
