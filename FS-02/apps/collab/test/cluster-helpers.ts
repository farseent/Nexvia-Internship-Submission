import net from 'node:net';
import { randomUUID } from 'node:crypto';
import type * as Y from 'yjs';
import { Harness, type HarnessOptions, type TestUser } from './harness.js';
import type { ClusterConfig } from '../src/config.js';

/**
 * A TCP proxy in front of Redis that can be cut and restored, to simulate an outage of Redis
 * as one collab instance sees it (the network breaks; the data in Redis is untouched).
 */
export class RedisProxy {
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  private cut = false;
  port = 0;

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  static fromUrl(redisUrl: string): RedisProxy {
    const url = new URL(redisUrl);
    return new RedisProxy(url.hostname, Number(url.port || 6379));
  }

  get url(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    this.server = net.createServer((client) => {
      if (this.cut) {
        client.destroy();
        return;
      }
      const upstream = net.connect(this.targetPort, this.targetHost);
      this.sockets.add(client);
      this.sockets.add(upstream);
      const close = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on('error', close).on('close', close);
      upstream.on('error', close).on('close', close);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  /** Break every connection and refuse new ones. */
  sever(): void {
    this.cut = true;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  /** Accept connections again. */
  restore(): void {
    this.cut = false;
  }

  async stop(): Promise<void> {
    this.sever();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

/**
 * A TCP load balancer in front of several collab instances: each new connection goes to the
 * next instance that is accepting connections. A WebSocket upgrade passes through unchanged.
 */
export class RoundRobinProxy {
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  private readonly ports: number[] = [];
  private next = 0;
  port = 0;

  get url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  setTargets(ports: number[]): void {
    this.ports.splice(0, this.ports.length, ...ports);
  }

  async start(): Promise<void> {
    this.server = net.createServer((client) => {
      const attempt = (triesLeft: number): void => {
        if (this.ports.length === 0 || triesLeft === 0) {
          client.destroy();
          return;
        }
        const port = this.ports[this.next++ % this.ports.length]!;
        const upstream = net.connect(port, '127.0.0.1');
        upstream.once('error', () => {
          upstream.destroy();
          attempt(triesLeft - 1);
        });
        upstream.once('connect', () => {
          upstream.removeAllListeners('error');
          this.sockets.add(client);
          this.sockets.add(upstream);
          const close = () => {
            client.destroy();
            upstream.destroy();
            this.sockets.delete(client);
            this.sockets.delete(upstream);
          };
          client.on('error', close).on('close', close);
          upstream.on('error', close).on('close', close);
          client.pipe(upstream);
          upstream.pipe(client);
        });
      };
      attempt(this.ports.length);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

/** A set of collab instances that share PostgreSQL, the signing keys and one Redis channel prefix. */
export class Cluster {
  readonly instances: Harness[] = [];
  readonly prefix = `conote-test:${randomUUID().slice(0, 8)}`;

  /** The first instance, which owns the seeded data. */
  get first(): Harness {
    return this.instances[0]!;
  }

  async add(options: HarnessOptions & { cluster?: Partial<ClusterConfig> } = {}): Promise<Harness> {
    const { cluster, config, ...rest } = options;
    const instance = await Harness.start({
      ...rest,
      ...(this.instances.length > 0 ? { keys: this.first.keys } : {}),
      config: {
        ...config,
        cluster: {
          enabled: true,
          instanceId: `i${this.instances.length + 1}-${randomUUID().slice(0, 4)}`,
          prefix: this.prefix,
          initialSyncTimeoutMs: 500,
          resyncIntervalMs: 0,
          resyncOnReconnect: true,
          storeReplicated: true,
          disconnectDelayMs: 50,
          ...cluster,
        },
      },
    });
    this.instances.push(instance);
    return instance;
  }

  /** Stop every instance; the first one also removes the seeded data. */
  async close(): Promise<void> {
    for (const instance of this.instances) await instance.stop().catch(() => undefined);
    for (const instance of [...this.instances].reverse()) {
      await instance.cleanup().catch(() => undefined);
    }
    this.instances.length = 0;
  }
}

/** Poll until `predicate` holds, failing with a readable message after `timeoutMs`. */
export async function eventually(
  predicate: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 8_000,
  stepMs = 25,
): Promise<number> {
  const startedAt = performance.now();
  for (;;) {
    if (await predicate()) return performance.now() - startedAt;
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

/** A small seeded pseudo-random generator, so a failing run can be replayed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Text of a client's shared document, in the field the tests edit. */
export function textOf(doc: Y.Doc): string {
  return doc.getText('t').toString();
}

export type { TestUser };
