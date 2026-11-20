import type { PrismaClient } from '@conote/db';
import { generateSessionToken, hashToken, isWellFormedSessionToken } from './tokens.js';
import type { ApiConfig, Clock } from '../config.js';

/** `lastSeenAt` / sliding expiry are refreshed at most this often per session (D5). */
export const LAST_SEEN_THROTTLE_MS = 60_000;

/** User fields safe to load for request handling: never the password hash. */
export const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  presenceColor: true,
  createdAt: true,
} as const;

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  presenceColor: string;
  createdAt: Date;
}

export interface AuthSession {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  /** Effective expiry: the earlier of the idle and absolute expiry. */
  expiresAt: Date;
  userAgent: string | null;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
}

export interface ClientMeta {
  userAgent: string | undefined;
  ip: string | undefined;
}

/** Row data for a new session, usable in a nested `create` (user relation is implied). */
export interface NewSessionData {
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export type SessionTimings = Pick<ApiConfig, 'sessionIdleTtlMs' | 'sessionAbsoluteTtlMs'>;

const earlier = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b);

/**
 * DB-backed session lifecycle (D5, docs/ARCHITECTURE.md §10.2). Only the SHA-256
 * hash of a token is stored; the raw token exists in the cookie alone. All time
 * comparisons use the injected clock so expiry is testable without sleeping.
 */
export class SessionService {
  private readonly prisma: PrismaClient;
  private readonly clock: Clock;
  private readonly timings: SessionTimings;

  constructor(prisma: PrismaClient, clock: Clock, timings: SessionTimings) {
    this.prisma = prisma;
    this.clock = clock;
    this.timings = timings;
  }

  /** Generate a token and the row data to persist (the caller attaches it to a user). */
  prepare(meta: ClientMeta): { token: string; data: NewSessionData } {
    const now = this.clock();
    const token = generateSessionToken();
    return {
      token,
      data: {
        tokenHash: hashToken(token),
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 512) : null,
        ipAddress: meta.ip ? meta.ip.slice(0, 45) : null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + this.timings.sessionIdleTtlMs),
        absoluteExpiresAt: new Date(now.getTime() + this.timings.sessionAbsoluteTtlMs),
      },
    };
  }

  /**
   * Resolve a raw cookie token to a live session, or null. Revoked, idle-expired and
   * absolute-expired sessions are indistinguishable to the caller. A valid session has
   * its sliding expiry refreshed, throttled to once per minute.
   */
  async authenticate(rawToken: string): Promise<AuthContext | null> {
    if (!isWellFormedSessionToken(rawToken)) return null;

    const row = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        absoluteExpiresAt: true,
        revokedAt: true,
        userAgent: true,
        user: { select: USER_SELECT },
      },
    });
    if (row === null || row.revokedAt !== null) return null;

    const now = this.clock();
    if (now.getTime() >= earlier(row.expiresAt, row.absoluteExpiresAt).getTime()) return null;

    let { lastSeenAt, expiresAt } = row;
    if (now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS) {
      lastSeenAt = now;
      expiresAt = new Date(now.getTime() + this.timings.sessionIdleTtlMs);
      await this.prisma.session.update({
        where: { id: row.id },
        data: { lastSeenAt, expiresAt },
        select: { id: true },
      });
    }

    return {
      user: row.user,
      session: {
        id: row.id,
        createdAt: row.createdAt,
        lastSeenAt,
        expiresAt: earlier(expiresAt, row.absoluteExpiresAt),
        userAgent: row.userAgent,
      },
    };
  }

  /** Revoke one session owned by `userId`. Returns false if none matched (unknown, foreign or already revoked). */
  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const now = this.clock();
    const result = await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });
    return result.count > 0;
  }

  /** The user's live sessions, newest first. */
  async listActive(userId: string): Promise<
    {
      id: string;
      createdAt: Date;
      lastSeenAt: Date;
      expiresAt: Date;
      userAgent: string | null;
    }[]
  > {
    const now = this.clock();
    const rows = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        absoluteExpiresAt: true,
        userAgent: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: earlier(row.expiresAt, row.absoluteExpiresAt),
      userAgent: row.userAgent,
    }));
  }
}
