import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { SignJWT, importJWK } from 'jose';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {
  ACCESS_EVENTS_CHANNEL,
  COLLAB_TOKEN_AUDIENCE,
  COLLAB_TOKEN_ISSUER,
  documentNameForPage,
  parseServerMessage,
  type AccessEvent,
  type ServerMessage,
} from '@conote/shared';
import type { PrismaClient } from '@conote/db';
import { requireInfraEnv } from '../../../tests/helpers.js';
import type { CollabConfig } from '../src/config.js';
import { createDependencies } from '../src/dependencies.js';
import { buildCollabServer, type CollabServer } from '../src/server.js';

/** The `ws` WebSocket class, for tests that run client code in another environment (jsdom). */
export { WebSocket as NodeWebSocket };
export const EMAIL_DOMAIN = '@collab-test.example';
export const TEST_ORIGIN = 'http://localhost:3000';

type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER';

export interface TestKeys {
  privateJwk: { kty: 'OKP'; crv: 'Ed25519'; x: string; d: string; kid: string };
  publicJwk: { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string };
}

export function generateKeys(kid = `k-${randomUUID().slice(0, 6)}`): TestKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return {
    privateJwk: { kty: 'OKP', crv: 'Ed25519', x: priv.x as string, d: priv.d as string, kid },
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x: pub.x as string, kid },
  };
}

export interface HarnessOptions {
  config?: Partial<CollabConfig>;
  keys?: TestKeys;
  persistence?: { retryDelayMs?: (attempt: number) => number };
  prisma?: PrismaClient;
  clock?: () => Date;
}

/** A running collaboration server against the real PostgreSQL and Redis, plus seeding helpers. */
export class Harness {
  readonly prisma: PrismaClient;
  readonly redis: Redis;
  readonly keys: TestKeys;
  readonly clients: TestClient[] = [];
  private readonly createdUserIds: string[] = [];
  private readonly createdWorkspaceIds: string[] = [];
  private readonly closeDeps: () => Promise<void>;

  private constructor(
    readonly collab: CollabServer,
    prisma: PrismaClient,
    redis: Redis,
    keys: TestKeys,
    closeDeps: () => Promise<void>,
  ) {
    this.prisma = prisma;
    this.redis = redis;
    this.keys = keys;
    this.closeDeps = closeDeps;
  }

  static async start(options: HarnessOptions = {}): Promise<Harness> {
    const infra = requireInfraEnv();
    const keys = options.keys ?? generateKeys();
    const logger = pino({ level: 'silent' });
    const dependencies = createDependencies(infra, logger);
    const config: CollabConfig = {
      port: 0,
      address: '127.0.0.1',
      nodeEnv: 'test',
      allowedOrigins: [TEST_ORIGIN],
      publicKeys: [keys.publicJwk],
      revalidateIntervalMs: 3_600_000,
      storeDebounceMs: 40,
      storeMaxDebounceMs: 200,
      compactUpdateCount: 200,
      maxPayloadBytes: 1_048_576,
      maxConnectionsPerUser: 50,
      maxConnections: 5000,
      maxMessagesPerSecond: 10_000,
      maxAwarenessPerSecond: 10_000,
      shutdownTimeoutMs: 5000,
      ...options.config,
    };
    const collab = buildCollabServer({
      config,
      logger,
      dependencies,
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.persistence ? { persistence: options.persistence } : {}),
    });
    await collab.start();
    const redis = new Redis(infra.REDIS_URL);
    return new Harness(collab, dependencies.prisma, redis, keys, async () => {
      await redis.quit();
      await dependencies.close();
    });
  }

  get url(): string {
    return `ws://127.0.0.1:${this.collab.port}`;
  }

  get httpUrl(): string {
    return `http://127.0.0.1:${this.collab.port}`;
  }

  // ───────────── seeding ─────────────

  async user(label = 'u', presenceColor = '#4F46E5'): Promise<TestUser> {
    const id = randomUUID();
    await this.prisma.user.create({
      data: {
        id,
        email: `${label.toLowerCase()}-${id.slice(0, 8)}${EMAIL_DOMAIN}`,
        passwordHash: 'not-a-real-hash',
        displayName: label,
        presenceColor,
      },
    });
    this.createdUserIds.push(id);
    const session = await this.session(id);
    return { id, sessionId: session, name: label, color: presenceColor };
  }

  async session(userId: string, overrides: { expiresAt?: Date; absoluteExpiresAt?: Date } = {}) {
    const id = randomUUID();
    await this.prisma.session.create({
      data: {
        id,
        userId,
        tokenHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: overrides.absoluteExpiresAt ?? new Date(Date.now() + 86_400_000),
      },
    });
    return id;
  }

  async workspace(owner: TestUser): Promise<string> {
    const id = randomUUID();
    // The database requires exactly one OWNER when the workspace is committed.
    await this.prisma.workspace.create({
      data: {
        id,
        name: 'Collab test',
        createdById: owner.id,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    this.createdWorkspaceIds.push(id);
    return id;
  }

  async member(workspaceId: string, user: TestUser, role: Role): Promise<void> {
    await this.prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } });
  }

  async page(workspaceId: string, createdBy: TestUser, parentId?: string): Promise<string> {
    const id = randomUUID();
    await this.prisma.page.create({
      data: {
        id,
        workspaceId,
        parentId: parentId ?? null,
        position: 'a' + id.slice(0, 6).replaceAll('0', '1'),
        createdById: createdBy.id,
      },
    });
    return id;
  }

  /** A workspace with an owner and one page, the common starting point. */
  async scene(): Promise<{ owner: TestUser; workspaceId: string; pageId: string }> {
    const owner = await this.user('owner');
    const workspaceId = await this.workspace(owner);
    const pageId = await this.page(workspaceId, owner);
    return { owner, workspaceId, pageId };
  }

  // ───────────── tokens and clients ─────────────

  async token(
    user: TestUser,
    pageId: string,
    overrides: {
      sessionId?: string;
      iss?: string;
      aud?: string;
      pid?: string;
      iat?: number;
      exp?: number;
      keys?: TestKeys;
      kid?: string | null;
      alg?: 'EdDSA';
    } = {},
  ): Promise<string> {
    const keys = overrides.keys ?? this.keys;
    const iat = overrides.iat ?? Math.floor(Date.now() / 1000);
    const key = await importJWK(keys.privateJwk, 'EdDSA');
    const header: { alg: 'EdDSA'; typ: string; kid?: string } = { alg: 'EdDSA', typ: 'JWT' };
    if (overrides.kid !== null) header.kid = overrides.kid ?? keys.privateJwk.kid;
    return new SignJWT({ sid: overrides.sessionId ?? user.sessionId, pid: overrides.pid ?? pageId })
      .setProtectedHeader(header)
      .setIssuer(overrides.iss ?? COLLAB_TOKEN_ISSUER)
      .setAudience(overrides.aud ?? COLLAB_TOKEN_AUDIENCE)
      .setSubject(user.id)
      .setJti(randomUUID())
      .setIssuedAt(iat)
      .setExpirationTime(overrides.exp ?? iat + 60)
      .sign(key);
  }

  /** Open a document as `user`. Resolves when the first sync finished or authentication failed. */
  async connect(
    user: TestUser,
    pageId: string,
    options: {
      token?: string | (() => Promise<string>);
      name?: string;
      url?: string;
      origin?: string;
      reconnect?: boolean;
      doc?: Y.Doc;
    } = {},
  ): Promise<TestClient> {
    const client = new TestClient(this, user, pageId, options);
    this.clients.push(client);
    await client.settled;
    return client;
  }

  /** True once anything of the page's document is in PostgreSQL (rows, or folded into the state). */
  async hasStoredData(pageId: string): Promise<boolean> {
    const rows = await this.prisma.documentUpdate.count({ where: { pageId } });
    if (rows > 0) return true;
    const state = await this.prisma.documentState.findUnique({ where: { pageId } });
    return state !== null && state.foldedSeq > 0n;
  }

  async publish(event: Omit<AccessEvent, 'v' | 'at'>): Promise<void> {
    const payload: AccessEvent = { v: 1, at: new Date().toISOString(), ...event } as AccessEvent;
    await this.redis.publish(ACCESS_EVENTS_CHANNEL, JSON.stringify(payload));
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.clients.map((client) => client.destroy()));
    await this.collab.stop();
  }

  async cleanup(): Promise<void> {
    // Workspaces first: removing a user would leave a workspace without its OWNER.
    await this.prisma.workspace.deleteMany({ where: { id: { in: this.createdWorkspaceIds } } });
    await this.prisma.user.deleteMany({ where: { id: { in: this.createdUserIds } } });
    await this.closeDeps();
  }
}

export interface TestUser {
  id: string;
  sessionId: string;
  /** The display name and presence colour the user was created with. */
  name: string;
  color: string;
}

/** Poll until `check` is true; fails with `what` after `timeoutMs`. */
export async function until(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A real Hocuspocus provider client in Node with its own Y.Doc. */
export class TestClient {
  readonly doc: Y.Doc;
  readonly provider: HocuspocusProvider;
  readonly messages: ServerMessage[] = [];
  readonly authFailures: string[] = [];
  readonly closes: { code: number; reason: string }[] = [];
  synced = false;
  /** How many times the socket reached `connected` (1 after the first connect). */
  connections = 0;
  /** Resolves when the client is synced or authentication failed. */
  readonly settled: Promise<void>;

  constructor(
    harness: Harness,
    readonly user: TestUser,
    readonly pageId: string,
    options: {
      token?: string | (() => Promise<string>);
      name?: string;
      url?: string;
      origin?: string;
      reconnect?: boolean;
      doc?: Y.Doc;
    },
  ) {
    this.doc = options.doc ?? new Y.Doc();
    const origin = options.origin ?? TEST_ORIGIN;
    // A WebSocket class that sends the Origin header, as a browser would.
    class OriginSocket extends WebSocket {
      constructor(address: string | URL, protocols?: string | string[]) {
        super(address, protocols, { headers: { Origin: origin } });
      }
    }
    let resolveSettled!: () => void;
    this.settled = new Promise((resolve) => (resolveSettled = resolve));
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: options.url ?? harness.url,
      WebSocketPolyfill: (origin === ''
        ? WebSocket
        : OriginSocket) as unknown as typeof globalThis.WebSocket,
      maxAttempts: options.reconnect === false ? 1 : 0,
      delay: 100,
      minDelay: 50,
      maxDelay: 400,
      jitter: false,
    });
    this.provider = new HocuspocusProvider({
      websocketProvider,
      name: options.name ?? documentNameForPage(pageId),
      document: this.doc,
      token: options.token ?? (() => harness.token(user, pageId)),
      onSynced: () => {
        this.synced = true;
        // As the web client does: a first awareness update has clock 0, which y-protocols
        // ignores, so publish again once the server knows this connection.
        const awareness = this.provider.awareness;
        awareness?.setLocalState(awareness.getLocalState() ?? {});
        resolveSettled();
      },
      onAuthenticationFailed: ({ reason }: { reason: string }) => {
        this.authFailures.push(reason);
        resolveSettled();
      },
      onStateless: ({ payload }: { payload: string }) => {
        const message = parseServerMessage(payload);
        if (message) this.messages.push(message);
      },
      onClose: ({ event }: { event: { code: number; reason: string } }) => {
        this.closes.push({ code: event.code, reason: event.reason });
      },
    });
    this.provider.attach();
    this.provider.on('status', ({ status }: { status: string }) => {
      if (status === 'connected') this.connections += 1;
    });
    // A refused WebSocket upgrade never authenticates; do not wait for ever on it.
    setTimeout(resolveSettled, 4000).unref();
  }

  /** Connected and synced right now. */
  get online(): boolean {
    return (
      this.provider.configuration.websocketProvider.status === 'connected' && this.provider.synced
    );
  }

  /** The text of the shared fragment, for convergence checks. */
  get text(): string {
    return this.doc.getText('t').toString();
  }

  insert(text: string, index = this.doc.getText('t').length): void {
    this.doc.getText('t').insert(index, text);
  }

  messageTypes(): string[] {
    return this.messages.map((message) => message.type);
  }

  /** Drop the TCP connection without a close handshake (a network failure). */
  dropNetwork(): void {
    const socket = this.provider.configuration.websocketProvider
      .webSocket as unknown as WebSocket | null;
    socket?.terminate();
  }

  async destroy(): Promise<void> {
    this.provider.destroy();
    this.provider.configuration.websocketProvider.destroy();
  }
}
