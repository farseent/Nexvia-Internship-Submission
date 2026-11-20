-- Phase 3: workspaces, membership, invitations, pages, page permissions, activity
-- (docs/DATABASE_SCHEMA.md §3, §5, §6). The Prisma-generated part comes first; the
-- constraints Prisma cannot express follow at the end.

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PageAccessRole" AS ENUM ('NONE', 'VIEWER', 'COMMENTER', 'EDITOR');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID,
    "acceptedById" UUID,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "parentId" UUID,
    "title" VARCHAR(200) NOT NULL DEFAULT 'Untitled',
    "icon" VARCHAR(32),
    "position" VARCHAR(64) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedById" UUID,
    "deleteBatchId" UUID,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_permissions" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "PageAccessRole" NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "page_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pageId" UUID,
    "actorId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_members_userId_idx" ON "workspace_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_workspaceId_status_idx" ON "invitations"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "pages_workspaceId_parentId_position_idx" ON "pages"("workspaceId", "parentId", "position");

-- CreateIndex
CREATE INDEX "pages_workspaceId_deletedAt_idx" ON "pages"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "pages_deleteBatchId_idx" ON "pages"("deleteBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "pages_workspaceId_id_key" ON "pages"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "page_permissions_userId_idx" ON "page_permissions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "page_permissions_pageId_userId_key" ON "page_permissions"("pageId", "userId");

-- CreateIndex
CREATE INDEX "activity_logs_workspaceId_createdAt_idx" ON "activity_logs"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_pageId_createdAt_idx" ON "activity_logs"("pageId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_actorId_idx" ON "activity_logs"("actorId");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (composite: a parent page must be in the same workspace; a NULL parentId is a root page)
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspaceId_parentId_fkey" FOREIGN KEY ("workspaceId", "parentId") REFERENCES "pages"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_permissions" ADD CONSTRAINT "page_permissions_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_permissions" ADD CONSTRAINT "page_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_permissions" ADD CONSTRAINT "page_permissions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── Constraints Prisma cannot express (docs/DATABASE_SCHEMA.md §5) ─────────────

-- At most one OWNER per workspace.
CREATE UNIQUE INDEX "workspace_members_one_owner" ON "workspace_members" ("workspaceId") WHERE "role" = 'OWNER';

-- Exactly one OWNER per surviving workspace, checked at COMMIT (deferred) so a workspace and its
-- owner can be created together, ownership can be transferred inside one transaction, and a
-- workspace can be deleted (the check then finds no workspace and passes).
CREATE FUNCTION assert_workspace_has_exactly_one_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ws_ids uuid[];
  ws_id uuid;
  owner_count integer;
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    ws_ids := ARRAY[NEW."id"];
  ELSIF TG_OP = 'INSERT' THEN
    ws_ids := ARRAY[NEW."workspaceId"];
  ELSIF TG_OP = 'DELETE' THEN
    ws_ids := ARRAY[OLD."workspaceId"];
  ELSE
    ws_ids := ARRAY[OLD."workspaceId", NEW."workspaceId"];
  END IF;

  FOREACH ws_id IN ARRAY ws_ids LOOP
    IF EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = ws_id) THEN
      SELECT count(*) INTO owner_count
        FROM "workspace_members" WHERE "workspaceId" = ws_id AND "role" = 'OWNER';
      IF owner_count <> 1 THEN
        RAISE EXCEPTION 'workspace % must have exactly one OWNER (found %)', ws_id, owner_count
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "workspaces_owner_check"
  AFTER INSERT OR UPDATE ON "workspaces"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_workspace_has_exactly_one_owner();

CREATE CONSTRAINT TRIGGER "workspace_members_owner_check"
  AFTER INSERT OR UPDATE OR DELETE ON "workspace_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_workspace_has_exactly_one_owner();

-- invitations
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_not_owner" CHECK ("role" <> 'OWNER');
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_hash_format" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX "invitations_one_pending_per_email" ON "invitations" ("workspaceId", "email") WHERE "status" = 'PENDING';

-- pages
ALTER TABLE "pages" ADD CONSTRAINT "pages_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "pages" ADD CONSTRAINT "pages_position_format" CHECK ("position" ~ '^[0-9a-z]*[1-9a-z]$');
