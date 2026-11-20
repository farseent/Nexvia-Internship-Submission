-- Phase 5: Yjs document store (D15, docs/DATABASE_SCHEMA.md §4.4, §7, §14).
-- The Prisma-generated part comes first; the checks Prisma cannot express follow at the end.

-- CreateTable
CREATE TABLE "document_states" (
    "pageId" UUID NOT NULL,
    "foldedState" BYTEA NOT NULL,
    "persistedStateVector" BYTEA NOT NULL,
    "persistedDigest" BYTEA NOT NULL,
    "foldedSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_states_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "document_updates" (
    "seq" BIGSERIAL NOT NULL,
    "pageId" UUID NOT NULL,
    "update" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_updates_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "document_updates_pageId_seq_idx" ON "document_updates"("pageId", "seq");

-- AddForeignKey
ALTER TABLE "document_states" ADD CONSTRAINT "document_states_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_updates" ADD CONSTRAINT "document_updates_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Constraints Prisma does not model ─────────────

-- An update row always carries bytes (DATABASE_SCHEMA §5).
ALTER TABLE "document_updates" ADD CONSTRAINT "document_updates_nonempty" CHECK (octet_length("update") > 0);

-- The folded sequence never goes negative.
ALTER TABLE "document_states" ADD CONSTRAINT "document_states_foldedSeq_nonnegative" CHECK ("foldedSeq" >= 0);
