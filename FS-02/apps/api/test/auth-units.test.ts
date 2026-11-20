import { describe, expect, it } from 'vitest';
import {
  ARGON2_OPTIONS,
  hashPassword,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../src/auth/passwords.js';
import { generateSessionToken, hashToken, isWellFormedSessionToken } from '../src/auth/tokens.js';
import { isRedisUnavailableError } from '../src/redis.js';

describe('password hashing (Argon2id)', () => {
  it('produces a salted Argon2id hash with the documented parameters', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(ARGON2_OPTIONS).toMatchObject({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
    expect(a).not.toBe(b); // unique salt
    expect(a).not.toContain('correct horse battery');
  });

  it('verifies the right password and rejects wrong ones, never throwing', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'Correct horse battery')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await verifyPassword('', 'x')).toBe(false);
  });

  it('runs the dummy verification without error', async () => {
    await expect(verifyAgainstDummyHash('anything')).resolves.toBeUndefined();
  });
});

describe('session tokens', () => {
  it('generates 256-bit base64url tokens that are unique', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateSessionToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toHaveLength(43);
      expect(isWellFormedSessionToken(token)).toBe(true);
    }
  });

  it('hashes to a stable SHA-256 hex digest that differs from the token', () => {
    const token = generateSessionToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    // Known vector: sha256("abc").
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it.each([
    '',
    'short',
    'A'.repeat(42),
    'A'.repeat(44),
    `${'A'.repeat(42)}=`,
    `${'A'.repeat(42)} `,
  ])('rejects malformed token %j', (value) => {
    expect(isWellFormedSessionToken(value)).toBe(false);
  });
});

describe('isRedisUnavailableError', () => {
  it('recognizes connection failures and nothing else', () => {
    expect(
      isRedisUnavailableError(
        new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      ),
    ).toBe(true);
    expect(isRedisUnavailableError(new Error('Connection is closed.'))).toBe(true);
    const refused = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    expect(isRedisUnavailableError(refused)).toBe(true);
    const maxRetries = Object.assign(new Error('x'), { name: 'MaxRetriesPerRequestError' });
    expect(isRedisUnavailableError(maxRetries)).toBe(true);
    expect(isRedisUnavailableError(new Error('something else'))).toBe(false);
    expect(isRedisUnavailableError('string')).toBe(false);
  });
});
