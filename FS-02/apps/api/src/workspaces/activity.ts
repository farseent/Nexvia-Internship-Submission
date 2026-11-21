import type { Prisma } from '@conote/db';

/** Action catalog written in Phase 3 (docs/DATABASE_SCHEMA.md §6). Adding one needs no migration. */
export type ActivityAction =
  | 'workspace.created'
  | 'workspace.updated'
  | 'member.invited'
  | 'member.joined'
  | 'member.declined'
  | 'member.role_changed'
  | 'member.removed'
  | 'member.left'
  | 'ownership.transferred'
  | 'invitation.revoked'
  | 'invitation.resent'
  | 'page.created'
  | 'page.renamed'
  | 'page.moved'
  | 'page.deleted'
  | 'page.restored'
  | 'page.purged'
  | 'page.permission_set'
  | 'page.permission_removed'
  | 'page.edited'
  | 'version.created'
  | 'version.restored'
  | 'comment.thread_created'
  | 'comment.thread_resolved'
  | 'comment.thread_reopened';

export interface ActivityEntry {
  workspaceId: string;
  actorId: string | null;
  action: ActivityAction;
  pageId?: string | null;
  /** Ids and non-sensitive context only: never tokens, emails, passwords or document text. */
  metadata?: Prisma.InputJsonObject;
  at: Date;
}

/** Write one activity row inside the caller's transaction, so it commits or rolls back with the change. */
export async function logActivity(
  tx: Prisma.TransactionClient,
  entry: ActivityEntry,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      workspaceId: entry.workspaceId,
      actorId: entry.actorId,
      action: entry.action,
      pageId: entry.pageId ?? null,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      createdAt: entry.at,
    },
    select: { id: true },
  });
}
