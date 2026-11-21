-- Phase 8: version history, comments and the restore barrier (D8, D9, D62;
-- docs/DATABASE_SCHEMA.md §4.4, §4.5). Prisma-generated part first, checks Prisma cannot express last.

-- CreateEnum
CREATE TYPE "SnapshotKind" AS ENUM ('AUTO', 'MANUAL', 'PRE_RESTORE');

-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('ACTIVE', 'DETACHED');

-- AlterTable
ALTER TABLE "document_states" ADD COLUMN     "restoreExpiresAt" TIMESTAMPTZ(6),
ADD COLUMN     "restoreOwnerId" UUID,
ADD COLUMN     "restoreToken" UUID;

-- CreateTable
CREATE TABLE "document_snapshots" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "kind" "SnapshotKind" NOT NULL,
    "label" VARCHAR(120),
    "state" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "coverageDigest" BYTEA NOT NULL,
    "createdById" UUID,
    "contributorIds" UUID[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_threads" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "anchorStart" BYTEA NOT NULL,
    "anchorEnd" BYTEA NOT NULL,
    "quotedText" VARCHAR(500) NOT NULL,
    "anchorStatus" "AnchorStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "comment_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" UUID,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_snapshots_pageId_createdAt_idx" ON "document_snapshots"("pageId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "comment_threads_pageId_resolvedAt_idx" ON "comment_threads"("pageId", "resolvedAt");

-- CreateIndex
CREATE INDEX "comments_threadId_createdAt_idx" ON "comments"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "comment_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── Constraints Prisma does not model ─────────────

ALTER TABLE "comments" ADD CONSTRAINT "comments_body_length" CHECK (char_length("body") BETWEEN 1 AND 5000);
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_state_nonempty" CHECK (octet_length("state") > 0);
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_size_matches" CHECK ("sizeBytes" = octet_length("state"));
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_anchors_nonempty" CHECK (octet_length("anchorStart") > 0 AND octet_length("anchorEnd") > 0);
-- A barrier is all three columns or none.
ALTER TABLE "document_states" ADD CONSTRAINT "document_states_restore_barrier_complete" CHECK (
  ("restoreToken" IS NULL AND "restoreOwnerId" IS NULL AND "restoreExpiresAt" IS NULL)
  OR ("restoreToken" IS NOT NULL AND "restoreOwnerId" IS NOT NULL AND "restoreExpiresAt" IS NOT NULL)
);

-- Snapshots are immutable (G7): no UPDATE. Rows are removed only by cascade (page purge, workspace
-- deletion) or by the retention job (U11), which runs as DELETE.
CREATE FUNCTION "document_snapshots_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'document_snapshots rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "document_snapshots_no_update"
BEFORE UPDATE ON "document_snapshots"
FOR EACH ROW EXECUTE FUNCTION "document_snapshots_immutable"();
