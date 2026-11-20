'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  SessionInfoDto,
  UpdateProfileRequest,
  UserDto,
} from '@conote/shared';
import { ApiError, api } from './api-client';

export interface AuthContextValue {
  /** The signed-in user, or null when signed out. Seeded by the server, kept current here. */
  user: UserDto | null;
  login(input: LoginRequest): Promise<void>;
  register(input: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
  updateProfile(input: UpdateProfileRequest): Promise<void>;
  changePassword(input: ChangePasswordRequest): Promise<void>;
  listSessions(): Promise<SessionInfoDto[]>;
  revokeSession(sessionId: string): Promise<void>;
  /**
   * Run any authenticated API call: an UNAUTHENTICATED answer (expired or revoked session)
   * signs the UI out and returns to the login page, then the error is rethrown.
   */
  guard<T>(call: () => Promise<T>): Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Client-side authentication state (D5). The session itself lives in an httpOnly cookie
 * the browser script cannot read; this holds only the public user profile. Any
 * UNAUTHENTICATED answer from the API (expired or revoked session) signs the UI out
 * and returns to the login page.
 */
export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: UserDto | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<UserDto | null>(initialUser);

  const toLogin = useCallback(() => {
    setUser(null);
    router.replace('/login');
    router.refresh();
  }, [router]);

  /** Run an authenticated call; a 401 UNAUTHENTICATED means the session is gone. */
  const guarded = useCallback(
    async <T,>(call: () => Promise<T>): Promise<T> => {
      try {
        return await call();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') toLogin();
        throw error;
      }
    },
    [toLogin],
  );

  // Actions do not depend on `user`, so their identities stay stable across profile updates
  // (components can safely list them as effect dependencies).
  const actions = useMemo<Omit<AuthContextValue, 'user' | 'guard'>>(
    () => ({
      login: async (input) => {
        const result = await api.login(input);
        setUser(result.user);
      },
      register: async (input) => {
        const result = await api.register(input);
        setUser(result.user);
      },
      logout: async () => {
        try {
          await api.logout();
        } catch (error) {
          // Already signed out server-side is fine; anything else must be reported.
          if (!(error instanceof ApiError && error.code === 'UNAUTHENTICATED')) throw error;
        }
        toLogin();
      },
      updateProfile: (input) =>
        guarded(async () => {
          const result = await api.updateProfile(input);
          setUser(result.user);
        }),
      // The API revokes this account's other sessions but keeps this one signed in.
      changePassword: (input) => guarded(() => api.changePassword(input).then(() => undefined)),
      listSessions: () => guarded(async () => (await api.listSessions()).sessions),
      revokeSession: (sessionId) =>
        guarded(() => api.revokeSession(sessionId).then(() => undefined)),
    }),
    [guarded, toLogin],
  );
  const guard = guarded;

  const value = useMemo<AuthContextValue>(
    () => ({ user, ...actions, guard }),
    [user, actions, guard],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
