import { parseEnv, webEnvSchema, type WebEnv } from '@conote/shared';

let cached: WebEnv | undefined;

/**
 * Validated server-side environment for the web app (docs/DEPLOYMENT.md §4).
 * Server-only: never import this from a client component.
 */
export function getWebEnv(): WebEnv {
  cached ??= parseEnv('web', webEnvSchema, process.env);
  return cached;
}
