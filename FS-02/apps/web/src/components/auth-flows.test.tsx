// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfoDto, UserDto } from '@conote/shared';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { AppHeader } from './app-header';
import { LoginForm } from './login-form';
import { PasswordForm } from './password-form';
import { ProfileForm } from './profile-form';
import { RegisterForm } from './register-form';
import { SessionsList } from './sessions-list';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const USER: UserDto = {
  id: '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11',
  email: 'ada@example.com',
  displayName: 'Ada',
  presenceColor: '#0284C7',
  avatarUrl: null,
  createdAt: '2026-11-13T00:00:00.000Z',
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

type Handler = (call: Call) => { status: number; body: unknown; headers?: Record<string, string> };

/** Stub `fetch` with routes keyed "METHOD /path"; records every call. */
function stubApi(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = {
        method: init.method ?? 'GET',
        url,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const handler = routes[`${call.method} ${url}`];
      if (!handler) throw new Error(`unexpected request: ${call.method} ${url}`);
      const { status, body, headers } = handler(call);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    }),
  );
  return calls;
}

const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
const fail = (
  status: number,
  code: string,
  extra: object = {},
  headers?: Record<string, string>,
) => ({
  status,
  body: { success: false, error: { code, message: 'server message', requestId: 'r1', ...extra } },
  ...(headers ? { headers } : {}),
});

/** Shows the auth state so tests can assert on it. */
function Probe() {
  const { user } = useAuth();
  return <p data-testid="probe">{user ? `signed-in:${user.displayName}` : 'signed-out'}</p>;
}

function renderWithAuth(ui: ReactNode, initialUser: UserDto | null = null) {
  return render(
    <AuthProvider initialUser={initialUser}>
      {ui}
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  router.replace.mockClear();
  router.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('login form', () => {
  it('validates before calling the API', async () => {
    const calls = stubApi({});
    renderWithAuth(<LoginForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(screen.getByText('Enter your password')).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId('probe').textContent).toBe('signed-out');
  });

  it('signs in: sends normalized credentials, updates auth state, redirects home', async () => {
    const calls = stubApi({ 'POST /api/v1/auth/login': () => ok({ user: USER }) });
    renderWithAuth(<LoginForm />);

    await userEvent.type(screen.getByLabelText('Email'), '  Ada@Example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'my password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { email: 'ada@example.com', password: 'my password' },
      },
    ]);
    expect(screen.getByTestId('probe').textContent).toBe('signed-in:Ada');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows one generic message for bad credentials, clears the password, stays signed out', async () => {
    stubApi({ 'POST /api/v1/auth/login': () => fail(401, 'INVALID_CREDENTIALS') });
    renderWithAuth(<LoginForm />);

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Incorrect email or password.');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ada@example.com');
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').textContent).toBe('signed-out');
  });

  it('tells the user how long to wait when rate limited', async () => {
    stubApi({
      'POST /api/v1/auth/login': () => fail(429, 'RATE_LIMITED', {}, { 'retry-after': '600' }),
    });
    renderWithAuth(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('10 minutes');
  });

  it('reports an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderWithAuth(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach the server/);
  });

  it('submits only once when the button is pressed repeatedly', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchMock = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({ success: true, data: { user: USER } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithAuth(<LoginForm />);

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    const button = screen.getByRole('button', { name: 'Sign in' });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Signing in…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    release();
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
  });

  it('uses password-manager friendly attributes and a masked field', () => {
    renderWithAuth(<LoginForm />);
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('current-password');
    expect((screen.getByLabelText('Email') as HTMLInputElement).autocomplete).toBe('email');
  });
});

describe('registration form', () => {
  it('enforces the password policy client-side', async () => {
    const calls = stubApi({});
    renderWithAuth(<RegisterForm />);
    await userEvent.type(screen.getByLabelText('Display name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use at least 12 characters')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('creates the account, signs in and redirects', async () => {
    const calls = stubApi({ 'POST /api/v1/auth/register': () => ok({ user: USER }) });
    renderWithAuth(<RegisterForm />);
    await userEvent.type(screen.getByLabelText('Display name'), '  Ada  ');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(calls[0]?.body).toEqual({
      displayName: 'Ada',
      email: 'ada@example.com',
      password: 'a long enough passphrase',
    });
    expect(screen.getByTestId('probe').textContent).toBe('signed-in:Ada');
  });

  it('marks the email field when it is already registered', async () => {
    stubApi({ 'POST /api/v1/auth/register': () => fail(409, 'EMAIL_TAKEN') });
    renderWithAuth(<RegisterForm />);
    await userEvent.type(screen.getByLabelText('Display name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const email = await screen.findByLabelText('Email');
    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    expect(
      screen.getAllByText('An account with this email already exists.').length,
    ).toBeGreaterThan(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows server-side field errors next to their fields', async () => {
    stubApi({
      'POST /api/v1/auth/register': () =>
        fail(400, 'VALIDATION_ERROR', {
          details: [{ path: 'displayName', message: 'Server says no' }],
        }),
    });
    renderWithAuth(<RegisterForm />);
    await userEvent.type(screen.getByLabelText('Display name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Server says no')).toBeTruthy();
  });
});

describe('profile form', () => {
  it('updates the profile and reflects it in the auth state', async () => {
    const calls = stubApi({
      'PATCH /api/v1/users/me': () =>
        ok({ user: { ...USER, displayName: 'Ada L.', presenceColor: '#16A34A' } }),
    });
    renderWithAuth(<ProfileForm />, USER);

    const name = screen.getByLabelText('Display name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ada L.');
    await userEvent.click(screen.getByLabelText('#16A34A'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Profile updated.')).toBeTruthy();
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      body: { displayName: 'Ada L.', presenceColor: '#16A34A' },
    });
    expect(screen.getByTestId('probe').textContent).toBe('signed-in:Ada L.');
  });

  it('keeps the email read-only and rejects a blank name locally', async () => {
    const calls = stubApi({});
    renderWithAuth(<ProfileForm />, USER);
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    expect(email.readOnly).toBe(true);
    expect(email.disabled).toBe(true);

    await userEvent.clear(screen.getByLabelText('Display name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a display name')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('signs the user out locally when the session turned out to be gone (401)', async () => {
    stubApi({ 'PATCH /api/v1/users/me': () => fail(401, 'UNAUTHENTICATED') });
    renderWithAuth(<ProfileForm />, USER);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(screen.getByTestId('probe').textContent).toBe('signed-out');
  });
});

describe('password form', () => {
  const fill = async (current: string, next: string) => {
    await userEvent.type(screen.getByLabelText('Current password'), current);
    await userEvent.type(screen.getByLabelText('New password'), next);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
  };

  it('changes the password, clears the fields and confirms', async () => {
    const onChanged = vi.fn();
    const calls = stubApi({ 'POST /api/v1/auth/password': () => ok(null) });
    renderWithAuth(<PasswordForm onChanged={onChanged} />, USER);
    await fill('old password!', 'a brand new passphrase');

    expect((await screen.findByRole('status')).textContent).toMatch(/Password changed/);
    expect(calls[0]?.body).toEqual({
      currentPassword: 'old password!',
      newPassword: 'a brand new passphrase',
    });
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe').textContent).toBe('signed-in:Ada'); // stays signed in
  });

  it('shows a wrong current password as an error without signing out', async () => {
    stubApi({ 'POST /api/v1/auth/password': () => fail(401, 'INVALID_CREDENTIALS') });
    renderWithAuth(<PasswordForm />, USER);
    await fill('not my password', 'a brand new passphrase');

    expect((await screen.findByRole('alert')).textContent).toBe('Incorrect email or password.');
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').textContent).toBe('signed-in:Ada');
  });

  it('applies the password policy to the new password locally', async () => {
    const calls = stubApi({});
    renderWithAuth(<PasswordForm />, USER);
    await fill('old password!', 'short');
    expect(await screen.findByText('Use at least 12 characters')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe('header and logout', () => {
  it('renders nothing when signed out', () => {
    const { container } = renderWithAuth(<AppHeader />, null);
    expect(container.querySelector('header')).toBeNull();
  });

  it('logs out: calls the API, clears state, returns to /login', async () => {
    const calls = stubApi({ 'POST /api/v1/auth/logout': () => ok(null) });
    renderWithAuth(<AppHeader />, USER);
    expect(screen.getByText('Ada')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(calls).toEqual([{ method: 'POST', url: '/api/v1/auth/logout', body: {} }]);
    expect(screen.getByTestId('probe').textContent).toBe('signed-out');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('still leaves the app when the session was already gone (401)', async () => {
    stubApi({ 'POST /api/v1/auth/logout': () => fail(401, 'UNAUTHENTICATED') });
    renderWithAuth(<AppHeader />, USER);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(screen.getByTestId('probe').textContent).toBe('signed-out');
  });

  it('does NOT pretend to be signed out when logout fails for another reason', async () => {
    stubApi({ 'POST /api/v1/auth/logout': () => fail(503, 'SERVICE_UNAVAILABLE') });
    renderWithAuth(<AppHeader />, USER);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not sign out/);
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').textContent).toBe('signed-in:Ada');
  });
});

describe('active sessions', () => {
  const session = (over: Partial<SessionInfoDto>): SessionInfoDto => ({
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-11-13T00:00:00.000Z',
    lastSeenAt: '2026-11-13T00:00:00.000Z',
    expiresAt: '2026-11-20T00:00:00.000Z',
    userAgent: 'TestBrowser/1',
    current: false,
    ...over,
  });
  const current = session({
    id: '22222222-2222-4222-8222-222222222222',
    current: true,
    userAgent: 'ThisBrowser',
  });
  const other = session({ id: '33333333-3333-4333-8333-333333333333', userAgent: 'OtherPhone' });

  it('lists sessions, flags this device and offers sign-out only for others', async () => {
    stubApi({ 'GET /api/v1/auth/sessions': () => ok({ sessions: [current, other] }) });
    renderWithAuth(<SessionsList />, USER);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('This device')).toBeTruthy();
    expect(within(items[0]!).queryByRole('button')).toBeNull();
    expect(within(items[1]!).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('revokes another session and reloads the list', async () => {
    let sessions = [current, other];
    const calls = stubApi({
      'GET /api/v1/auth/sessions': () => ok({ sessions }),
      [`DELETE /api/v1/auth/sessions/${other.id}`]: () => {
        sessions = [current];
        return ok(null);
      },
    });
    renderWithAuth(<SessionsList />, USER);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/auth/sessions',
      `DELETE /api/v1/auth/sessions/${other.id}`,
      'GET /api/v1/auth/sessions',
    ]);
  });

  it('shows an error if the list cannot be loaded', async () => {
    stubApi({ 'GET /api/v1/auth/sessions': () => fail(503, 'SERVICE_UNAVAILABLE') });
    renderWithAuth(<SessionsList />, USER);
    expect((await screen.findByRole('alert')).textContent).toMatch(/temporarily unavailable/);
  });

  it('returns to the login page if the session expired while the page was open', async () => {
    stubApi({ 'GET /api/v1/auth/sessions': () => fail(401, 'UNAUTHENTICATED') });
    renderWithAuth(<SessionsList />, USER);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(screen.getByTestId('probe').textContent).toBe('signed-out');
  });
});
