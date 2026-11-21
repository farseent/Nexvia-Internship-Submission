export {
  resolveCollabAccess,
  type CollabAccessDecision,
  type CollabAccessDenial,
  type CollabAccessQuery,
} from './collab-access.js';
export { createPrismaClient } from './client.js';
export type { PrismaClient } from './client.js';
export { isDatabaseUnavailableError, isUniqueConstraintError } from './errors.js';
export {
  DocumentPageNotFoundError,
  DocumentRestoringError,
  DocumentStore,
  coverageDigestOf,
  type AppendResult,
  type BarrierRequest,
  type StoreOptions,
  type CompactOptions,
  type CompactResult,
  type LoadResult,
  type SeedResult,
} from './document-store.js';
export {
  PAGE_EDITED_ACTION,
  SNAPSHOT_LABEL_MAX_LENGTH,
  SnapshotStore,
  type CreateSnapshotInput,
  type CreateSnapshotResult,
  type SnapshotMeta,
} from './snapshots.js';
export { checkDatabase } from './health.js';
export { listExpectedMigrations } from './migrations.js';
export type { DatabaseCheckOptions } from './health.js';
export type {
  ActivityLog,
  Asset,
  Comment,
  CommentThread,
  DocumentSnapshot,
  DocumentState,
  DocumentUpdate,
  Invitation,
  Page,
  PageContent,
  PagePermission,
  Session,
  User,
  Workspace,
  WorkspaceMember,
} from './generated/prisma/client.js';
export type { Prisma } from './generated/prisma/client.js';
