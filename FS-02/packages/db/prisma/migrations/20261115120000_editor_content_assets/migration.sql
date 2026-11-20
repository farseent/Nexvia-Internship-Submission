-- Phase 4: interim editor content (D54) and image assets (D55)
-- (docs/DATABASE_SCHEMA.md §4, §12.1). The Prisma-generated part comes first; the checks
-- Prisma cannot express follow at the end.

-- CreateEnum
CREATE TYPE "AssetPurpose" AS ENUM ('PAGE_IMAGE', 'AVATAR');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "page_contents" (
    "pageId" UUID NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "page_contents_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "pageId" UUID,
    "uploadedById" UUID,
    "purpose" "AssetPurpose" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "objectKey" VARCHAR(512) NOT NULL,
    "contentType" VARCHAR(127) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_objectKey_key" ON "assets"("objectKey");

-- CreateIndex
CREATE INDEX "assets_workspaceId_idx" ON "assets"("workspaceId");

-- CreateIndex
CREATE INDEX "assets_pageId_idx" ON "assets"("pageId");

-- CreateIndex
CREATE INDEX "assets_status_createdAt_idx" ON "assets"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "page_contents" ADD CONSTRAINT "page_contents_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_contents" ADD CONSTRAINT "page_contents_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── Constraints Prisma does not model ─────────────

-- Content is a JSON object, versions start at 1 (D54).
ALTER TABLE "page_contents" ADD CONSTRAINT "page_contents_content_is_object" CHECK (jsonb_typeof("content") = 'object');
ALTER TABLE "page_contents" ADD CONSTRAINT "page_contents_revision_positive" CHECK ("revision" >= 1 AND "schemaVersion" >= 1);

-- Images have a positive size (the upper limit is enforced by the API, D55).
ALTER TABLE "assets" ADD CONSTRAINT "assets_size_positive" CHECK ("sizeBytes" > 0);
