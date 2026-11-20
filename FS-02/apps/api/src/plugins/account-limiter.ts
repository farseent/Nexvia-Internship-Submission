import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@conote/shared';
import type { RateLimitRule } from '../config.js';

/**
 * Rate limiter keyed by an application value (a user id, an email) instead of the client
 * address, applied imperatively inside a handler once that value is known. The per-route
 * `config.rateLimit` limiter still applies per client IP.
 */
export function createAccountLimiter(scope: FastifyInstance) {
  const keys = new WeakMap<FastifyRequest, string>();
  return (rule: RateLimitRule, prefix: string) => {
    const limit = scope.createRateLimit({
      max: rule.max,
      timeWindow: rule.timeWindowMs,
      keyGenerator: (request) => `${prefix}:${keys.get(request) ?? request.ip}`,
    });
    return async (request: FastifyRequest, reply: FastifyReply, key: string): Promise<void> => {
      keys.set(request, key);
      const result = await limit(request);
      if (!result.isAllowed && result.isExceeded) {
        void reply.header('Retry-After', result.ttlInSeconds);
        throw new AppError('RATE_LIMITED', 'Too many requests.');
      }
    };
  };
}
