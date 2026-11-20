import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { isUniqueConstraintError } from '@conote/db';
import {
  AppError,
  PRESENCE_COLORS,
  changePasswordRequestSchema,
  emptyBodySchema,
  loginRequestSchema,
  nullResponseSchema,
  registerRequestSchema,
  sessionIdParamsSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  successEnvelope,
  userResponseSchema,
} from '@conote/shared';
import type { ApiConfig, RateLimitRule } from '../config.js';
import type { Dependencies } from '../dependencies.js';
import { toSessionInfoDto, toUserDto } from '../auth/dto.js';
import { publishSessionRevoked } from '../auth/events.js';
import { authOf, clearSessionCookie, createRequireAuth, setSessionCookie } from '../auth/guard.js';
import { hashPassword, verifyAgainstDummyHash, verifyPassword } from '../auth/passwords.js';
import { SessionService, USER_SELECT, type ClientMeta } from '../auth/sessions.js';
import { rateLimitConfig } from '../plugins/security.js';
import { AccessService } from '../workspaces/access.js';
import { registerActivityRoutes } from './activity.js';
import { registerAssetRoutes } from './assets.js';
import { registerInvitationPublicRoutes, registerInvitationRoutes } from './invitations.js';
import { registerCollabTokenRoutes } from './collab-token.js';
import { registerPagePermissionRoutes } from './page-permissions.js';
import { registerPageRoutes } from './pages.js';
import { registerUserRoutes } from './users.js';
import { registerWorkspaceRoutes } from './workspaces.js';

function clientMeta(request: FastifyRequest): ClientMeta {
  return { userAgent: request.headers['user-agent'], ip: request.ip };
}

function pickPresenceColor(): string {
  return PRESENCE_COLORS[randomInt(PRESENCE_COLORS.length)] ?? '#4F46E5';
}

/** AUTH-01 … AUTH-07 (docs/API_CONTRACTS.md §3). Mounted under /api/v1. */
export async function registerAuthRoutes(
  root: FastifyInstance,
  dependencies: Dependencies,
  config: ApiConfig,
): Promise<void> {
  const { prisma, redis, clock } = dependencies;
  const sessions = new SessionService(prisma, clock, config);
  const requireAuth = createRequireAuth(sessions, config);
  const { rateLimits } = config;

  root.decorateRequest('auth', null);
  const app = root.withTypeProvider<ZodTypeProvider>();

  // Limiter for one account regardless of the requesting address (brute force from many IPs).
  const accountKeys = new WeakMap<FastifyRequest, string>();
  const accountLimiter = (rule: RateLimitRule, prefix: string) => {
    const limit = root.createRateLimit({
      max: rule.max,
      timeWindow: rule.timeWindowMs,
      keyGenerator: (request) => `${prefix}:${accountKeys.get(request) ?? request.ip}`,
    });
    return async (request: FastifyRequest, reply: FastifyReply, key: string): Promise<void> => {
      accountKeys.set(request, key);
      const result = await limit(request);
      if (!result.isAllowed && result.isExceeded) {
        void reply.header('Retry-After', result.ttlInSeconds);
        throw new AppError('RATE_LIMITED', 'Too many requests.');
      }
    };
  };
  const limitLoginAccount = accountLimiter(rateLimits.loginAccount, 'login-account');
  const limitPasswordUser = accountLimiter(rateLimits.password, 'password-user');

  // ───────────── AUTH-01 Register ─────────────
  app.post(
    '/api/v1/auth/register',
    {
      schema: { body: registerRequestSchema, response: { 201: userResponseSchema } },
      config: { rateLimit: rateLimitConfig(rateLimits.register) },
    },
    async (request, reply) => {
      const { email, password, displayName } = request.body;

      // Cheap pre-check so a known email does not cost a hash; the unique index decides races.
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing !== null) throw new AppError('EMAIL_TAKEN', 'Email already registered.');

      const passwordHash = await hashPassword(password);
      const { token, data } = sessions.prepare(clientMeta(request));
      let user;
      try {
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            displayName,
            presenceColor: pickPresenceColor(),
            // One clock for every session/credential timestamp (not the database default).
            passwordChangedAt: data.createdAt,
            lastLoginAt: data.createdAt,
            sessions: { create: data },
          },
          select: USER_SELECT,
        });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new AppError('EMAIL_TAKEN', 'Email already registered.');
        }
        throw err;
      }

      setSessionCookie(reply, config, token);
      return reply.code(201).send(successEnvelope({ user: toUserDto(user) }));
    },
  );

  // ───────────── AUTH-02 Login ─────────────
  app.post(
    '/api/v1/auth/login',
    {
      schema: { body: loginRequestSchema, response: { 200: userResponseSchema } },
      config: { rateLimit: rateLimitConfig(rateLimits.login) },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      await limitLoginAccount(request, reply, email);

      const found = await prisma.user.findUnique({
        where: { email },
        select: { ...USER_SELECT, passwordHash: true },
      });
      let verified = false;
      if (found === null) {
        await verifyAgainstDummyHash(password);
      } else {
        verified = await verifyPassword(found.passwordHash, password);
      }
      if (found === null || !verified) {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
      }

      // A new token on every login: a pre-login session can never be "upgraded" (fixation).
      const { token, data } = sessions.prepare(clientMeta(request));
      await prisma.user.update({
        where: { id: found.id },
        data: { lastLoginAt: data.createdAt, sessions: { create: data } },
        select: { id: true },
      });

      setSessionCookie(reply, config, token);
      return reply.send(successEnvelope({ user: toUserDto(found) }));
    },
  );

  // INV-05: unauthenticated; the invitation token is the credential.
  await registerInvitationPublicRoutes(root, dependencies, config);

  // Everything below requires a valid session.
  await root.register(async (protectedScope) => {
    // preValidation: after the rate limiter (onRequest) but before body validation, so an
    // unauthenticated caller always gets 401 and never learns what a valid body looks like.
    protectedScope.addHook('preValidation', requireAuth);
    const guarded = protectedScope.withTypeProvider<ZodTypeProvider>();
    const general = { rateLimit: rateLimitConfig(rateLimits.general) };

    // ───────────── AUTH-03 Logout ─────────────
    guarded.post(
      '/api/v1/auth/logout',
      { schema: { body: emptyBodySchema, response: { 200: nullResponseSchema } }, config: general },
      async (request, reply) => {
        const { user, session } = authOf(request);
        const revoked = await sessions.revoke(user.id, session.id);
        if (revoked) {
          await publishSessionRevoked(redis, request.log, {
            userId: user.id,
            sessionId: session.id,
            at: clock(),
          });
        }
        clearSessionCookie(reply, config);
        return reply.send(successEnvelope(null));
      },
    );

    // ───────────── AUTH-04 Current session ─────────────
    guarded.get(
      '/api/v1/auth/session',
      { schema: { response: { 200: sessionResponseSchema } }, config: general },
      async (request, reply) => {
        const { user, session } = authOf(request);
        return reply.send(
          successEnvelope({
            user: toUserDto(user),
            session: toSessionInfoDto(session, session.id),
          }),
        );
      },
    );

    // ───────────── AUTH-05 List sessions ─────────────
    guarded.get(
      '/api/v1/auth/sessions',
      { schema: { response: { 200: sessionListResponseSchema } }, config: general },
      async (request, reply) => {
        const { user, session } = authOf(request);
        const active = await sessions.listActive(user.id);
        return reply.send(
          successEnvelope({ sessions: active.map((s) => toSessionInfoDto(s, session.id)) }),
        );
      },
    );

    // ───────────── AUTH-06 Revoke one session ─────────────
    guarded.delete(
      '/api/v1/auth/sessions/:sessionId',
      {
        schema: { params: sessionIdParamsSchema, response: { 200: nullResponseSchema } },
        config: general,
      },
      async (request, reply) => {
        const { user, session } = authOf(request);
        const { sessionId } = request.params;
        const revoked = await sessions.revoke(user.id, sessionId);
        if (!revoked) throw new AppError('NOT_FOUND', 'Resource not found.');
        await publishSessionRevoked(redis, request.log, {
          userId: user.id,
          sessionId,
          at: clock(),
        });
        if (sessionId === session.id) clearSessionCookie(reply, config);
        return reply.send(successEnvelope(null));
      },
    );

    // ───────────── AUTH-07 Change password ─────────────
    guarded.post(
      '/api/v1/auth/password',
      {
        schema: { body: changePasswordRequestSchema, response: { 200: nullResponseSchema } },
        config: { rateLimit: rateLimitConfig(rateLimits.password) },
      },
      async (request, reply) => {
        const { user, session } = authOf(request);
        const { currentPassword, newPassword } = request.body;
        await limitPasswordUser(request, reply, user.id);

        const row = await prisma.user.findUnique({
          where: { id: user.id },
          select: { passwordHash: true },
        });
        if (row === null || !(await verifyPassword(row.passwordHash, currentPassword))) {
          throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
        }

        const newHash = await hashPassword(newPassword);
        const now = clock();
        const revokedIds = await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash: newHash, passwordChangedAt: now },
            select: { id: true },
          });
          const others = await tx.session.findMany({
            where: { userId: user.id, revokedAt: null, id: { not: session.id } },
            select: { id: true },
          });
          const ids = others.map((s) => s.id);
          await tx.session.updateMany({
            where: { id: { in: ids } },
            data: { revokedAt: now },
          });
          return ids;
        });
        await Promise.all(
          revokedIds.map((sessionId) =>
            publishSessionRevoked(redis, request.log, { userId: user.id, sessionId, at: now }),
          ),
        );
        return reply.send(successEnvelope(null));
      },
    );

    // ───────────── USER-01 / USER-02 ─────────────
    await registerUserRoutes(guarded, dependencies, config);

    // ───────────── Phase 3: workspaces, invitations, pages, permissions, activity ─────────────
    const access = new AccessService(prisma);
    await registerWorkspaceRoutes(guarded, dependencies, config, access);
    await registerInvitationRoutes(guarded, dependencies, config, access);
    await registerPageRoutes(guarded, dependencies, config, access);
    await registerPagePermissionRoutes(guarded, dependencies, config, access);
    await registerActivityRoutes(guarded, dependencies, config, access);

    // ───────────── Phase 4: images (D55); Phase 6: collaboration tokens (PAGE-10) ─────────────
    await registerCollabTokenRoutes(guarded, dependencies, config, access);
    await registerAssetRoutes(guarded, dependencies, config, access);
  });
}
