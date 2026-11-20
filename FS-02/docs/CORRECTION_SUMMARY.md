# CoNote – Phase 0 Documentation Corrections (Historical Record)

These are documentation-only corrections. No application code was implemented and no tests or infrastructure experiments were run.

## Five corrections

1. **Redis outage and reconvergence**
   - Removed the unsupported claim that Redis reconnect automatically reconverges open Hocuspocus documents.
   - Documented Pub/Sub message loss, stale-document detection and explicit resynchronization.
   - Added unresolved item U13 for selecting and verifying the Phase 9 recovery mechanism.

2. **Exactly one workspace owner**
   - Clarified that the partial unique index enforces at most one owner only.
   - Required a deferred PostgreSQL constraint trigger to enforce at least one owner at transaction commit.
   - Documented atomic workspace creation and ownership transfer, with rollback tests.

3. **Readiness and degraded operation**
   - Separated liveness, API readiness, PostgreSQL health and Redis health.
   - Redis outage alone no longer makes the API globally unready.
   - Defined scoped degraded/fail-closed behaviour for Redis-dependent and security-sensitive operations.

4. **Concurrent page-tree mutations**
   - Required a workspace-scoped transaction advisory lock for all structural page-tree mutations.
   - Required a composite `(workspaceId, parentId)` foreign key to prevent cross-workspace parent links.
   - Added race tests for cycles, concurrent moves and depth limits.

5. **Version restore during active editing**
   - Required a durable per-page restore barrier across collab instances.
   - Drain and commit updates accepted before the barrier, then commit PRE_RESTORE before applying the restore.
   - Require safe abort/rollback on failure and client resynchronization after release.

## Files updated

- ARCHITECTURE.md
- DATABASE_SCHEMA.md
- IMPLEMENTATION_PLAN.md
- DECISIONS.md
- API_CONTRACTS.md
- WEBSOCKET_PROTOCOL.md
- TESTING.md
- DEPLOYMENT.md
- HANDOVER.md
- CLAUDE.md
- PROJECT_MASTER.md
- README.md

## Historical status

This file records design corrections made during Phase 0. It is a historical summary, not the current project status. Phase 1a infrastructure has since been implemented and owner-reported as verified; Phase 1b collaboration experiments remain outstanding. Current status and evidence are maintained in `docs/HANDOVER.md`. The Redis recovery mechanism still requires Phase 9 verification; the version-restore barrier still requires Phase 8 implementation and verification.
