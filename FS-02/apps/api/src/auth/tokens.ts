import { createHash, randomBytes } from 'node:crypto';

/** Session token: 32 random bytes, base64url (43 characters) (D5). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedSessionToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** SHA-256 hex digest: the only form in which a session token is stored (D5). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
