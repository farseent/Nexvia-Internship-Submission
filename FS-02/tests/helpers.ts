import { createServer } from 'node:net';

/** Integration tests need real PostgreSQL and Redis; fail loudly (not skip) if unconfigured. */
export function requireInfraEnv(): { DATABASE_URL: string; REDIS_URL: string } {
  const DATABASE_URL = process.env['DATABASE_URL'];
  const REDIS_URL = process.env['REDIS_URL'];
  if (!DATABASE_URL || !REDIS_URL) {
    throw new Error(
      'Integration tests require DATABASE_URL and REDIS_URL (see .env.example). ' +
        'Start services with `pnpm infra:up` and run `pnpm db:migrate:deploy`.',
    );
  }
  return { DATABASE_URL, REDIS_URL };
}

/** An address nothing listens on, used to simulate an unavailable dependency. */
export const UNREACHABLE_DATABASE_URL = 'postgresql://nobody:nopass@127.0.0.1:1/none';
export const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
