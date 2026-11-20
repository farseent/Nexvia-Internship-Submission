import type { Logger } from 'pino';
import type { AccessController } from './access-control.js';
import type { ConnectionRegistry } from './connection-registry.js';

/**
 * Periodically re-checks every open connection against PostgreSQL (docs/WEBSOCKET_PROTOCOL.md
 * §10, D22). This bounds how long a lost access event, or a Redis outage, can leave a removed
 * user connected. Runs never overlap: a slow run delays the next one instead of piling up.
 */
export class PeriodicRevalidation {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly access: AccessController,
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over all connections. Exposed for tests. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const contexts = this.registry.snapshot();
      if (contexts.length === 0) return;
      const result = await this.access.revalidate(contexts);
      if (result.changed > 0 || result.revoked > 0 || result.failed > 0) {
        this.logger.info(result, 'periodic revalidation');
      }
    } catch (err) {
      this.logger.error({ err: { name: (err as Error).name } }, 'periodic revalidation failed');
    } finally {
      this.running = false;
    }
  }
}
