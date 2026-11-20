/**
 * Logging conventions shared by all services (docs/CLAUDE.md §7, §9).
 * Never log tokens, passwords, cookies or document content.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Pino redaction paths applied by every service logger. */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.databaseUrl',
  '*.redisUrl',
  'password',
  'token',
  'secret',
];

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/** Accept an inbound request id only if it is short and uses a safe alphabet. */
export function isAcceptableRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s@]*@)/gi;

/** Replace `scheme://user:pass@host` credentials in free text with `scheme://***@host`. */
export function redactUrlCredentials(text: string): string {
  return text.replace(URL_CREDENTIALS, '$1***@');
}
