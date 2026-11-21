import { randomUUID } from 'node:crypto';
import type { CollabEnv } from '@conote/shared';

export type Clock = () => Date;

/** Everything the collaboration server needs to know, independent of how it was configured. */
export interface CollabConfig {
  port: number;
  address: string;
  nodeEnv: 'development' | 'test' | 'production';
  allowedOrigins: readonly string[];
  /** Public keys (JWK) that verify collaboration tokens, by `kid` (D22). */
  publicKeys: readonly { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string }[];
  revalidateIntervalMs: number;
  storeDebounceMs: number;
  storeMaxDebounceMs: number;
  compactUpdateCount: number;
  maxPayloadBytes: number;
  maxConnectionsPerUser: number;
  maxConnections: number;
  maxMessagesPerSecond: number;
  shutdownTimeoutMs: number;
  /** Awareness messages one connection may send per second; the excess is dropped. */
  maxAwarenessPerSecond: number;
  /** Phase 8 (D62, D63). */
  autoSnapshotIntervalMs: number;
  autoSnapshotKeep: number;
  editActivityIntervalMs: number;
  restoreBarrierTtlMs: number;
  /** Close a connection that sent nothing for this long (heartbeat, Phase 9). */
  connectionTimeoutMs: number;
  /** Cross-instance synchronization (Phase 9, D64). */
  cluster: ClusterConfig;
}

/** Settings of the Redis cross-instance synchronization (docs/ARCHITECTURE.md §9). */
export interface ClusterConfig {
  enabled: boolean;
  instanceId: string;
  prefix: string;
  initialSyncTimeoutMs: number;
  /** Anti-entropy interval; 0 switches the periodic check off. */
  resyncIntervalMs: number;
  /** Run the recovery procedure when Redis comes back (always on in production; tests turn it off to show why it is needed). */
  resyncOnReconnect: boolean;
  /** Also store changes that arrived from another instance. */
  storeReplicated: boolean;
  /** How long an unloading document waits so that last syncs can finish (the extension's `disconnectDelay`). */
  disconnectDelayMs: number;
}

export function createCollabConfig(env: CollabEnv, address = '0.0.0.0'): CollabConfig {
  return {
    port: env.COLLAB_PORT,
    address,
    nodeEnv: env.NODE_ENV,
    allowedOrigins: env.COLLAB_ALLOWED_ORIGINS,
    publicKeys: env.COLLAB_JWT_PUBLIC_KEYS,
    revalidateIntervalMs: env.COLLAB_REVALIDATE_INTERVAL_MS,
    storeDebounceMs: env.COLLAB_STORE_DEBOUNCE_MS,
    storeMaxDebounceMs: env.COLLAB_STORE_MAX_DEBOUNCE_MS,
    compactUpdateCount: env.COLLAB_COMPACT_UPDATE_COUNT,
    maxPayloadBytes: env.COLLAB_MAX_PAYLOAD_BYTES,
    maxConnectionsPerUser: env.COLLAB_MAX_CONNECTIONS_PER_USER,
    maxConnections: env.COLLAB_MAX_CONNECTIONS,
    maxMessagesPerSecond: env.COLLAB_MAX_MESSAGES_PER_SECOND,
    shutdownTimeoutMs: env.COLLAB_SHUTDOWN_TIMEOUT_MS,
    maxAwarenessPerSecond: env.COLLAB_MAX_AWARENESS_PER_SECOND,
    autoSnapshotIntervalMs: env.COLLAB_AUTO_SNAPSHOT_INTERVAL_MS,
    autoSnapshotKeep: env.COLLAB_AUTO_SNAPSHOT_KEEP,
    editActivityIntervalMs: env.COLLAB_EDIT_ACTIVITY_INTERVAL_MS,
    restoreBarrierTtlMs: env.COLLAB_RESTORE_BARRIER_TTL_MS,
    connectionTimeoutMs: env.COLLAB_CONNECTION_TIMEOUT_MS,
    cluster: {
      enabled: env.COLLAB_CLUSTER_ENABLED,
      instanceId: env.COLLAB_INSTANCE_ID ?? `collab-${randomUUID().slice(0, 8)}`,
      prefix: env.COLLAB_REDIS_PREFIX,
      initialSyncTimeoutMs: env.COLLAB_CLUSTER_INITIAL_SYNC_TIMEOUT_MS,
      resyncIntervalMs: env.COLLAB_CLUSTER_RESYNC_INTERVAL_MS,
      resyncOnReconnect: true,
      storeReplicated: env.COLLAB_CLUSTER_STORE_REPLICATED,
      disconnectDelayMs: 1_000,
    },
  };
}
