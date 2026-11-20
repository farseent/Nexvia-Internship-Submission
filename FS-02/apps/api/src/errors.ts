import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { isDatabaseUnavailableError } from '@conote/db';
import { AppError, errorEnvelope, type ErrorCode, type ErrorDetail } from '@conote/shared';
import { isRedisUnavailableError } from './redis.js';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

const CLIENT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'The request is invalid.',
  INVITATION_INVALID: 'The invitation is invalid.',
  UNAUTHENTICATED: 'Authentication is required.',
  INVALID_CREDENTIALS: 'Invalid credentials.',
  FORBIDDEN: 'You do not have permission to do this.',
  INVALID_ORIGIN: 'Origin not allowed.',
  NOT_FOUND: 'Resource not found.',
  CONFLICT: 'The request conflicts with the current state.',
  EMAIL_TAKEN: 'Email already registered.',
  ALREADY_MEMBER: 'Already a member.',
  INVITATION_EXISTS: 'A pending invitation already exists.',
  INVALID_MOVE: 'The move is not allowed.',
  CANNOT_RESTRICT_ADMIN: 'Admins and owners cannot be restricted.',
  OWNER_PROTECTED: 'The owner cannot be removed or demoted.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported content type.',
  RATE_LIMITED: 'Too many requests.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
  SERVICE_UNAVAILABLE: 'A required service is unavailable.',
};

/** `/body/email` → `email`; the message comes from the schema and never echoes input values. */
function toDetails(
  validation: readonly { instancePath: string; message?: string | undefined }[],
): ErrorDetail[] {
  return validation.map((issue) => ({
    path: issue.instancePath.replace(/^\//, '').replace(/\//g, '.'),
    message: issue.message ?? 'Invalid value.',
  }));
}

/**
 * Standard error envelope for every failure (docs/API_CONTRACTS.md §1, D31).
 * Unexpected errors are logged with their cause and returned as a generic
 * INTERNAL_ERROR: internals are never leaked to clients.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AppError) {
        request.log.info({ code: error.code }, 'request failed');
        return reply.code(error.status).send(
          errorEnvelope({
            code: error.code,
            message: error.message,
            requestId: request.id,
            ...(error.details ? { details: error.details } : {}),
          }),
        );
      }

      if (hasZodFastifySchemaValidationErrors(error)) {
        request.log.info({ code: 'VALIDATION_ERROR' }, 'request rejected');
        return reply.code(400).send(
          errorEnvelope({
            code: 'VALIDATION_ERROR',
            message: CLIENT_MESSAGES.VALIDATION_ERROR,
            requestId: request.id,
            details: toDetails(error.validation),
          }),
        );
      }

      if (isDatabaseUnavailableError(error) || isRedisUnavailableError(error)) {
        request.log.warn(
          { err: { name: error.name, message: error.message } },
          'dependency unavailable',
        );
        return reply.code(503).send(
          errorEnvelope({
            code: 'SERVICE_UNAVAILABLE',
            message: CLIENT_MESSAGES.SERVICE_UNAVAILABLE,
            requestId: request.id,
          }),
        );
      }

      if (isResponseSerializationError(error)) {
        request.log.error({ err: error }, 'response did not match its schema');
        return reply.code(500).send(
          errorEnvelope({
            code: 'INTERNAL_ERROR',
            message: CLIENT_MESSAGES.INTERNAL_ERROR,
            requestId: request.id,
          }),
        );
      }

      const status = (error as FastifyError).statusCode;
      const mapped = typeof status === 'number' ? STATUS_TO_CODE[status] : undefined;
      if (mapped !== undefined && status !== undefined) {
        request.log.info({ code: mapped }, 'request rejected');
        return reply.code(status).send(
          errorEnvelope({
            code: mapped,
            message: CLIENT_MESSAGES[mapped],
            requestId: request.id,
          }),
        );
      }

      request.log.error({ err: error }, 'unhandled error');
      return reply.code(500).send(
        errorEnvelope({
          code: 'INTERNAL_ERROR',
          message: CLIENT_MESSAGES.INTERNAL_ERROR,
          requestId: request.id,
        }),
      );
    },
  );

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send(
      errorEnvelope({
        code: 'NOT_FOUND',
        message: CLIENT_MESSAGES.NOT_FOUND,
        requestId: request.id,
      }),
    );
  });
}
