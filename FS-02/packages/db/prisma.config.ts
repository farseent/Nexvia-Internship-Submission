import { defineConfig } from 'prisma/config';

// DATABASE_URL is read from the process environment (never hardcoded).
// For local use: `node --env-file=../../.env` or export it in your shell.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
