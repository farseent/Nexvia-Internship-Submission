import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { successEnvelope, updateProfileRequestSchema, userResponseSchema } from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { toUserDto } from '../auth/dto.js';
import { authOf } from '../auth/guard.js';
import { USER_SELECT } from '../auth/sessions.js';
import { rateLimitConfig } from '../plugins/security.js';

/** USER-01, USER-02 (docs/API_CONTRACTS.md §4). Registered inside the authenticated scope. */
export async function registerUserRoutes(
  scope: FastifyInstance,
  { prisma }: Dependencies,
  config: ApiConfig,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const general = { rateLimit: rateLimitConfig(config.rateLimits.general) };

  app.get(
    '/api/v1/users/me',
    { schema: { response: { 200: userResponseSchema } }, config: general },
    async (request, reply) => {
      return reply.send(successEnvelope({ user: toUserDto(authOf(request).user) }));
    },
  );

  app.patch(
    '/api/v1/users/me',
    {
      schema: { body: updateProfileRequestSchema, response: { 200: userResponseSchema } },
      config: general,
    },
    async (request, reply) => {
      const { displayName, presenceColor } = request.body;
      const user = await prisma.user.update({
        where: { id: authOf(request).user.id },
        data: {
          ...(displayName !== undefined ? { displayName } : {}),
          ...(presenceColor !== undefined ? { presenceColor } : {}),
        },
        select: USER_SELECT,
      });
      return reply.send(successEnvelope({ user: toUserDto(user) }));
    },
  );
}
