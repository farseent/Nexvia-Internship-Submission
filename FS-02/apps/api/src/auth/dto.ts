import type { SessionInfoDto, UserDto } from '@conote/shared';
import type { AuthSession, AuthUser } from './sessions.js';

/** Explicit field mapping: the password hash is never part of an API resource (D5). */
export function toUserDto(user: AuthUser): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    presenceColor: user.presenceColor,
    // Avatars arrive with Phase 4 (assets).
    avatarUrl: null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toSessionInfoDto(session: AuthSession, currentSessionId: string): SessionInfoDto {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    userAgent: session.userAgent,
    current: session.id === currentSessionId,
  };
}
