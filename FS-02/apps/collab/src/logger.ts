import { pino, type Logger } from 'pino';
import { LOG_REDACT_PATHS, type LogLevel } from '@conote/shared';

export interface LoggerOptions {
  service: string;
  level: LogLevel;
  nodeEnv: 'development' | 'test' | 'production';
}

/**
 * Structured JSON logger. Pretty output only in development, and only if
 * pino-pretty (a devDependency) is available.
 */
export function createLogger(options: LoggerOptions): Logger {
  const usePretty = options.nodeEnv === 'development';
  return pino({
    level: options.level,
    base: { service: options.service },
    redact: { paths: [...LOG_REDACT_PATHS], censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(usePretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l' } } }
      : {}),
  });
}
