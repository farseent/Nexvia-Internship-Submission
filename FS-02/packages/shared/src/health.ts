import { z } from 'zod';

/**
 * Health response shapes (docs/API_CONTRACTS.md OPS-01/OPS-02, docs/DEPLOYMENT.md "Health checks").
 * Liveness never depends on dependencies. Readiness reports dependencies separately.
 */
export const dependencyStatusSchema = z.enum(['healthy', 'degraded', 'unavailable']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const livenessSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
});
export type Liveness = z.infer<typeof livenessSchema>;

export const readinessSchema = z.object({
  status: z.enum(['ready', 'degraded', 'not_ready']),
  service: z.string().min(1),
  dependencies: z.object({
    postgres: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});
export type Readiness = z.infer<typeof readinessSchema>;

/**
 * API readiness: PostgreSQL (reachable and schema-compatible) is required.
 * Redis state is reported but never makes the API unready on its own.
 */
export function evaluateApiReadiness(deps: Readiness['dependencies']): Readiness['status'] {
  if (deps.postgres !== 'healthy') return 'not_ready';
  return 'ready';
}

/**
 * Collab readiness: PostgreSQL is required. Redis down reports `degraded`
 * (multi-instance propagation unavailable) but the instance stays ready.
 */
export function evaluateCollabReadiness(deps: Readiness['dependencies']): Readiness['status'] {
  if (deps.postgres !== 'healthy') return 'not_ready';
  if (deps.redis !== 'healthy') return 'degraded';
  return 'ready';
}
