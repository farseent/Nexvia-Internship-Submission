import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `@/…` is the web app's source alias (apps/web/tsconfig.json paths).
const webSrc = fileURLToPath(new URL('./apps/web/src/', import.meta.url));

// Two projects (docs/TESTING.md):
//  - unit:        *.test.ts(x)    — no external services required
//  - integration: *.int.test.ts   — real PostgreSQL and Redis (DATABASE_URL, REDIS_URL)
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: [{ find: /^@\//, replacement: webSrc }] },
        test: {
          name: 'unit',
          environment: 'node',
          // Component tests (*.test.tsx) opt in to jsdom with `// @vitest-environment jsdom`.
          include: ['{apps,packages}/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['{apps,packages}/**/*.int.test.ts', 'tests/**/*.int.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
          // Integration tests share real services; run files serially.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
