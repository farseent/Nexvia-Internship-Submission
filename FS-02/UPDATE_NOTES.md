# CoNote – Documentation reconciliation package

Date: 2026-11-12

This is a documentation/configuration correction bundle for the Phase 1a repository snapshot.
Unzip it over the repository root and review the resulting `git diff` before committing.

## What changed

1. Reconciled project status: Phase 1a infrastructure is complete based on owner-reported local and CI evidence; Phase 1b is outstanding and the owner selected it before Phase 2.
2. Updated HANDOVER with the owner-reported verification: `pnpm check`, 59 tests (47 unit + 12 integration), successful baseline migration deploy/status, healthy PostgreSQL/Redis Compose services, passing GitHub Actions CI, browser smoke check, and the reported commit `ba82d24`. These are clearly labelled owner-reported; this review did not rerun them.
3. Resolved U5/V8 based on Prisma client generation, real adapter query, and successful migration deploy/status. U1/U2 remain pending explicit owner sign-off.
4. Marked D33 accepted to record the owner's choice to run Phase 1b before Phase 2.
5. Clarified Phase 1b S1–S11 scope: spike observations are not production verification; production token refresh, abuse limits, presence enforcement and Redis outage recovery remain in their later phases.
6. Corrected the Redis outage wording: Redis Pub/Sub does not replay missed messages; reconnect alone does not guarantee live-document reconvergence. U13 remains a Phase 9 decision.
7. Aligned the local PostgreSQL host port with Compose: host `5433` maps to container `5432`; `.env.example` now uses `localhost:5433`.
8. Clarified that MinIO/object storage is not part of Phase 1 Compose (D37), and corrected stale Phase 0 status headers in the relevant docs.
9. Fixed the literal `\\n` formatting error between CLAUDE.md rules 14 and 15.

## Files included

- `CLAUDE.md`
- `README.md`
- `.env.example`
- `docs/PROJECT_MASTER.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/API_CONTRACTS.md`
- `docs/WEBSOCKET_PROTOCOL.md`
- `docs/DECISIONS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/TESTING.md`
- `docs/DEPLOYMENT.md`
- `docs/HANDOVER.md`
- `docs/CORRECTION_SUMMARY.md`

## Important limits

- The uploaded repository ZIP excludes `.git`; the commit/branch information in HANDOVER is based on the owner's earlier report, not verified from the archive.
- No Phase 1b spike implementation or results were found in the archive. No S1–S11 result is claimed.
- Docker Compose PostgreSQL/Redis startup was reported successful; the optional Docker app-image build is explicitly left unverified.
- No production feature, authentication or collaboration implementation is claimed.
