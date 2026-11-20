import { Prisma } from './generated/prisma/client.js';

/** Unique-constraint violation (Prisma P2002), optionally restricted to a target column. */
export function isUniqueConstraintError(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (field === undefined) return true;
  const target: unknown = err.meta?.['target'];
  if (Array.isArray(target)) return target.includes(field);
  // Driver adapters report the violated constraint in `meta.driverAdapterError.cause.constraint`.
  return JSON.stringify(err.meta ?? {}).includes(field);
}

/** Prisma error codes meaning the database cannot currently serve the request. */
const UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/** True when a query failed because PostgreSQL is unreachable, timed out or the pool is exhausted. */
export function isDatabaseUnavailableError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  return err instanceof Prisma.PrismaClientKnownRequestError && UNAVAILABLE_CODES.has(err.code);
}
