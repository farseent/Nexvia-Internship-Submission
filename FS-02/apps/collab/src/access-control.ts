import type { Logger } from 'pino';
import {
  resolveCollabAccess,
  isDatabaseUnavailableError,
  type CollabAccessDenial,
  type PrismaClient,
} from '@conote/db';
import {
  COLLAB_CLOSE,
  canEditPage,
  encodeServerMessage,
  normalizePresenceColor,
  pageIdFromDocumentName,
  type AccessRevokedReason,
} from '@conote/shared';
import type { Clock, CollabConfig } from './config.js';
import {
  type ConnectionRegistry,
  createContext,
  type CollabContext,
} from './connection-registry.js';
import { TokenRejectedError, type TokenVerifier } from './token-verifier.js';

/** What the client learns when a connection is refused. Hocuspocus forwards `reason` as is. */
export interface AuthRefusal {
  reason:
    | 'AUTH_FAILED'
    | 'ACCESS_DENIED'
    | 'PAGE_NOT_FOUND'
    | 'PROTOCOL_VIOLATION'
    | 'RATE_LIMITED'
    | 'TRY_AGAIN_LATER';
}
const refuse = (reason: AuthRefusal['reason']): AuthRefusal => ({ reason });

const REVOKE_REASON: Record<CollabAccessDenial, AccessRevokedReason> = {
  SESSION_INVALID: 'SESSION_REVOKED',
  SESSION_MISMATCH: 'SESSION_REVOKED',
  PAGE_NOT_FOUND: 'PAGE_DELETED',
  NOT_A_MEMBER: 'MEMBER_REMOVED',
  ACCESS_REMOVED: 'ACCESS_REMOVED',
};

/**
 * Authorization of document connections, at connect time and for as long as they stay open
 * (docs/WEBSOCKET_PROTOCOL.md §4, §10). The token proves identity; the role is always read
 * from PostgreSQL. Nothing a client sends after the handshake can change a role.
 */
export class AccessController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ConnectionRegistry,
    private readonly verifier: TokenVerifier,
    private readonly config: Pick<CollabConfig, 'maxConnectionsPerUser' | 'maxConnections'>,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /**
   * Decide whether `token` may open `documentName`. Resolves with the connection's context
   * (and the connection is read-only unless the role can edit) or throws an `AuthRefusal`.
   * The returned `release` must be called once the connection is registered or abandoned.
   */
  async authenticate(
    token: string,
    documentName: string,
    socketId: string,
  ): Promise<{ context: CollabContext; release: () => void }> {
    const pageId = pageIdFromDocumentName(documentName);
    if (pageId === null) {
      this.logger.warn({ socketId }, 'refused: invalid document name');
      throw refuse('PROTOCOL_VIOLATION');
    }

    let claims;
    try {
      claims = await this.verifier.verify(token);
    } catch (err) {
      this.logger.warn(
        { socketId, pageId, why: err instanceof TokenRejectedError ? err.why : 'unknown' },
        'refused: token rejected',
      );
      throw refuse('AUTH_FAILED');
    }
    if (claims.pid.toLowerCase() !== pageId) {
      this.logger.warn(
        { socketId, pageId, userId: claims.sub },
        'refused: token is for another page',
      );
      throw refuse('AUTH_FAILED');
    }

    const release = this.registry.reserve(claims.sub, {
      perUser: this.config.maxConnectionsPerUser,
      total: this.config.maxConnections,
    });
    if (release === null) {
      this.logger.warn({ socketId, pageId, userId: claims.sub }, 'refused: too many connections');
      throw refuse('RATE_LIMITED');
    }

    try {
      const decision = await resolveCollabAccess(this.prisma, {
        userId: claims.sub,
        sessionId: claims.sid,
        pageId,
        now: this.clock(),
      });
      if (!decision.ok) {
        this.logger.warn(
          { socketId, pageId, userId: claims.sub, denial: decision.reason },
          'refused: access denied',
        );
        throw refuse(
          decision.reason === 'PAGE_NOT_FOUND'
            ? 'PAGE_NOT_FOUND'
            : decision.reason === 'SESSION_INVALID' || decision.reason === 'SESSION_MISMATCH'
              ? 'AUTH_FAILED'
              : 'ACCESS_DENIED',
        );
      }
      // Who the connection is shown as comes from the database, never from the client (D61).
      const person = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { displayName: true, presenceColor: true },
      });
      if (person === null) throw refuse('AUTH_FAILED');
      const context = createContext(
        {
          userId: claims.sub,
          sessionId: claims.sid,
          pageId,
          workspaceId: decision.workspaceId,
          role: decision.role,
          readOnly: !canEditPage(decision.role),
          tokenId: claims.jti,
          identity: {
            id: claims.sub.toLowerCase(),
            name: person.displayName,
            color: normalizePresenceColor(person.presenceColor),
          },
        },
        this.clock().getTime(),
      );
      return { context, release };
    } catch (err) {
      release();
      if (isRefusal(err)) throw err;
      // PostgreSQL unavailable or an unexpected failure: the client may try again later.
      this.logger.error(
        {
          socketId,
          pageId,
          err: { name: (err as Error).name },
          database: isDatabaseUnavailableError(err),
        },
        'refused: authorization lookup failed',
      );
      throw refuse('TRY_AGAIN_LATER');
    }
  }

  /**
   * Re-read the session and the effective role of `contexts` from PostgreSQL and apply the
   * result: unchanged → nothing; downgrade/upgrade → switch read-only and tell the client;
   * no access → tell the client and close. Connections sharing user, session and page are
   * checked with one lookup. `hint` overrides the reason shown for a loss of access.
   */
  async revalidate(
    contexts: readonly CollabContext[],
    hint?: AccessRevokedReason,
  ): Promise<{ checked: number; changed: number; revoked: number; failed: number }> {
    const groups = new Map<string, CollabContext[]>();
    for (const context of contexts) {
      if (context.revoked) continue;
      const key = `${context.userId}\0${context.sessionId}\0${context.pageId}`;
      const group = groups.get(key);
      if (group) group.push(context);
      else groups.set(key, [context]);
    }

    const totals = { checked: 0, changed: 0, revoked: 0, failed: 0 };
    for (const group of groups.values()) {
      const first = group[0];
      if (!first) continue;
      let decision;
      try {
        decision = await resolveCollabAccess(this.prisma, {
          userId: first.userId,
          sessionId: first.sessionId,
          pageId: first.pageId,
          now: this.clock(),
        });
      } catch (err) {
        // The database is unreachable: keep what each connection has. The next interval or
        // event retries; closing everyone because PostgreSQL blinked would be worse.
        totals.failed += group.length;
        this.logger.warn({ err: { name: (err as Error).name } }, 'revalidation lookup failed');
        continue;
      }
      for (const context of group) {
        totals.checked += 1;
        if (!decision.ok) {
          totals.revoked += 1;
          this.revoke(context, hint ?? REVOKE_REASON[decision.reason]);
          continue;
        }
        const readOnly = !canEditPage(decision.role);
        if (decision.role !== context.role || readOnly !== context.readOnly) {
          totals.changed += 1;
          this.change(context, decision.role, readOnly);
        }
      }
    }
    return totals;
  }

  /** Switch one connection's role: read-only is enforced by Hocuspocus from the next message on. */
  private change(context: CollabContext, role: CollabContext['role'], readOnly: boolean): void {
    const before = { role: context.role, readOnly: context.readOnly };
    context.role = role;
    context.readOnly = readOnly;
    if (context.connection) context.connection.readOnly = readOnly;
    this.logger.info(
      { userId: context.userId, pageId: context.pageId, before, after: { role, readOnly } },
      'connection access changed',
    );
    this.send(context, { v: 1, type: 'access.changed', payload: { readOnly, role } });
  }

  /**
   * End a connection whose access is gone: say why, close the document channel and the
   * socket. After this no message of the connection is applied (`revoked` is checked first
   * in `beforeHandleMessage`), even if the client keeps sending on a socket that is still closing.
   */
  revoke(context: CollabContext, reason: AccessRevokedReason): void {
    if (context.revoked) return;
    context.revoked = true;
    context.readOnly = true;
    if (context.connection) context.connection.readOnly = true;
    this.logger.info(
      { userId: context.userId, pageId: context.pageId, reason },
      'connection revoked',
    );
    this.send(context, { v: 1, type: 'access.revoked', payload: { reason } });
    this.close(context, COLLAB_CLOSE.ACCESS_REVOKED);
  }

  /** Close a connection with one of the logical close reasons. */
  close(context: CollabContext, close: { code: number; reason: string }): void {
    const connection = context.connection;
    if (!connection) return;
    try {
      connection.close({ code: close.code, reason: close.reason });
      // Hocuspocus closes the document channel only; the socket is closed too so a client
      // cannot go on using it for this document (a client holds one socket per document).
      connection.webSocket.close(close.code, close.reason);
    } catch (err) {
      this.logger.debug({ err: { name: (err as Error).name } }, 'close failed (already closed)');
    }
  }

  send(context: CollabContext, message: Parameters<typeof encodeServerMessage>[0]): void {
    try {
      context.connection?.sendStateless(encodeServerMessage(message));
    } catch (err) {
      this.logger.debug({ err: { name: (err as Error).name } }, 'send failed (connection closed)');
    }
  }
}

export function isRefusal(value: unknown): value is AuthRefusal {
  return (
    typeof value === 'object' && value !== null && 'reason' in value && !(value instanceof Error)
  );
}
