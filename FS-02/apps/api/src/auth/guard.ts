import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { AuthContext, SessionService } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the `requireAuth` hook; null on unauthenticated routes. */
    auth: AuthContext | null;
  }
}

export function sessionCookieOptions(config: ApiConfig) {
  return {
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax' as const,
  };
}

export function setSessionCookie(reply: FastifyReply, config: ApiConfig, token: string): void {
  void reply.setCookie(config.cookieName, token, {
    ...sessionCookieOptions(config),
    maxAge: Math.floor(config.sessionAbsoluteTtlMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, config: ApiConfig): void {
  void reply.clearCookie(config.cookieName, sessionCookieOptions(config));
}

/**
 * Access-control hook for protected routes: resolves the session cookie to a user or
 * rejects with 401 UNAUTHENTICATED. A stale cookie is cleared in the same response.
 */
export function createRequireAuth(sessions: SessionService, config: ApiConfig) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[config.cookieName];
    if (typeof token !== 'string' || token === '') {
      throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
    }
    const context = await sessions.authenticate(token);
    if (context === null) {
      clearSessionCookie(reply, config);
      throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
    }
    request.auth = context;
  };
}

/** The authenticated context; only valid on routes guarded by `requireAuth`. */
export function authOf(request: FastifyRequest): AuthContext {
  if (request.auth === null) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
  }
  return request.auth;
}
