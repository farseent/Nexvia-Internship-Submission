import { collabEnvSchema, parseEnv } from '@conote/shared';
import { createCollabConfig } from './config.js';
import { createDependencies } from './dependencies.js';
import { createLogger } from './logger.js';
import { buildCollabServer } from './server.js';

async function main(): Promise<void> {
  // Fail fast on invalid configuration. Messages list variable names, never values.
  const env = parseEnv('collab', collabEnvSchema, process.env);

  const logger = createLogger({ service: 'collab', level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });
  const dependencies = createDependencies(env, logger);
  const collab = buildCollabServer({ config: createCollabConfig(env), logger, dependencies });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await collab.stop();
      await dependencies.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await collab.start();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : 'startup failed'}\n`);
  process.exit(1);
});
