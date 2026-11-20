import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AppError,
  canEditPage,
  collabTokenResponseSchema,
  documentNameForPage,
  emptyBodySchema,
  pageParamsSchema,
  successEnvelope,
  successEnvelopeSchema,
} from '@conote/shared';
import type { ApiConfig } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { CollabTokenSigner } from '../auth/collab-tokens.js';
import { authOf } from '../auth/guard.js';
import { rateLimitConfig } from '../plugins/security.js';
import type { AccessService } from '../workspaces/access.js';

/**
 * PAGE-10 `POST /api/v1/pages/:pageId/collab-token` (docs/API_CONTRACTS.md §7).
 * Hands a signed, 60-second token to a user who can at least read the page. The collaboration
 * server repeats every check against the database when the token is used, so this endpoint is
 * only the front door; `role` and `readOnly` in the answer are hints for the interface.
 */
export async function registerCollabTokenRoutes(
  scope: FastifyInstance,
  { clock }: Dependencies,
  config: ApiConfig,
  access: AccessService,
): Promise<void> {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  const signer =
    config.collab.privateKey === undefined
      ? undefined
      : new CollabTokenSigner(config.collab.privateKey, clock);

  app.post(
    '/api/v1/pages/:pageId/collab-token',
    {
      schema: {
        params: pageParamsSchema,
        body: emptyBodySchema,
        response: { 200: successEnvelopeSchema(collabTokenResponseSchema) },
      },
      config: { rateLimit: rateLimitConfig(config.rateLimits.collabToken) },
    },
    async (request, reply) => {
      const { user, session } = authOf(request);
      const { pageId } = request.params;
      const pageAccess = await access.pageAccess(user.id, pageId); // 404 unless at least VIEWER
      if (pageAccess.role === 'NONE') throw new AppError('NOT_FOUND', 'Page not found.');
      if (signer === undefined) {
        throw new AppError('SERVICE_UNAVAILABLE', 'Live collaboration is not available.');
      }
      const issued = await signer.issue({ userId: user.id, sessionId: session.id, pageId });
      return reply.send(
        successEnvelope({
          token: issued.token,
          expiresAt: issued.expiresAt.toISOString(),
          collabUrl: config.collab.url,
          documentName: documentNameForPage(pageId),
          role: pageAccess.role,
          readOnly: !canEditPage(pageAccess.role),
        }),
      );
    },
  );
}
