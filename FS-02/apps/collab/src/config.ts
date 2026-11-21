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
  };
}
