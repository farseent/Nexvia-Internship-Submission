import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { REQUEST_ID_HEADER, isAcceptableRequestId } from '@conote/shared';
import type { ApiConfig } from './config.js';
import type { Dependencies } from './dependencies.js';
import { registerErrorHandling } from './errors.js';
import { registerSecurity } from './plugins/security.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  logger: FastifyBaseLogger;
  dependencies: Dependencies;
  config: ApiConfig;
}

/** Request bodies are small JSON documents; larger payloads are rejected with 413. */
export const BODY_LIMIT_BYTES = 64 * 1024;

/** Build the Fastify instance without listening, so tests can use `inject`. */
export function buildApp({ logger, dependencies, config }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.trustProxy.length > 0 ? config.trustProxy : false,
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (req) => {
      const inbound = req.headers[REQUEST_ID_HEADER];
      return isAcceptableRequestId(inbound) ? inbound : randomUUID();
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (request, reply) => {
    void reply.header('X-Request-Id', request.id);
  });

  registerErrorHandling(app);
  void app.register(async (scope) => {
    await registerSecurity(scope, dependencies, config);
    registerHealthRoutes(scope, dependencies);
    await registerAuthRoutes(scope, dependencies, config);
  });

  app.addHook('onClose', async () => {
    await dependencies.close();
  });

  return app;
}
