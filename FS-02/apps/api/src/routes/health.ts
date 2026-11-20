import type { FastifyInstance } from 'fastify';
import { evaluateApiReadiness, type Liveness, type Readiness } from '@conote/shared';
import type { Dependencies } from '../dependencies.js';

const SERVICE = 'api';

/** OPS-01 and OPS-02 (docs/API_CONTRACTS.md §13). Not under /api/v1, not enveloped. */
export function registerHealthRoutes(app: FastifyInstance, deps: Dependencies): void {
  app.get('/health', async (): Promise<Liveness> => ({ status: 'ok', service: SERVICE }));

  app.get('/ready', async (_request, reply): Promise<Readiness> => {
    const [postgres, redis] = await Promise.all([deps.checkPostgres(), deps.checkRedis()]);
    const dependencies = { postgres, redis };
    const status = evaluateApiReadiness(dependencies);
    if (status === 'not_ready') void reply.code(503);
    return { status, service: SERVICE, dependencies };
  });
}
