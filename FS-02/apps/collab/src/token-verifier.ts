import { importJWK, jwtVerify, errors, type CryptoKey } from 'jose';
import {
  COLLAB_TOKEN_ALGORITHM,
  COLLAB_TOKEN_AUDIENCE,
  COLLAB_TOKEN_CLOCK_TOLERANCE_SECONDS,
  COLLAB_TOKEN_ISSUER,
  COLLAB_TOKEN_TTL_SECONDS,
  collabTokenClaimsSchema,
  type CollabTokenClaims,
} from '@conote/shared';
import type { Clock, CollabConfig } from './config.js';

export class TokenRejectedError extends Error {
  constructor(readonly why: string) {
    super(`collaboration token rejected: ${why}`);
    this.name = 'TokenRejectedError';
  }
}

/**
 * Verifies the collaboration token (docs/WEBSOCKET_PROTOCOL.md §4): EdDSA signature against
 * the public key named by `kid`, issuer, audience, expiry, and a sane lifetime. It checks
 * identity only; what the person may do is decided from the database afterwards.
 * `why` is for logs; the client only ever learns `AUTH_FAILED`.
 */
export class TokenVerifier {
  private readonly keys = new Map<string, Promise<CryptoKey | Uint8Array>>();

  constructor(
    publicKeys: CollabConfig['publicKeys'],
    private readonly clock: Clock,
  ) {
    for (const jwk of publicKeys) {
      const key = importJWK(jwk, COLLAB_TOKEN_ALGORITHM);
      key.catch(() => undefined); // reported by `assertKeysUsable` and by every `verify`
      this.keys.set(jwk.kid, key);
    }
  }

  /** Startup check: every configured key must be a usable Ed25519 public key. */
  async assertKeysUsable(): Promise<void> {
    for (const [kid, key] of this.keys) {
      try {
        await key;
      } catch {
        throw new Error(
          `COLLAB_JWT_PUBLIC_KEYS: the key "${kid}" is not a valid Ed25519 public key.`,
        );
      }
    }
  }

  async verify(token: string): Promise<CollabTokenClaims> {
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      throw new TokenRejectedError('missing or oversized token');
    }
    let payload: unknown;
    try {
      const result = await jwtVerify(
        token,
        async (header) => {
          const key = header.kid === undefined ? undefined : this.keys.get(header.kid);
          if (key === undefined) throw new errors.JWKSNoMatchingKey();
          return key;
        },
        {
          algorithms: [COLLAB_TOKEN_ALGORITHM],
          issuer: COLLAB_TOKEN_ISSUER,
          audience: COLLAB_TOKEN_AUDIENCE,
          clockTolerance: COLLAB_TOKEN_CLOCK_TOLERANCE_SECONDS,
          currentDate: this.clock(),
          requiredClaims: ['exp', 'iat', 'sub', 'jti'],
        },
      );
      payload = result.payload;
    } catch (err) {
      throw new TokenRejectedError(err instanceof Error ? err.name : 'verification failed');
    }

    const parsed = collabTokenClaimsSchema.safeParse(payload);
    if (!parsed.success) throw new TokenRejectedError('claims have the wrong shape');
    const claims = parsed.data;

    // A validly signed token with a long life is still refused: tokens are meant for one minute.
    const nowSeconds = Math.floor(this.clock().getTime() / 1000);
    if (claims.iat > nowSeconds + COLLAB_TOKEN_CLOCK_TOLERANCE_SECONDS) {
      throw new TokenRejectedError('issued in the future');
    }
    if (claims.exp - claims.iat > COLLAB_TOKEN_TTL_SECONDS + COLLAB_TOKEN_CLOCK_TOLERANCE_SECONDS) {
      throw new TokenRejectedError('lifetime too long');
    }
    return claims;
  }
}
