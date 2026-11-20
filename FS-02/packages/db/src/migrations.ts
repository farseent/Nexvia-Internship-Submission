import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cached: string[] | undefined;

/**
 * Names of the migrations shipped with this build (directories of `prisma/migrations`,
 * sorted). Resolved relative to this file, so it works from `src/` and from `dist/`;
 * `prisma` is part of the package's published `files`.
 */
export function listExpectedMigrations(): string[] {
  cached ??= readdirSync(fileURLToPath(new URL('../prisma/migrations/', import.meta.url)), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return cached;
}
