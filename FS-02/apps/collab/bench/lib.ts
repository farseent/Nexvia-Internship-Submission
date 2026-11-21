import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { documentNameForPage } from '@conote/shared';
import { requireInfraEnv } from '../../../tests/helpers.js';
import { Harness, type TestKeys, type TestUser } from '../test/harness.js';

/**
 * Benchmark support (docs/PERFORMANCE.md). Collab instances run as separate Node processes
 * from the compiled build, as in production, so each one's CPU time and memory can be read
 * from /proc. The clients run in the benchmark process. Everything shares this machine.
 */

export const ORIGIN = 'http://localhost:3000';
const CLOCK_TICKS = 100; // sysconf(_SC_CLK_TCK) on Linux
const PAGE_SIZE_KB = 4;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function percentiles(values: number[]): Record<string, number> {
  if (values.length === 0) return { n: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    n: sorted.length,
    p50: round(at(50)),
    p95: round(at(95)),
    p99: round(at(99)),
    max: round(sorted[sorted.length - 1]!),
    mean: round(mean),
  };
}

export interface InstanceOptions {
  id: string;
  port: number;
  keys: TestKeys;
  cluster?: boolean;
  prefix: string;
  env?: Record<string, string>;
}

/** A collab server process. */
export class Instance {
  private constructor(
    readonly options: InstanceOptions,
    private proc: ChildProcess,
    readonly startedAt: number,
  ) {}

  get pid(): number {
    return this.proc.pid!;
  }

  get port(): number {
    return this.options.port;
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  /** Start the process; resolves when it answers /health, with the time that took. */
  static async start(options: InstanceOptions): Promise<{ instance: Instance; startupMs: number }> {
    const infra = requireInfraEnv();
    const startedAt = performance.now();
    const proc = spawn('node', ['apps/collab/dist/main.js'], {
      cwd: new URL('../../../', import.meta.url).pathname,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn',
        DATABASE_URL: infra.DATABASE_URL,
        REDIS_URL: infra.REDIS_URL,
        APP_URL: ORIGIN,
        COLLAB_PORT: String(options.port),
        COLLAB_ADDRESS: '127.0.0.1',
        COLLAB_JWT_PUBLIC_KEYS: JSON.stringify([options.keys.publicJwk]),
        COLLAB_INSTANCE_ID: options.id,
        COLLAB_REDIS_PREFIX: options.prefix,
        COLLAB_CLUSTER_ENABLED: String(options.cluster ?? true),
        COLLAB_MAX_CONNECTIONS_PER_USER: '5000',
        COLLAB_MAX_MESSAGES_PER_SECOND: '10000',
        COLLAB_MAX_AWARENESS_PER_SECOND: '1000',
        ...options.env,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const instance = new Instance(options, proc, startedAt);
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
    });
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (proc.exitCode !== null)
        throw new Error(`instance ${options.id} exited: ${stderr.slice(-500)}`);
      try {
        const response = await fetch(`http://127.0.0.1:${options.port}/health`);
        if (response.ok) break;
      } catch {
        /* not listening yet */
      }
      if (Date.now() > deadline) throw new Error(`instance ${options.id} did not start`);
      await sleep(25);
    }
    return { instance, startupMs: performance.now() - startedAt };
  }

  /** CPU seconds (user + system) consumed so far. */
  cpuSeconds(): number {
    const stat = readFileSync(`/proc/${this.pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return (Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS;
  }

  /** Resident set size in MB. */
  rssMb(): number {
    const resident = Number(readFileSync(`/proc/${this.pid}/statm`, 'utf8').split(' ')[1]);
    return Math.round(((resident * PAGE_SIZE_KB) / 1024) * 10) / 10;
  }

  kill(signal: NodeJS.Signals): Promise<void> {
    return new Promise((resolve) => {
      if (this.proc.exitCode !== null) return resolve();
      this.proc.once('exit', () => resolve());
      this.proc.kill(signal);
    });
  }
}

/** Seed data and sign tokens through an in-process harness whose collab server stays unused. */
export class Seed {
  private constructor(readonly harness: Harness) {}

  static async create(): Promise<Seed> {
    const harness = await Harness.start();
    return new Seed(harness);
  }

  get keys(): TestKeys {
    return this.harness.keys;
  }

  async users(count: number): Promise<{ workspaceId: string; users: TestUser[] }> {
    const owner = await this.harness.user('bench-owner');
    const workspaceId = await this.harness.workspace(owner);
    const users = [owner];
    for (let i = 1; i < count; i += 1) {
      const user = await this.harness.user(`bench${i}`);
      await this.harness.member(workspaceId, user, 'EDITOR');
      users.push(user);
    }
    return { workspaceId, users };
  }

  page(workspaceId: string, user: TestUser): Promise<string> {
    return this.harness.page(workspaceId, user);
  }

  token(user: TestUser, pageId: string): Promise<string> {
    return this.harness.token(user, pageId);
  }

  async close(): Promise<void> {
    await this.harness.stop().catch(() => undefined);
    await this.harness.cleanup();
  }
}

class OriginSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols, { headers: { Origin: ORIGIN } });
  }
}

/** One open document, as one browser tab holds it. */
export class BenchClient {
  readonly doc = new Y.Doc();
  readonly provider: HocuspocusProvider;
  readonly socket: HocuspocusProviderWebsocket;
  synced = false;
  closes = 0;
  failure: string | undefined;
  private readonly settled: Promise<void>;

  constructor(
    url: string,
    seed: Seed,
    user: TestUser,
    readonly pageId: string,
    options: { reconnect?: boolean } = {},
  ) {
    let resolveSettled!: () => void;
    this.settled = new Promise((resolve) => (resolveSettled = resolve));
    this.socket = new HocuspocusProviderWebsocket({
      url,
      WebSocketPolyfill: OriginSocket as unknown as typeof globalThis.WebSocket,
      maxAttempts: options.reconnect === false ? 1 : 0,
      delay: 100,
      minDelay: 50,
      maxDelay: 500,
      jitter: false,
    });
    this.provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: documentNameForPage(pageId),
      document: this.doc,
      token: () => seed.token(user, pageId),
      onSynced: () => {
        this.synced = true;
        resolveSettled();
      },
      onAuthenticationFailed: ({ reason }: { reason: string }) => {
        this.failure = reason;
        resolveSettled();
      },
      onClose: () => {
        this.closes += 1;
        this.synced = false;
      },
    });
    this.provider.attach();
    setTimeout(resolveSettled, 15_000).unref();
  }

  /** Resolves when the first sync completed, or authentication failed, or 15 s passed. */
  async ready(): Promise<boolean> {
    await this.settled;
    return this.synced;
  }

  get ping(): Y.Map<number> {
    return this.doc.getMap<number>('ping');
  }

  destroy(): void {
    this.provider.destroy();
    this.socket.destroy();
    this.doc.destroy();
  }
}

/**
 * Round trip of one change: the writer sets a counter in a shared map, the reader notes when
 * it sees it. Both live in this process, so they share one clock.
 */
export async function measureLatency(
  writer: BenchClient,
  reader: BenchClient,
  samples: number,
  intervalMs: number,
  warmup = 20,
): Promise<number[]> {
  const sentAt = new Map<number, number>();
  const latencies: number[] = [];
  const waiting = new Map<number, () => void>();
  reader.ping.observe((event) => {
    for (const key of event.keysChanged) {
      const value = reader.ping.get(key);
      if (key !== 'n' || value === undefined) continue;
      const at = sentAt.get(value);
      if (at !== undefined) {
        if (value > warmup) latencies.push(performance.now() - at);
        sentAt.delete(value);
        waiting.get(value)?.();
      }
    }
  });
  for (let i = 1; i <= samples + warmup; i += 1) {
    const done = new Promise<void>((resolve) => {
      waiting.set(i, resolve);
      setTimeout(resolve, 3_000).unref();
    });
    sentAt.set(i, performance.now());
    writer.ping.set('n', i);
    await done;
    waiting.delete(i);
    await sleep(intervalMs);
  }
  return latencies;
}

export interface RedisCounters {
  commands: number;
  inBytes: number;
  outBytes: number;
}

/** Redis server-side counters, to attribute traffic to a scenario by taking differences. */
export async function redisCounters(redis: Redis): Promise<RedisCounters> {
  const info = await redis.info('stats');
  const read = (key: string) => Number(new RegExp(`${key}:(\\d+)`).exec(info)?.[1] ?? 0);
  return {
    commands: read('total_commands_processed'),
    inBytes: read('total_net_input_bytes'),
    outBytes: read('total_net_output_bytes'),
  };
}

export const redisClient = (): Redis => new Redis(requireInfraEnv().REDIS_URL);

export interface PgCounters {
  commits: number;
  inserted: number;
  updated: number;
}

export async function pgCounters(seed: Seed): Promise<PgCounters> {
  const rows = await seed.harness.prisma.$queryRaw<
    { commits: bigint; inserted: bigint; updated: bigint }[]
  >`
    SELECT xact_commit AS commits, tup_inserted AS inserted, tup_updated AS updated
    FROM pg_stat_database WHERE datname = current_database()`;
  const row = rows[0]!;
  return {
    commits: Number(row.commits),
    inserted: Number(row.inserted),
    updated: Number(row.updated),
  };
}

let nextPort = 4300;
export const takePort = (): number => nextPort++;
