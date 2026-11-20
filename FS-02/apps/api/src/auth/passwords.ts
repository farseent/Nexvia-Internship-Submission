import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/**
 * Argon2id parameters: the OWASP Password Storage Cheat Sheet baseline from D5
 * (m = 19456 KiB, t = 2, p = 1). Measured timings are in docs/ARCHITECTURE.md §10.1.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/** Never throws: a malformed stored hash simply fails verification. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Performs the same Argon2id verification work as a real login so that an unknown
 * email costs about as much as a wrong password (docs/API_CONTRACTS.md AUTH-02).
 */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
}
