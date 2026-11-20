import { randomUUID } from 'node:crypto';
import { SignJWT, importJWK, type CryptoKey } from 'jose';
import {
  COLLAB_TOKEN_ALGORITHM,
  COLLAB_TOKEN_AUDIENCE,
  COLLAB_TOKEN_ISSUER,
  COLLAB_TOKEN_TTL_SECONDS,
} from '@conote/shared';
import type { CollabPrivateKey } from '../config.js';

export interface IssuedCollabToken {
  token: string;
  expiresAt: Date;
}

/**
 * Signs the short-lived collaboration tokens of `PAGE-10` (D22). Only the API holds the private
 * key; the collaboration server verifies with the public key and can never mint a token.
 * The token proves who is asking and for which page; the role is decided by the collaboration
 * server from the database and is deliberately not in the token.
 */
export class CollabTokenSigner {
  private key: Promise<CryptoKey | Uint8Array> | undefined;

  constructor(
    private readonly jwk: CollabPrivateKey,
    private readonly clock: () => Date,
  ) {}

  async issue(input: {
    userId: string;
    sessionId: string;
    pageId: string;
  }): Promise<IssuedCollabToken> {
    this.key ??= importJWK(this.jwk, COLLAB_TOKEN_ALGORITHM);
    const issuedAt = Math.floor(this.clock().getTime() / 1000);
    const expiresAt = issuedAt + COLLAB_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ sid: input.sessionId, pid: input.pageId })
      .setProtectedHeader({ alg: COLLAB_TOKEN_ALGORITHM, kid: this.jwk.kid, typ: 'JWT' })
      .setIssuer(COLLAB_TOKEN_ISSUER)
      .setAudience(COLLAB_TOKEN_AUDIENCE)
      .setSubject(input.userId)
      .setJti(randomUUID())
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(await this.key);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }
}
