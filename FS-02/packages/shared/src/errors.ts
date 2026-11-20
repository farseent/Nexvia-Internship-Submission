/**
 * Error code catalog. Source of truth: docs/API_CONTRACTS.md §1 "Error codes" (D31).
 * Each code maps to exactly one HTTP status.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  INVITATION_INVALID: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  INVALID_ORIGIN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  ALREADY_MEMBER: 409,
  INVITATION_EXISTS: 409,
  INVALID_MOVE: 409,
  CANNOT_RESTRICT_ADMIN: 409,
  OWNER_PROTECTED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface AppErrorOptions {
  details?: ErrorDetail[];
  /** Internal cause. Logged server-side, never serialized to clients. */
  cause?: unknown;
}

/**
 * An error that is safe to describe to clients: `code`, `message` and `details`
 * are returned in the response envelope. `cause` is never returned.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
  }

  get status(): number {
    return ERROR_CODES[this.code];
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
