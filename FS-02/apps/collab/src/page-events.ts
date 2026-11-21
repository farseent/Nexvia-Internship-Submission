import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { PAGE_EVENTS_CHANNEL, pageEventSchema, type PageEvent } from '@conote/shared';
import type { VersionService } from './versions.js';

/**
 * Subscribes to page events (docs/WEBSOCKET_PROTOCOL.md §10). `comments.changed` is forwarded to
 * the page's connections on this instance; `document.restored` makes this instance catch up with
 * PostgreSQL. Delivery is at-most-once: clients refetch after a reconnect (D14), and a document
 * that missed a restore event catches up the next time it is opened or restored.
 */
export class PageEventListener {
  constructor(
    private readonly subscriber: Redis,
    private readonly versions: VersionService,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel === PAGE_EVENTS_CHANNEL) void this.handle(raw);
    });
    try {
      await this.subscriber.subscribe(PAGE_EVENTS_CHANNEL);
    } catch (err) {
      this.logger.warn(
        { err: { name: (err as Error).name } },
        'could not subscribe to page events yet',
      );
    }
  }

  async stop(): Promise<void> {
    this.subscriber.removeAllListeners('message');
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }

  /** Exposed for tests. */
  async handle(raw: string): Promise<void> {
    let event: PageEvent;
    try {
      const parsed = pageEventSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        this.logger.warn('ignored a malformed page event');
        return;
      }
      event = parsed.data;
    } catch {
      this.logger.warn('ignored a page event that is not JSON');
      return;
    }
    try {
      if (event.type === 'comments.changed') {
        this.versions.broadcast(event.pageId, {
          v: 1,
          type: 'comments.changed',
          payload: { pageId: event.pageId },
        });
      } else {
        await this.versions.catchUp(event.pageId);
      }
    } catch (err) {
      this.logger.error(
        { type: event.type, err: { name: (err as Error).name } },
        'page event failed',
      );
    }
  }
}
