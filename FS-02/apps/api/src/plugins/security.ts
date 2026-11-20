import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@conote/shared';
import type { ApiConfig, RateLimitRule } from '../config.js';
import type { Dependencies } from '../dependencies.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;
// ASSET-04 receives raw image bytes. It is exempt from the JSON requirement only for these
// image types; the Origin check still applies, and a cross-site form cannot send PUT.
const IMAGE_UPLOAD_ROUTE = /^PUT \/api\/v1\/assets\/[0-9a-f-]{36}\/content$/;
const IMAGE_CONTENT_TYPE = /^image\/(png|jpeg|gif|webp)\s*(;|$)/i;

/** Route-level `config.rateLimit` for a rule. */
export function rateLimitConfig(rule: RateLimitRule): { max: number; timeWindow: number } {
  return { max: rule.max, timeWindow: rule.timeWindowMs };
}

/**
 * Cross-cutting API security (docs/ARCHITECTURE.md §10, D25): security headers, CORS
 * allow-list, cookie parsing, the Origin / Content-Type check for state-changing
 * requests, `Cache-Control: no-store` and the Redis-backed rate limiter.
 */
export async function registerSecurity(
  app: FastifyInstance,
  dependencies: Pick<Dependencies, 'redis'>,
  config: ApiConfig,
): Promise<void> {
  const allowedOrigins = new Set(config.allowedOrigins);

  await app.register(helmet);
  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(cookie);

  // CSRF defence for cookie authentication, on top of SameSite=Lax: a state-changing
  // request must come from an allow-listed Origin and declare a JSON body. A cross-site
  // HTML form cannot send application/json, and a cross-site fetch is blocked by CORS.
  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method) || !request.url.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      throw new AppError('INVALID_ORIGIN', 'Origin not allowed.');
    }
    const contentType = request.headers['content-type'];
    const isImageUpload =
      IMAGE_UPLOAD_ROUTE.test(`${request.method} ${request.url.split('?')[0] ?? ''}`) &&
      typeof contentType === 'string' &&
      IMAGE_CONTENT_TYPE.test(contentType);
    if (
      !isImageUpload &&
      (typeof contentType !== 'string' || !JSON_CONTENT_TYPE.test(contentType))
    ) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.');
    }
  });

  // API responses carry account data or session state and must never be cached.
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) void reply.header('Cache-Control', 'no-store');
  });

  // Limits are applied per route through `config.rateLimit`. When Redis is unreachable
  // the plugin rethrows the store error and the error handler answers 503 (fail closed).
  await app.register(rateLimit, {
    global: false,
    redis: dependencies.redis,
    nameSpace: config.rateLimitNamespace,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 'Too many requests.'),
  });
}
