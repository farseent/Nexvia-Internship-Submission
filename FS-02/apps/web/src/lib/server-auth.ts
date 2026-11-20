import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionCookieName, sessionResponseSchema, type UserDto } from '@conote/shared';
import { getWebEnv } from '@/env';

/**
 * Resolve the signed-in user for a server component by asking the API directly
 * (API_INTERNAL_URL) with the browser's session cookie forwarded explicitly (D6).
 * Returns null when there is no valid session. Any other failure (API down, bad
 * response) throws, so an outage is never mistaken for "signed out". Cached per request.
 */
export const getSessionUser = cache(async (): Promise<UserDto | null> => {
  // `cookies()` first: it opts the page into per-request rendering, so nothing here runs
  // (or needs runtime environment variables) while Next.js prerenders at build time.
  const cookieStore = await cookies();
  const env = getWebEnv();
  const cookieName = sessionCookieName(env.NODE_ENV);
  const token = cookieStore.get(cookieName)?.value;
  if (token === undefined || token === '') return null;

  // Keep the client's address so API rate limits are not charged to the web server.
  const forwardedFor = (await headers()).get('x-forwarded-for');
  const response = await fetch(`${env.API_INTERNAL_URL}/api/v1/auth/session`, {
    cache: 'no-store',
    headers: {
      cookie: `${cookieName}=${token}`,
      ...(forwardedFor === null ? {} : { 'x-forwarded-for': forwardedFor }),
    },
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Session lookup failed (HTTP ${response.status}).`);

  const parsed = sessionResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Session lookup returned an unexpected response.');
  return parsed.data.data.user;
});

/** For protected pages: the user, or a redirect to the login page. */
export async function requireUser(): Promise<UserDto> {
  const user = await getSessionUser();
  if (user === null) redirect('/login');
  return user;
}

/** For login/register pages: bounce signed-in users to the app. */
export async function redirectIfSignedIn(): Promise<void> {
  if ((await getSessionUser()) !== null) redirect('/');
}
