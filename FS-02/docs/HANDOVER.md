# CoNote – Handover

**Last updated:** 2026-11-20 (**Phase 8 implemented and executed in a preparation environment on 2026-11-19 (61 files, 1077 tests passing there, §13) and owner-verified locally on 2026-11-20 (§13.11): migration deploy and drift check clean, build, lint, format check and typecheck passed, one deterministic test failure traced to a test-ordering bug and fixed, comments and version history checked in two real browsers; D62 and D63 accepted.** **Phase 7 owner-verified locally on 2026-11-19 (§12.11) and D61 accepted; Phase 7 implemented 2026-11-18, see the Phase 7 paragraph below. Phase 6 implemented 2026-11-17, executed in a preparation environment, and verified on the owner's machine on 2026-11-18 (§11.11): install, lint, format check, typecheck, 878 tests and a manual real-browser walkthrough passed; D58–D60 accepted**). Earlier: 2026-11-17 (Phase 6 implemented and executed in a preparation environment only); 2026-11-16 (Phase 5 implemented, executed in a preparation environment and verified on the owner's machine; D57 accepted; Phase 4 accepted by the owner on 2026-11-16 — the older "final acceptance pending" wording below is superseded)

**Phase 8 (2026-11-19):** Comments and Version History is implemented and was executed in a preparation environment (§13.8): 61 files, 1077 tests passing there (baseline 966), lint, typecheck and format clean (the repository-wide format check still fails only on `infra/docker-compose.yml`). **Verified on the owner's machine and in real browsers on 2026-11-20 (§13.11): `migrate deploy`, `migrate status` and the scratch-database drift check are clean, and the owner checklist (§13.7) worked. D62 and D63 were accepted on 2026-11-20.** Not done: a full-suite rerun after the test fix, Docker, GitHub Actions, two collab instances in real browsers (Phase 9). AC-8.6 is met for one instance and for the persistence barrier across two; live convergence of ordinary edits across instances waits for Phase 9 (§13.3). Stop after Phase 8, as instructed.

**Phase 7 (2026-11-18):** Presence and Collaborative UI is implemented and was executed in a preparation environment (§12.8): 55 files, 966 tests passing there (baseline 878), lint and typecheck clean. **Verified on the owner's machine and in real browsers on 2026-11-19 (§12.11): install, package build, lint, format check, typecheck, the full test run (965 of 966 tests passed; the one failure is a Phase 6 persistence test that is flaky under load and passed 4 of 4 times alone) and the whole owner checklist (§12.7) in real browsers. D61 was accepted on 2026-11-19.** Not done: final Phase 7 acceptance, Docker, GitHub Actions, long idle runs. Stopped after Phase 7 as instructed. Read §12.4 (findings), §12.7 (owner checklist) and §12.11 (verification) first.

**Current phase: Phase 6 – WebSocket Server and Real-Time Collaboration. Implemented and executed in a preparation environment on 2026-11-17 (§11.8: 878 tests passing there) and verified on the owner's machine on 2026-11-18 (§11.11): install, migrate status, lint, format check, typecheck, 878 tests on Node 24.18.0 and PostgreSQL 17, and a manual walkthrough in real browsers (live editing, read-only and revoked access, collab restart, browser offline, a Phase 4 page, a two-minute idle). One problem was found: two superseded Phase 1 collab test files had not been deleted and broke typecheck until they were. D58–D60 accepted on 2026-11-18. Not done: final Phase 6 acceptance, Docker, GitHub Actions, load and multi-instance tests. Stop after Phase 6 as instructed.** The Phase 5 status follows: **Phase 5 – Yjs CRDT Integration. Implemented, executed in a preparation environment (§10.8: 802 tests, defects fixed) and verified on the owner's machine on 2026-11-16 (§10.9): install, Prisma migrate deploy/status and drift check, lint, format check, typecheck, 802 tests on Node 24.18.0 and PostgreSQL 17, and a real SIGKILL restart check all passed. D57 accepted on 2026-11-16. Phase 5 is a library and database phase: the web editor still uses the interim autosave (D54) and there is no provider, server or browser collaboration until Phase 6. Not done: final Phase 5 acceptance, Docker, GitHub Actions.**

**Current phase:** Phase 4 – Rich-Text Editor. **Implemented on 2026-11-15; owner-verified locally on 2026-11-16 (§9.11); D54–D56 accepted on 2026-11-16; final Phase 4 acceptance is pending.** The Phase 4 task was issued while final Phase 3 acceptance was still pending; as with Phases 2 and 3, that instruction was treated as approval to start. The task conflicted with the approved plan in two places (persistence/autosave and image storage); the owner answered "do what is best for now", the choices were recorded as proposed decisions D54–D56 and the owner approved them on 2026-11-16. The implementation was first built in a preparation environment (lint, typecheck, build and 692 tests passed against PostgreSQL 16 and Redis 7); the owner then ran Prisma `migrate deploy` and the scratch-database drift check, `pnpm check` (692 tests) and a full browser walkthrough locally (§9.11). **Not executed:** Docker (the `apps` profile needs a volume for `ASSET_STORAGE_DIR`), GitHub Actions, S3/MinIO, Playwright.

**Phase 3 status carried forward:** implemented and owner-verified locally on 2026-11-15 (§8.8); D48–D53 accepted; **final Phase 3 acceptance, GitHub Actions CI and the Docker `apps` profile check are still open.** Phase 2: owner-verified locally, CI reported passing, final sign-off never recorded.

**Next step:** the owner records final acceptance of Phase 3 and Phase 4 (and the open Phase 2 sign-off); decides the production storage backend (U7: S3-compatible adapter, MinIO, avatar upload) before deployment; optionally runs the Docker `apps` profile (with a volume for `ASSET_STORAGE_DIR`) and GitHub Actions; then Phase 5 – Yjs CRDT Integration. **(Superseded: Phase 4 was accepted on 2026-11-16, Phase 5 was implemented and verified locally on 2026-11-16, and D57 was accepted. Next: the owner records final Phase 5 acceptance and runs GitHub Actions on the Phase 5 change (new dependencies and lockfile); then Phase 6 – Hocuspocus server and provider, which starts with the `collab → editor` boundary decision, D57 consequence (a).)**

**Next step (2026-11-18, superseded by the paragraph below):** the owner records final acceptance of Phase 6 (and the earlier open sign-offs); decides what happens to the read-only `page_contents` table (D59 leaves dropping it open); runs the Docker `apps` profile (the collab container needs the new collaboration variables, §11.6) and GitHub Actions on the Phase 6 change (the lockfile was regenerated and has not run on a clean runner); then Phase 7 – Presence and Collaborative UI. The two deleted Phase 1 collab test files must be part of the commit (§11.9).

**Next step (2026-11-19, superseded by the paragraph below):** the owner records final acceptance of Phase 7 (and the earlier open sign-offs, Phases 2–6); decides what happens to the read-only `page_contents` table (D59 leaves dropping it open); runs the Docker `apps` profile and GitHub Actions on the Phase 5–7 changes (the lockfile changes have not run on a clean runner); optionally makes the flaky Phase 6 test wait for its counter (§12.11); then Phase 8 – Comments and Version History.

**Next step (current, 2026-11-20):** the owner commits the Phase 8 files (the new migration folder `packages/db/prisma/migrations/20261119120000_comments_versions/` and the corrected `apps/collab/test/versions.int.test.ts` must be part of the commit) and runs the full suite once more (1077 of 1077 expected; the known flaky Phase 6 test may still fail under load); records final acceptance of Phase 8 (and the earlier open sign-offs, Phases 2–7); decides what happens to the read-only `page_contents` table (D59 leaves dropping it open); runs the Docker `apps` profile and GitHub Actions on the Phase 5–8 changes (the lockfile changes have not run on a clean runner); then Phase 9 – Redis Scaling and Performance.

Read `CLAUDE.md` first. This file is the source of truth for current project status.

## 1. Current status

| Area | Current state |

|---|---|

| Repository | pnpm monorepo with `apps/web`, `apps/api`, `apps/collab`, `packages/db`, `packages/shared`, `packages/editor`; root scripts, CI, Dockerfiles and local Compose configuration are present |

| Product features | **Implemented but unverified (Phase 3): workspaces, membership and roles, invitations (link-based), nested pages, soft delete/restore/purge, page-level permissions, activity log, and the web UI for all of these (§8).** **Implemented (Phase 2): registration, login, logout, DB-backed sessions, session list/revoke, password change, profile (display name, presence colour) with web pages.** **Implemented, owner-verified locally 2026-11-16 (Phase 4): single-user rich-text editor (headings, bold/italic/underline, lists, checklists, links, tables, images, alignment, slash commands, toolbar) with interim autosave persistence and image upload (§9).** **Implemented, owner-verified locally 2026-11-18 (Phase 6): real-time collaborative editing through the Hocuspocus server (live sync, read-only roles, revocation, reconnection); the interim autosave is removed (§11).** **Implemented, owner-verified locally 2026-11-19 (Phase 7): presence — avatar stack, online list, collaborator carets and selections, join/leave notices; nothing is stored (§12).** **Implemented, owner-verified locally 2026-11-20 (Phase 8): anchored comment threads (replies, resolve, reopen, delete, live highlights, detached display), manual and automatic version snapshots, read-only version view, and restore with a PRE_RESTORE snapshot (§13).** Not implemented: comment editing, notifications, avatar upload (still open from Phase 4), email verification, password reset |

| API | Fastify foundation, `/health` and `/ready`, (Phase 2) `AUTH-01`–`AUTH-07`, `USER-01`–`USER-02`, and (Phase 3, unverified) `WS-01`–`WS-09`, `INV-01`–`INV-07`, `PAGE-01`–`PAGE-09`, `PP-01`–`PP-03`, `ACT-01`–`ACT-02` and, (Phase 4, owner-verified locally) `ASSET-01`–`ASSET-04` (the interim `CONTENT-01`–`CONTENT-02` were removed in Phase 6, D59) and, Phase 6, `PAGE-10` under `/api/v1`, with CSRF checks, rate limiting, helmet, CORS, session cleanup job |

| Collaboration server | **Phase 6 (2026-11-17; executed in a preparation environment, owner-verified locally 2026-11-18, §11.11):** Hocuspocus server with collaboration-token verification, database-derived roles, read-only enforcement, access events and periodic revalidation, store retry, graceful shutdown and limits; the web editor is connected to it. Single instance. **Phase 7 (2026-11-18; owner-verified locally 2026-11-19, §12.11):** presence — the server stamps the relayed identity, binds one awareness client id to each connection, keeps only a validated cursor, rate-limits awareness and never stores it (D61). Before Phase 6 it was a shell that rejected every connection (D38). **Phase 8 (2026-11-19; owner-verified locally 2026-11-20, §13.11):** `version.create` and `version.restore` commands, automatic snapshots, restore behind a PostgreSQL barrier with an in-process write gate (D62), and a Redis page-event listener |

| Database | Prisma 7.10.1; baseline migration, `20261112120000_auth_users_sessions` (`User`, `Session`) and, `20261114090000_workspaces_pages_permissions` (Phase 3 models, hand-written SQL incl. the deferred one-owner trigger). **Phase 4 adds `20261115120000_editor_content_assets` (`page_contents` — interim — and `assets`, hand-written SQL; §9); the owner's `migrate deploy`, `migrate status` and scratch-database drift check were clean on 2026-11-16 (§9.11).** That migration is hand-written SQL. The owner's local `migrate deploy`, `migrate status` and scratch-database `migrate:dev` drift check were clean on 2026-11-13 (§7.9). **Phase 5 adds `20261116120000_yjs_document_store` (`document_states`, `document_updates`; hand-written SQL; §10); the owner's `migrate deploy`, `migrate status` and scratch-database drift check were clean on 2026-11-16 (§10.9).** The web app still persists content only through the interim `page_contents` table (D54); the Yjs `DocumentStore` exists and is tested but nothing in the apps calls it until Phase 6 **(superseded by Phase 6, D59: the collab server now stores documents through the `DocumentStore`, the HTTP autosave is gone and `page_contents` is a read-only seed source)** **Phase 8 adds `20261119120000_comments_versions` (`document_snapshots`, `comment_threads`, `comments`, restore-barrier columns on `document_states`; hand-written SQL; §13); the owner's `migrate deploy`, `migrate status` and scratch-database drift check were clean on 2026-11-20 (§13.11).** |

| Local infrastructure | PostgreSQL 17 and Redis 7 Compose services reported healthy. PostgreSQL host port 5433 maps to container port 5432; Redis host port 6379 |

| Phase 1a verification | Owner reports `pnpm check` passed, 59 tests passed (47 unit + 12 integration), migrations deployed and up to date, Docker Compose PostgreSQL/Redis healthy, GitHub Actions CI passed, and the web shell was checked in a browser |

| Docker app images | **Verified by owner on 2026-11-13:** API, web, collab and migration images built successfully; Compose `apps` profile started all application services; migration container exited 0 with no pending migrations; API `/ready` returned HTTP 200 with PostgreSQL and Redis healthy |

| Phase 1b spike | Harness and report at `spikes/collab-poc/` and `docs/spikes/phase-1-collab-spike.md`; S1–S11 executed, 11/11 PASS. Root `pnpm check` passed; remaining evidence reconciliation and owner review are in progress |

| Phase 2 | Implemented and owner-verified locally. Lint, format check and typecheck passed; 228 tests passed with `--testTimeout=20000`; migration deploy/status and scratch-database drift check passed; browser acceptance checks completed; current-session indicator fixed; Docker app images built and services started; API `/ready` returned HTTP 200 with PostgreSQL and Redis healthy. D41–D47 accepted. GitHub Actions CI for Phase 2 passed (owner-reported; initially deferred). **Final owner sign-off pending.** |
| Phase 3 | **Implemented 2026-11-14; owner-verified locally 2026-11-15.** Schema validates, client generates, migration deploys and the scratch-database drift check is clean; lint, format check and typecheck pass; `pnpm check` passes with 482 tests (permission matrix 133/133); manual browser walkthrough passed. D48–D53 accepted 2026-11-15. **Not yet done:** final owner acceptance, GitHub Actions CI, Docker `apps` profile check. See §8.8. |
| Phase 4 | **Implemented 2026-11-15 under the owner's "do what is best for now"; owner-verified locally 2026-11-16.** Migration deploy/status and the scratch-database drift check pass; lint, format check and typecheck pass; 692 tests pass (38 files, with `--testTimeout=20000`); full browser walkthrough passed. D54–D56 accepted 2026-11-16. **Not done:** final owner acceptance, Docker, CI, S3/MinIO storage, avatar upload, automated E2E. See §9 and §9.11. |

| Phase 6 | **Implemented 2026-11-17; owner-verified locally 2026-11-18.** `pnpm install`, `migrate status`, lint, format check and typecheck pass (typecheck only after deleting the two superseded Phase 1 collab test files); 878 tests pass (49 files, `--testTimeout=30000`); manual real-browser walkthrough passed (live editing between two browsers, Viewer and removal while a page is open, collab restart, browser offline, a Phase 4 page, two-minute idle). D58–D60 accepted 2026-11-18. **Not done:** final owner acceptance, Docker, CI, load and multi-instance tests, automated browser E2E. **Not reported:** a third browser, inspection of the collab log, the revocation delay in seconds. See §11 and §11.11. |

| Phase 7 | **Implemented 2026-11-18; owner-verified locally 2026-11-19.** `pnpm install`, `pnpm build:packages`, lint, format check and typecheck pass; the full test run reached 55 files and 965 of 966 tests (`--testTimeout=30000`, 257.73 s), the single failure being a Phase 6 persistence test in `apps/collab/test/sync.int.test.ts` that is flaky under load (passed 4 of 4 times alone); API, collab and web started and login worked; the owner checklist (§12.7 items 2–7) was checked in real browsers and reported working. D61 accepted 2026-11-19. **Not done:** final owner acceptance, Docker, CI, long idle runs, automated browser E2E. See §12 and §12.11. |

| Phase 8 | **Implemented 2026-11-19; owner-verified locally 2026-11-20.** `migrate deploy`, `migrate status` and the scratch-database drift check are clean; build, lint, format check and typecheck pass; the full test run reached 61 files and 1076 of 1077 tests (`--testTimeout=30000`, 265.11 s), the single failure being a test-ordering bug in `apps/collab/test/versions.int.test.ts` (it failed every time, alone as well); the test was corrected and the file passes 27 of 27, the full suite was not rerun; the owner checklist (§13.7) was checked in two real browsers and reported working. D62 and D63 accepted 2026-11-20. **Not done:** a full-suite rerun after the fix, final owner acceptance, Docker, CI, two collab instances in real browsers (Phase 9), automated browser E2E. See §13 and §13.11. |

### Decisions and open items

- **D33:** Owner selected Phase 1b before Phase 2. D33 is recorded as accepted.

- **U1 / D16:** Node.js 24 was explicitly approved by the project owner on 2026-11-12. The spike and root checks used Node.js 24.18.0.

- **U2 / D17:** TypeScript 5.9.3 was explicitly approved by the project owner on 2026-11-12.

- **U3 / U4:** Empirical evidence is available from S1–S7. These questions are only partially resolved: store-on-unload, direct concurrent row-lock behaviour, stale awareness after a Hocuspocus instance crash and awareness expiry values remain unverified.

- **U5 / V8:** Resolved by Phase 1a evidence: Prisma client generation, real database connectivity, successful `migrate deploy`, and `migrate status` reporting up to date.

- **U7 / D37 / D55:** (U7 remains partially resolved.) Object storage/MinIO was omitted from Phase 1 Compose. Phase 4 decided the upload flow, allowed types and size limit and implemented them behind a storage adapter with a **local-disk** backend (D55, accepted 2026-11-16); the S3-compatible adapter, MinIO in Compose, MinIO's licensing check and avatar upload remain open.
- **D54–D56 (Phase 4):** proposed on 2026-11-15; **accepted by the owner on 2026-11-16.** D54 is an interim second source of truth for page content that Phase 6 removes.
- **D58–D60 (Phase 6):** proposed on 2026-11-17; **accepted by the owner on 2026-11-18** (§11.11). Open after D59: whether and when to drop the read-only `page_contents` table (needs a migration and an owner decision).
- **D61 (Phase 7):** proposed on 2026-11-18; **accepted by the owner on 2026-11-19** (§12.11). It deliberately deviates from WEBSOCKET_PROTOCOL §6: names and colours are stamped by the server, not resolved from REST.

- **D62 and D63 (Phase 8):** proposed on 2026-11-19; **accepted by the owner on 2026-11-20** (§13.11). They resolve U8 (detached threads) and U11 for snapshots; activity-log pruning remains open for Phase 10.

- **U13:** Explicit production recovery after Redis Pub/Sub message loss remains a Phase 9 decision. Redis reconnection alone is not proof of reconvergence.

- **Phase 2 items:** D41–D47 were explicitly accepted by the owner on 2026-11-13 (see DECISIONS.md). V7 is resolved by measurement (Next.js does not set `X-Forwarded-For`; production needs an outer reverse proxy, D43). The actual production hosting target and proxy deployment remain open under U10; D43 approves the trusted-address-list design, not a specific hosting provider.
- **D34–D40:** Their individual statuses remain as recorded in DECISIONS.md; do not infer blanket owner approval from implementation or test evidence.

The uploaded ZIP does not include `.git`, so it cannot independently establish the current branch or commit. The owner previously reported that commit `ba82d24` (`feat: Phase 1 project setup and infrastructure`) was pushed to `origin/main`.

## 2. Phase 0 record (historical)

### 2.1 Phase 0 work completed

| Deliverable | File | Notes |

|---|---|---|

| Permanent instructions | `CLAUDE.md` | Rules for every future chat |

| Project description | `README.md` | Planned design only; no implemented features claimed |

| Project master | `docs/PROJECT_MASTER.md` | 62 functional requirements, NFRs, PERF metric definitions, permission matrix, stack with verified candidate versions |

| Architecture | `docs/ARCHITECTURE.md` | Components, module boundaries, Yjs lifecycle, persistence design, guarantees G1–G7, failure modes, 3 Mermaid diagrams |

| Database | `docs/DATABASE_SCHEMA.md` | Complete Prisma design (17 models), SQL constraints, cascades, persistence/recovery detail, ER diagram |

| REST API | `docs/API_CONTRACTS.md` | 53 endpoints with auth, authz, requests, responses, validation and errors; envelope and error codes |

| WebSocket | `docs/WEBSOCKET_PROTOCOL.md` | Connection, auth, sync, awareness, application messages, restore procedure, reconnection, cross-instance behaviour |

| Decisions | `docs/DECISIONS.md` | 32 decisions with permanent IDs, 12 unresolved items |

| Roadmap | `docs/IMPLEMENTATION_PLAN.md` | Phases 0–11 with 111 numbered acceptance criteria |

| Testing | `docs/TESTING.md` | Categories, guarantee verification, metric measurement methods, traceability |

| Deployment | `docs/DEPLOYMENT.md` | Provider-neutral topology, configuration, operations, runbooks |

| Handover | `docs/HANDOVER.md` | This file |

Research performed (2026-11-11): Hocuspocus, y-websocket and y-redis documentation; Tiptap collaboration docs; Prisma requirements and supported databases; Node.js lifecycle; npm registry engine and peer-dependency metadata for the planned packages.

### 2.2 Key architectural conclusions

1. **y-websocket + Redis is not a scalable architecture** by itself; the reference server is in-memory and its README says it cannot be scaled easily. **Hocuspocus + its Redis extension** is the approved choice (D1, D2). The Redis extension does not persist data and every instance handles every message, so it adds availability and connection capacity, not per-document CPU capacity.

2. **Persistence design (D15):** append-only diff updates, compacted state, immutable snapshots; all writes per page under a row lock; PostgreSQL is the only durable store (D14). Guarantees are limited to **G1–G7**; zero data loss is never claimed. Redis Pub/Sub misses are not replayed; an explicit Phase 9 recovery path is required before live reconvergence can be claimed.

3. **Package findings:** Prisma CLI `latest` is an 8.x release candidate while the client is 7.10.1 → both pinned to 7.10.1 (D18); Hocuspocus Redis extension depends on ioredis 5.6 → pinned 5.6.x (D19); Tiptap 3 Collaboration needs `@tiptap/y-tiptap` (D20); TypeScript `latest` is 7.x but the toolchain was not verified against it → 5.9.3 (D17); Node 24 is already in Maintenance LTS and Node 26 is only weeks into LTS → Node 24 proposed (D16, U1).

4. **Design choices made during Phase 0 that go beyond your explicit approvals** (all Proposed; please review): collaboration JWT signed with EdDSA so collab holds public keys only (D22); permission resolution rules and Admin limits (D23); soft delete with 30-day purge (D24); version create/restore as WebSocket commands, list/read as REST (D32); awareness identity binding; no workspace-level realtime channel in the MVP (D32); link-based invitations with the token in the URL fragment (D30).

### 2.3 Decisions needing owner sign-off (Phase 0 historical snapshot)

This is the Phase 0 owner-review snapshot and is retained for history. D16 and D17 were subsequently approved by the owner on 2026-11-12; current statuses are recorded in DECISIONS.md. Other entries retain their individual statuses there.

| ID | Decision | Where it matters |

|---|---|---|

| D15 | Yjs persistence model (diff append + compaction + snapshots) | Phases 5–6 |

| D16 | Node.js 24 LTS | Phase 1 |

| D17 | TypeScript 5.9.x | Phase 1 |

| D18 | Prisma 7.10.x (no 8 RC) | Phase 1 |

| D19 | ioredis 5.6.x | Phases 2, 6 |

| D20 | Tiptap 3.x + Yjs 13.x + `@tiptap/y-tiptap` | Phases 4–5 |

| D21 | Collab server accesses PostgreSQL directly | Phase 6 |

| D22 | Collaboration JWT format, revalidation, revocation | Phase 6 |

| D23 | Roles and effective-permission resolution | Phase 3 |

| D24 | Soft delete for pages | Phase 3 |

| D25 | API security baseline | Phase 2 |

| D26 | Testing toolchain | Phase 1 |

| D27 | Next.js 16, React 19, Tailwind 4 | Phase 1 |

| D29 | UUID identifiers | Phase 2 |

| D30 | Invitation token handling | Phase 3 |

| D31 | API versioning and envelope | Phase 2 |

| D32 | Application-level realtime events (stateless messages) | Phases 6, 8 |

### 2.4 Unresolved decisions (Phase 0 historical snapshot; current status is in DECISIONS.md)

| ID | Question | Needed by |

|---|---|---|

| U1 | Node.js 24 or 26 | Resolved in Phase 1b; owner approved Node.js 24 on 2026-11-12 |

| U2 | TypeScript 5.9.3 or newer | Resolved in Phase 1b; owner approved TypeScript 5.9.3 on 2026-11-12 |

| U3 | Hocuspocus store-hook/Redis persistence behaviour | Phase 1 spike |

| U4 | Awareness semantics across instances and from read-only connections | Phase 1 spike |

| U5 | Prisma 7 monorepo setup details | Resolved in Phase 1a; see DECISIONS.md |

| U6 | Invitation email provider (link-based invitations ship first) | Phase 3 / Phase 11 |

| U7 | Image upload flow, limits, MinIO status | Phase 4 |

| U8 – resolved (D63, accepted 2026-11-20) | Comment anchors after version restore: threads are kept and marked detached | Phase 8 |

| U9 | External guests (recommendation: out of scope) | Phase 3 |

| U10 | Production hosting target | Phase 11 |

| U11 – resolved for snapshots (D63, accepted 2026-11-20); activity-log pruning open for Phase 10 | Retention for AUTO snapshots and activity logs | Phase 8 / 10 |

| U12 | Repository license and visibility | Before publishing |

| U13 | Explicit Phase 9 recovery mechanism for Redis Pub/Sub message loss | Phase 9 |

Full options and recommendations are in `docs/DECISIONS.md`.

### 2.5 Unverified assumptions (V1–V14)

Tracked in `docs/ARCHITECTURE.md` §18. The Phase 1b spike has supplied evidence for several assumptions, but not all are fully resolved. V2, V5 and V12 passed at spike level; V1 and V3 are partial; V4 showed that Redis restart alone does not reconverge already-open documents; V6 fresh-token acquisition on an actual reconnect remains unverified; V11 was inspected at capability/declaration level only; V13 remains open; V14 is partial because forged identity was rejected but name/color tampering was not tested. See `docs/spikes/phase-1-collab-spike.md` and reconcile §18 to retain these evidence levels. V7 (Next.js rewrite forwarding) is Phase 2; V8 (Prisma monorepo setup) was resolved in Phase 1a; V9 (Yjs binding package) is Phase 5; V10 (server-side restore transaction) is Phase 8.

### 2.6 Documentation corrections prepared in Phase 0

The following design defects were corrected in the Phase 0 document set. These are documentation changes only; no implementation or tests have been run.

1. **Redis outage:** G5 no longer promises automatic reconvergence after Redis returns. Redis Pub/Sub message loss is explicit; Phase 9 must implement and test stale-document detection and resynchronization. Added U13.

2. **Workspace owner invariant:** clarified that the partial unique index enforces at most one owner only. A deferred PostgreSQL constraint trigger is required to enforce at least one owner at commit; create/transfer must be atomic.

3. **Readiness:** API liveness/readiness, PostgreSQL health and Redis degraded status are separate. Redis alone does not make the API unready; Redis-dependent operations have explicit scoped failure/fallback rules.

4. **Page tree concurrency:** structural mutations serialize on a workspace-scoped transaction lock; a composite `(workspaceId,parentId)` foreign key prevents cross-workspace parent links; race tests cover cycles and concurrent moves.

5. **Version restore:** Phase 8 requires a durable cross-instance restore barrier, draining/committing pre-barrier updates, PRE_RESTORE snapshot before applying restore, atomic failure behaviour and client resynchronization.

### 2.7 Consistency review (performed at the end of Phase 0)

**Previous checks run before the corrections below; rerun after merging the corrected documents.**

| Check | Result |

|---|---|

| Every referenced ID is defined | Previously checked; rerun after corrections |

| Decision index matches decision bodies (D1–D32); unresolved register includes U13 | Pending rerun after corrections |

| Acceptance criteria ids unique (111) | Previously checked; rerun after corrections |

| Cross-document and intra-document section references resolve | Previously checked; rerun after corrections |

| Key values consistent across documents | Previously checked; rerun after corrections |

| Every one of 53 endpoints and 62 functional requirements is covered by a phase in the plan | Pass |

| Mermaid diagrams parse with Mermaid 11 | Previously checked; rerun after corrections |

**Defects found and fixed during the review**

1. `ARCHITECTURE.md` was missing the two sequence diagrams I had described in the first delivery batch; they were added (§11.1, §11.2) and validated.

2. `DECISIONS.md` D15 described `DocumentState` as holding "its state vector"; corrected to the persisted-vector definition used in the schema and architecture.

3. After the schema/API batch: Admin role-management limits added to the permission matrix and D23; D32 extended with client-to-server commands; `DocumentState` wording, image URL form, version create/restore path and V12–V14 added to the architecture; FR-AUTH-05 phase annotation (avatar in Phase 4); U11 and U12 added; D27 referenced in the stack table.

**Limits of this review (what it does not prove)**

- The checks verify references, numbers and syntax. They do not prove the design is correct; the Phase 1 spike and later tests do.

- Mermaid validation checks syntax parsing, not visual rendering.

- Package versions come from registry metadata (engines/peer dependencies) read on 2026-11-11; nothing was installed or run together.

- Several documentation URLs are listed as "not fetched during Phase 0" in the references.

- Node.js lifecycle dates came from third-party aggregators of the official schedule; confirm on nodejs.org when deciding U1.

- No effort or time estimates were produced; the roadmap's achievability was checked structurally (acyclic dependencies, full coverage of requirements and endpoints, spike before dependent work), not by schedule.

**Known soft spots to be aware of**

- Environment variable and Hocuspocus option names are provisional (confirmed in Phases 1 and 6).

- `@tiptap/y-tiptap` is given as a range requirement; its exact pin is chosen in Phase 1.

- The Prisma schema's generator/datasource configuration is a placeholder until U5.

- Access-event handling for page moves that change inherited access falls back to full revalidation; the precise recomputation strategy is a Phase 6 detail.

- `PAGE-02` returns the whole accessible tree unpaginated; revisit with Phase 9 measurements.

- CI provider (GitHub Actions) and GitHub hosting are assumptions.

## 3. Phase 1a – implementation and verification record

### 3.1 Implemented foundation

- **Monorepo/tooling:** pnpm 12.18.0 workspace; Node 24 engine and `.nvmrc`; strict TypeScript with `noUncheckedIndexedAccess`; ESLint module-boundary rules; Prettier; Vitest unit/integration projects; exact pins.

- **Web:** Next.js 16.4.6, React 19.3.1, Tailwind 4.3.5 starter shell, `/health`, startup environment validation.

- **API:** Fastify 5.12.8 shell, structured/redacted logging, request IDs, standard error handling, `/health` and `/ready`, graceful shutdown.

- **Collab:** Hocuspocus 4.8.0 shell, `/health` and `/ready`, graceful shutdown. `onConnect` rejects every document connection intentionally (D38).

- **Database:** Prisma 7.10.1, `@prisma/adapter-pg`, `prisma-client` generator output under `packages/db/src/generated/prisma`, `prisma.config.ts`, and an empty baseline migration (`SELECT 1;`). No application models yet.

- **Shared/editor:** shared Zod environment schemas, error/envelope/health/logging utilities; editor package is an empty entry point.

- **Infrastructure/CI:** Docker Compose for PostgreSQL 17 and Redis 7; optional app Docker profile; GitHub Actions workflow; `.env.example`; bootstrap script.

### 3.2 Phase 1a acceptance criteria

Results below are based on the owner's reports in chat dated 2026-11-12. This review did not independently rerun the commands.

| Criterion | Status | Evidence / qualification |

|---|---|---|

| AC-1.1 – frozen-lockfile install | **Pass (owner-reported)** | `pnpm install --frozen-lockfile`; CI also passed |

| AC-1.2 – lint, typecheck and tests | **Pass (owner-reported)** | `pnpm check` passed |

| AC-1.3 – module boundaries | **Pass (repository evidence + reported test run)** | `tests/boundaries.test.ts` contains 13 deliberate forbidden-import cases and 4 allowed-import cases |

| AC-1.4 – local infrastructure | **Pass with D37 scope adjustment (owner-reported)** | PostgreSQL and Redis Compose services reported healthy. Object storage is not required in Phase 1; D37 defers MinIO |

| AC-1.5 – service shells/readiness | **Pass (owner-reported)** | API/collab/web shells and readiness behaviour covered by the current unit/integration tests |

| AC-1.6 – pins and runtime declarations | **Pass for Phase 1 packages (owner-reported)** | Root and workspace package manifests, `.nvmrc`, and `pnpm-lock.yaml` are present. Future-phase dependencies remain to be verified when added |

| AC-1.7 – Prisma setup and migration | **Pass (owner-reported)** | `pnpm db:migrate:deploy` succeeded; `pnpm db:migrate:status` reported up to date. U5/V8 resolved |

| AC-1.8 – S1–S11 collaboration spike | **Pass (11/11)** | All eleven manual scenarios passed. Evidence, environment, observations and limitations are recorded in docs/spikes/phase-1-collab-spike.md. |

| AC-1.9 – spike findings for U3/U4/V1–V6/V11–V14 | **Partly complete** | S1–S11 provide empirical evidence. S4/S5 persistence and Redis-originated update behaviour, S2/S3 awareness propagation and read-only awareness, S7 outage behaviour, S8 token verification, S9 stateless messages and S10 forged awareness identity rejection passed. Store-on-unload, direct concurrent row-lock behaviour, stale awareness after server crash, actual fresh-token reconnect, provider close-code behaviour and production limit enforcement remain unverified or deferred. |

| AC-1.10 – architecture implications and U1/U2/U5 | **Partly complete** | U1 (Node.js 24) and U2 (TypeScript 5.9.3) were explicitly approved by the owner on 2026-11-12; U5/V8 were already resolved. Remaining spike implications must be reconciled in ARCHITECTURE.md, WEBSOCKET_PROTOCOL.md, IMPLEMENTATION_PLAN.md and DECISIONS.md. |

| AC-1.11 – spike cleanup and no production collaboration code | **Pass at repository-boundary level** | Spike remains isolated under spikes/collab-poc/. Root pnpm check passed after the changes; root lint/format/build/typecheck/test workflows completed with the spike excluded. Git status showed only documentation, root tooling configuration and isolated spike paths. No production collaboration feature, production Prisma model or production migration was added. Retain the spike as evidence pending owner review. |

### 3.3 Test and CI evidence

| Check | Owner-reported result |

|---|---|

| Test suite | 9 test files; 59 tests passed (47 unit, 12 integration) |

| Root checks | Pass (owner-executed, 2026-11-12): `pnpm check` passed after Phase 1b changes, including ESLint, Prettier check, package builds, TypeScript checks and Vitest; 9 test files and 59 tests passed. |

| Database | Baseline migration deploy succeeded; migration status up to date |

| Local services | PostgreSQL and Redis Compose containers reported healthy |

| CI | GitHub Actions run passed |

| Browser smoke check | Web starter shell was opened and checked in a browser |

| Docker app-image build | Not confirmed; do not mark as passed |

The integration tests use real PostgreSQL and Redis. The test files in the uploaded snapshot include `tests/boundaries.test.ts`, `tests/startup*.test.ts`, `apps/api/test/*`, `apps/collab/test/*`, `packages/db/test/*`, and `packages/shared/src/shared.test.ts`.

### 3.4 Repository audit findings relevant to Phase 1b

- The initial uploaded repository ZIP had no spike source or results report. The current working copy now contains the isolated harness and completed evidence report; S1–S11 have since been executed (11/11 PASS).

- `apps/collab` is only a shell: the Hocuspocus `onConnect` hook rejects every document connection. Do not build Phase 1b experiments inside this production shell.

- `packages/db/prisma/schema.prisma` has no models. The baseline migration contains only `SELECT 1;`. The spike must use a disposable schema/database and must not add spike tables to the production Prisma migration history.

- The current Compose mapping is PostgreSQL host `5433` → container `5432`; `.env.example` must use `localhost:5433` for host-run apps. The documentation correction package updates this value.

- Redis is Pub/Sub, not durable. Missed messages are not replayed after reconnect; the spike must not describe Redis restart alone as a successful recovery.

- MinIO/object storage is not in the Phase 1 Compose file by design (D37).

### 3.5 Phase 1b scope and guardrails

Phase 1b is a **disposable, manual-scripted collaboration spike** under `spikes/collab-poc/`, outside the workspace build and not imported by any package. It must not add production collaboration features, real authentication, production migrations or production persistence.

The executed isolated spike used two Hocuspocus instances on ports `4201` and `4202`, isolated Redis on host port `6380`, and the throwaway PostgreSQL database `conote_collab_poc`. It did not use the production collaboration server on port `4100` or root Redis on port `6379`. S1–S11 results and limitations are recorded in `docs/spikes/phase-1-collab-spike.md`.

Important scope boundaries:

- The spike provides evidence for U3/U4 and V1–V5, V12–V14, but some behaviours remain partial or unverified as listed in the execution report.

- V6 (fresh token acquisition on reconnect) may be inspected at library-capability level in the spike, but production token refresh belongs to Phase 6.

- V11 message/connection limits may be inspected for available Hocuspocus mechanisms; production enforcement and tuning belong to Phases 6/9.

- V14 was prototyped: forged awareness identity was rejected. Name/color tampering was not tested; production presence identity enforcement belongs to Phase 7.

- U13 production recovery design is decided and load/recovery-verified in Phase 9. The spike can test candidate resynchronization feasibility but cannot close the production requirement.
- S7 result: Redis restart alone did not reconverge already-open documents; both Hocuspocus instances had to restart and rehydrate from PostgreSQL. Do not describe Redis reconnect alone as successful recovery. U13 remains a Phase 9 production requirement.

- Do not use `docker compose down -v`; it deletes the local PostgreSQL volume.

## 4. Next steps – Phase 1b documentation review and closure

The owner selected Phase 1b before Phase 2. The isolated spike has now been executed, with S1–S11 all passing (11/11). The next task is to reconcile the evidence across `docs/spikes/phase-1-collab-spike.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `WEBSOCKET_PROTOCOL.md`, `IMPLEMENTATION_PLAN.md`, `TESTING.md` and this handover. Do not start Phase 2 until the owner has reviewed the evidence and explicitly approved Phase 1 closure.

The following limitations must remain explicit during review:

1. U3/U4 are only partially resolved by the spike. Store-on-unload, direct concurrent row-lock behaviour, stale awareness after a Hocuspocus instance crash and awareness expiry values remain unverified.

2. S7 showed that Redis restart alone does not automatically reconcile existing documents (`autoConverged=false`). Both Hocuspocus instances had to restart and rehydrate from PostgreSQL before the documents converged. U13 remains a Phase 9 production recovery requirement.

3. V6 fresh-token acquisition on an actual reconnect remains unverified; production token refresh belongs to Phase 6.

4. V11 capability inspection does not establish production abuse protection or effective limit enforcement; production enforcement and tuning belong to later phases.

5. V13 provider close-code/reason behaviour remains unverified. V14 is partial: forged awareness identity was rejected, but name/color tampering was not tested.

6. Keep Phase 2 blocked until the owner reviews the reconciled documentation and explicitly approves Phase 1 closure and Phase 2.

The next owner review should verify that the spike findings have been reconciled in the linked documents and that no remaining statement describes the spike as pending. Phase 2 remains blocked until explicit approval.

## 5. Phase 1b preparation record (2026-11-12)

The owner supplied `Conote_Phase_1b.zip`. Work was performed on an extracted copy because the archive does not include `.git`; branch, commit and working-tree cleanliness therefore cannot be independently verified from this snapshot.

### Files prepared

- `spikes/collab-poc/src/server.ts`: two-instance Hocuspocus prototype, throwaway EdDSA authentication, read-only context, awareness identity filtering, stateless echo and PostgreSQL diff/compaction prototype.

- `spikes/collab-poc/src/run.ts`: manual scenario runner for S1–S11, including two server processes and the isolated Redis outage experiment.

- `spikes/collab-poc/src/check-environment.ts`: safety preflight for the throwaway database and isolated Redis.

- `spikes/collab-poc/run-phase1b.sh`: one-command local install, preflight, typecheck, build and S1–S11 runner.

- `spikes/collab-poc/README.md`: setup, execution and safety instructions.

- `docs/spikes/phase-1-collab-spike.md`: initially prepared as an evidence report scaffold with scenarios marked not executed; subsequently populated with the S1–S11 execution results.

- `DECISIONS.md`, `ARCHITECTURE.md`, `WEBSOCKET_PROTOCOL.md`, `IMPLEMENTATION_PLAN.md`, and `TESTING.md`: updated to distinguish source/API inspection from empirical verification.

- Root ESLint and Prettier ignore rules exclude the separate spike directory from root project checks; the spike retains its own typecheck/build scripts.

### Preparation-environment verification (historical; not the final execution environment)

- Archive extraction and project structure inspection succeeded.

- TypeScript syntax transpilation succeeded for the three spike `.ts` files using global TypeScript 5.8.3.

- At preparation time, full typecheck, package build, dependency installation and live S1–S11 execution were not run in that extracted work environment, which had Node 22.16.0, TypeScript 5.8.3, no pnpm and no Docker. The owner subsequently executed the spike and root checks locally; see the execution record below.

- No production collaboration code, Prisma model or production migration was added.

- The spike runner refuses to use any database except `conote_collab_poc` and Redis port other than `6380`. It does not run destructive database or volume cleanup.

### Phase 1b execution and verification (2026-11-12)

The owner executed the isolated spike locally using Node.js 24.18.0 and TypeScript 5.9.3. S1–S11 all passed (11/11 PASS).

Root pnpm check passed after the Phase 1b changes: ESLint, Prettier, package builds, TypeScript checks and Vitest. The root test suite passed 9 test files and 59 tests.

U1 was explicitly approved by the project owner: Node.js 24. U2 was explicitly approved by the project owner: TypeScript 5.9.3 (both approvals on 2026-11-12).

S7 observation: Redis restart alone did not automatically converge the already-open documents (autoConverged=false). After both Hocuspocus servers restarted and rehydrated from PostgreSQL, the documents converged. The Redis outage produced ECONNREFUSED 127.0.0.1:6380 warnings. This is evidence that production requires an explicit recovery mechanism; U13 remains a Phase 9 requirement.

No production collaboration feature, production Prisma model or production migration was added. Git status after the checks showed only the expected documentation, root tooling configuration and isolated spike paths.

The full scenario evidence and remaining limitations are recorded in docs/spikes/phase-1-collab-spike.md. AC-1.8 is met at spike level; AC-1.9 and AC-1.10 remain partly complete pending documentation reconciliation and the explicitly listed unverified behaviours. AC-1.11 is met at repository-boundary level. Phase 1 closure and Phase 2 remain subject to explicit owner approval.

## 6. Change log

| Date | Change |

|---|---|

| 2026-11-11 | Phase 0 documentation created and initial design consistency review performed. |

| 2026-11-11 | Corrected Redis outage/recovery, owner invariant, readiness, page-tree concurrency and version-restore design. |

| 2026-11-12 | Phase 1a infrastructure implemented and owner-reported checks/CI/migrations passed; Phase 1b selected by owner before Phase 2. |

| 2026-11-12 | Documentation status reconciled with the repository snapshot and owner-reported verification; Phase 1b scope boundaries clarified. |

| 2026-11-12 | Phase 1b harness and report scaffold prepared; no S1–S11 results claimed at preparation time. |
| 2026-11-12 | Phase 1b S1–S11 executed (11/11 PASS); root pnpm check passed (9 test files, 59 tests); U1/U2 explicitly owner-approved; handover updated for evidence-based review. |
| 2026-11-13 | Phase 2 (authentication and user management) implemented and tested in a preparation environment; docs updated; decisions D41–D47 proposed; V7 resolved by measurement. Awaiting owner verification (§7). |
| 2026-11-14 | Phase 3 (workspaces, pages, permissions) implemented in a preparation environment that could not run the test suite; docs updated; decisions D48–D53 proposed; stale `apps/web/src/app/page.tsx` removed again. Awaiting owner verification (§8). |
| 2026-11-15 | Owner verification of Phase 3 completed locally (§8.8): migration/drift check, lint/format/typecheck, `pnpm check` (482 tests) and manual browser acceptance passed. Fixes made during verification: restored missing `packages/shared` files; seven `react-hooks/set-state-in-effect` lint errors in the web app; matrix test override target; boundaries test timeout. D48–D53 accepted by the owner the same day; Phase 3 final acceptance pending. |
| 2026-11-15 | Owner reports that the Phase 2 GitHub Actions CI run, previously deferred, was run and passed. The run's date and commit are not recorded here. |
| 2026-11-13 | Owner verification of Phase 2 completed locally: migrations/drift check, lint/format/typecheck, 228 tests (20 s timeout), manual browser acceptance, Docker app images/startup and API readiness passed; current-session indicator fixed. D41–D47 accepted. Phase 2 GitHub Actions CI explicitly deferred/not run at that time (later run and passed, see the 2026-11-15 entry below); final sign-off pending (§7.9). |
| 2026-11-15 | Phase 4 (rich-text editor) implemented and tested in a preparation environment with PostgreSQL 16/Redis 7 (692 tests passed); interim content persistence and local-disk image storage chosen under the owner's "do what is best for now" (D54–D56 proposed). Migration drift check, browser, Docker and CI not run. Awaiting owner verification (§9). |
| 2026-11-16 | Owner verification of Phase 4 completed locally (§9.11): `migrate deploy`/`status` and scratch-database drift check passed; lint, format and typecheck passed; 692 tests passed with `--testTimeout=20000`; browser walkthrough passed. Fixes during verification: Tiptap dependencies added to `packages/editor/package.json` and `apps/web/package.json` (missing from the delivered tree) and the lockfile updated; the editor tsconfig change from the delivery was applied. D54–D56 accepted. |

## 7. Phase 2 – implementation and verification record (2026-11-13)

### 7.1 What was implemented

| Area | Implementation |
|---|---|
| `packages/shared` | `auth.ts`: Zod request/response schemas (strict objects, normalization, password 12–128), cookie-name helper, access-event channel/type, presence-colour palette. `env.ts`: `TRUST_PROXY` (address list), `SESSION_IDLE_TTL_DAYS`, `SESSION_ABSOLUTE_TTL_DAYS` |
| `packages/db` | `User` and `Session` models; migration `20261112120000_auth_users_sessions` with the `users` check constraints and a token-hash format check; `isUniqueConstraintError`, `isDatabaseUnavailableError`; readiness now requires every shipped migration (D41) |
| `apps/api` | Argon2id hashing; `SessionService` (hashed tokens, idle/absolute expiry, throttled sliding refresh, injected clock); `requireAuth` guard (`preValidation`, D44); routes `AUTH-01`–`AUTH-07`, `USER-01`–`USER-02`; helmet, CORS allow-list, cookie handling, Origin/Content-Type check, `no-store`; Redis rate limiting (fail closed); Zod validation and response serialization; error mapping (validation details, 503 for PostgreSQL/Redis outages); `session.revoked` event publishing; hourly session cleanup job |
| `apps/web` | `/api/*` rewrite to the API; login, register and profile pages (profile, password change, active sessions); server-side guards (`requireUser`, `redirectIfSignedIn`); client `AuthProvider`; typed API client; shared-schema form validation; error page |
| Infra and config | `.env.example`, `infra/Dockerfile.web` (build arg `API_INTERNAL_URL`), `infra/docker-compose.yml` (`TRUST_PROXY`, build arg), `pnpm-workspace.yaml` (`argon2` build approval), `vitest.config.ts` (TSX/jsdom + `@/` alias) |
| Docs | DATABASE_SCHEMA, API_CONTRACTS, ARCHITECTURE §10, DECISIONS (D35 note, D41–D47), IMPLEMENTATION_PLAN, TESTING, DEPLOYMENT, README, this file |

### 7.2 Acceptance criteria (IMPLEMENTATION_PLAN, Phase 2)

| ID | Status | Evidence / caveat |
|---|---|---|
| AC-2.1 | Met | Test reads the stored row: Argon2id string with the recorded parameters, not containing the password. Parameters and timings: ARCHITECTURE §10.1 (sandbox timings only) |
| AC-2.2 | Met | Test: stored `tokenHash` is 64 hex characters, differs from the cookie token, and the raw token appears nowhere in the session rows; a DB constraint rejects non-digest values |
| AC-2.3 | Met | API tests inspect `Set-Cookie` (development and production configurations, including clearing) |
| AC-2.4 | Met | Controlled-clock tests: idle expiry, 30-day absolute expiry with continuous activity, immediate revocation |
| AC-2.5 | Met | Success and every documented error code for each endpoint is exercised |
| AC-2.6 | **Partly met** | API: every protected endpoint returns `401`. Web: redirects to `/login` verified over HTTP against a real Next.js server. **No browser E2E was run** (Playwright not implemented/installable here) |
| AC-2.7 | Met | Missing/foreign Origin → `403 INVALID_ORIGIN`; wrong content type → `415` |
| AC-2.8 | Met | `429 RATE_LIMITED` with `Retry-After` on repeated logins (per IP and per account) |
| AC-2.9 | Met | Unknown email and wrong password return identical status and body shape |
| AC-2.10 | Met | Password change keeps the current session and revokes all others |
| AC-2.11 | Met | V7 measured and covered by `apps/api/test/web-auth.int.test.ts`; finding in §7.4 |
| AC-2.12 | Met | Cleanup job test (deletes beyond the 24 h grace, keeps the rest, idempotent) |

### 7.3 Test and check evidence

Run by Claude in a preparation environment (details and limits: TESTING §8.0a): `pnpm test` → 17 files, 228 tests passed, twice in a row (115 unit + 113 integration); `pnpm lint`, `pnpm format:check`, `pnpm typecheck` passed; `next build` succeeded. The owner reproduced them locally on 2026-11-13 (see §7.9); CI has not yet been run on Phase 2.

### 7.4 Findings made while implementing

1. **Authentication ran after validation.** An unauthenticated `PATCH` with an invalid body returned `400`, not `401`. Fixed by moving the guard to `preValidation` (D44); tests now call every protected route unauthenticated (two of them with bodies that would fail validation) and expect `401`.
2. **V7: Next.js does not set `X-Forwarded-For`** and forwards a client-supplied one unchanged (verified on the dev server and on `next start`). A first draft that trusted the proxy as a boolean would have let clients forge their address. Replaced by a trusted-address list (D43); production needs an outer reverse proxy that sets the header (ARCHITECTURE §10.3). Fastify 5.12 also ignores numeric `trustProxy` values, which ruled out a hop count.
3. **Mixed clocks.** `passwordChangedAt` was written by the database default at registration but by the application clock on password change, which made a test fail in one environment. The register path now sets it from the application clock.
4. **Release-age gate.** `pnpm add` silently added an exclusion for a one-day-old `user-event`; replaced by an older version and the exclusion removed (D47).
5. **Readiness could not detect a missing migration** (D35 limitation). Fixed (D41).

### 7.5 Deviations from the design documents

`avatarAssetId` and the `Asset` relation are not created (Phase 4); `SESSION_COOKIE_NAME` and `ARGON2_*` variables were not implemented (D42, DEPLOYMENT); an extra check constraint on `sessions.tokenHash`; every state-changing request must carry a JSON body (send `{}`); `TRUST_PROXY` is an address list. All are recorded in DATABASE_SCHEMA §4.1.1, API_CONTRACTS §3.1 and DECISIONS.

### 7.6 Not verified and known limitations

- **Browser E2E:** Playwright browser E2E tests are not implemented. Owner-run manual browser acceptance checks passed; jsdom and real-Next.js HTTP tests remain the automated frontend coverage (AC-2.6 is therefore partly met, not fully met).
- **GitHub Actions CI for Phase 2:** deferred by the owner on 2026-11-13; the owner has since run it and **reports that it passed** (recorded 2026-11-15; the run's date and commit were not supplied). The historical Phase 1a/1b CI pass in §3 remains a separate result.
- **Production proxy deployment:** the D43 trusted-proxy configuration is accepted, but the actual production reverse proxy and hosting target are not selected (U10). Production must place the web tier behind a trusted reverse proxy that sets `X-Forwarded-For`; do not expose the web tier directly.
- Rate-limit values and the Argon2 cost are starting values, not tuned (no target hardware or traffic estimate exists).
- No email verification, password reset, breached-password check, account lockout notification, CSP on the web app, or audit log (not in scope).
- The `session.revoked` events are published but nothing consumes them yet (Phase 6).
- `next dev` is used by one integration test (`web-auth.int.test.ts`, about 15 s, needs ports and a free `apps/web/.next`); monitor its stability when Phase 2 CI is eventually enabled. If it proves flaky, make it build and use `next start`.
- The optional Compose `apps` profile was verified on `http://localhost:3000` in the owner's browser. The environment-specific `Secure`/`__Host-` cookie caveat in D42 did not block the owner's reported test; still test the production HTTPS topology before deployment.

### 7.7 Owner verification checklist

Owner-run verification record is in §7.9. Results:

1. `pnpm install --frozen-lockfile`, PostgreSQL 17, Redis 7 and `.env`: **Passed**.
2. `pnpm db:migrate:deploy`, `pnpm db:migrate:status`, and scratch-database `migrate:dev` drift check: **Passed**; both migrations applied, status up to date, no drift/new migration proposed.
3. Lint, format check and typecheck: **Passed**. All 228 tests passed with `--testTimeout=20000`. The default timeout remains borderline for spawn-heavy tests; see §7.9.
4. Manual browser acceptance: **Completed**. Registration/login, reload persistence, protected-page redirect, generic invalid-credential message, profile display-name and presence-colour changes, second-session listing/revocation, password-change revocation, logout/back-button protection, and the current-session indicator were checked. The current-session badge was made visible by separating the truncated user-agent text from the non-shrinking badge.
5. Optional Docker `apps` profile: **Passed**. API, web, collab and migration images built; containers started; migration exited 0 with no pending migrations; owner verified the application in the browser; `GET http://localhost:4000/ready` returned HTTP 200 with `postgres: healthy` and `redis: healthy`.
6. D41–D47: **Accepted by the owner on 2026-11-13** (DECISIONS.md). D43's trusted-proxy design is accepted; actual production proxy/hosting selection remains open (U10).
7. Phase 2 GitHub Actions CI: **Passed (owner-reported, recorded 2026-11-15).** Originally deferred by explicit owner instruction on 2026-11-13.

### 7.8 Notes for Phase 3

New protected endpoints go inside the authenticated scope in `apps/api/src/routes/auth.ts` (hook `requireAuth`, user via `authOf(request)`), with per-route `config.rateLimit`; add the shared permission function (D23) rather than ad-hoc checks. Use `Dependencies.clock` for every time-based decision. The web `(app)` route group and `requireUser()` are the pattern for protected pages. Phase 3 adds its tables in a new migration; the readiness check will then require that migration automatically.

### 7.9 Owner verification record (2026-11-13)

Environment: Windows laptop, Git Bash/Windows terminal, Node.js 24.18.0, pnpm 12.18.0, Docker 29.9.2, PostgreSQL 17 and Redis 7 from the local Compose file.

**Owner-run Phase 2 acceptance checks are complete, including Phase 2 GitHub Actions CI (owner-reported pass, recorded 2026-11-15). Final Phase 2 sign-off has not yet been recorded.**

| Verification area | Result | Evidence / qualification |
|---|---|---|
| Install and local infrastructure | **Passed** | `pnpm install --frozen-lockfile` clean; PostgreSQL (host 5433) and Redis (6379) healthy; `.env` present |
| Prisma migration and drift | **Passed** | `migrate deploy`: no pending migrations; `migrate status`: up to date. Scratch database `conote_scratch`: `migrate:dev` applied both migrations from empty without proposing a new migration; second run reported "Already in sync" |
| Lint, format and typecheck | **Passed** | Owner reports all passed |
| Automated tests | **Passed with timeout qualification** | 17 files / 228 tests passed with `--testTimeout=20000`. The default 5-second timeout was borderline for spawn-heavy tests; see Findings |
| Manual browser acceptance | **Passed** | Registration/login, reload persistence, signed-out protected-page redirect, generic wrong-password/unknown-email response, profile display-name and presence-colour changes, header update after reload, second-session listing/revocation, password-change revocation of other sessions, logout/back-button protection, and current-session indicator verified by owner |
| Current-session indicator | **Fixed and verified** | API returned `current: true`; DTO already declared `current: boolean`. UI issue was truncation on the paragraph containing both the long user-agent and badge. The user-agent is now truncated independently and the `This device` badge uses `shrink-0`; owner confirmed the indicator appears |
| Docker app images and startup | **Passed** | `docker compose -f infra/docker-compose.yml --profile apps up --build`: API, web, collab and migrate images all built; PostgreSQL and Redis healthy; migration container exited with code 0 and reported no pending migrations; API, web and collab started |
| Docker application browser check | **Passed** | Owner confirmed the Docker-hosted application had already been verified in the browser |
| API readiness in Docker | **Passed** | `curl.exe -i http://localhost:4000/ready` returned HTTP 200: `{"status":"ready","service":"api","dependencies":{"postgres":"healthy","redis":"healthy"}}` |
| D41–D47 owner decisions | **Accepted** | All seven decisions explicitly accepted by the owner on 2026-11-13; details and Option A selections are recorded in DECISIONS.md |
| GitHub Actions CI for Phase 2 | **Passed (owner-reported)** | Originally deferred on 2026-11-13; the owner has since run it and reported a pass (recorded 2026-11-15) |
| Production hosting / proxy deployment | **Open** | D43 design accepted, but provider/topology selection remains U10 and must be completed before production deployment |

#### Findings and qualifications retained from the verification process

1. **Stale Phase 1 page shadowed the Phase 2 home page.** `apps/web/src/app/page.tsx` (the Phase 1 placeholder) existed alongside `apps/web/src/app/(app)/page.tsx`; both resolve to `/`, and the placeholder won. Three tests in `web-auth.int.test.ts` failed (unauthenticated `/` returned 200 instead of redirecting; the signed-in page lacked the welcome text). The stub was removed with `git rm` and `apps/web/.next` was deleted; the file then passed 7/7. Ensure the deletion is included in the Phase 2 change set.
2. **Default test timeout is borderline on this machine.** Earlier default runs encountered timeout failures in spawn-heavy tests (`tests/boundaries.test.ts` and `tests/startup.test.ts`). In isolation the boundaries test took about 4.1 seconds of its 5-second limit. All 228 tests passed with `--testTimeout=20000`. No repository timeout change is recorded here; decide whether to adjust it before relying on CI.
3. **Development environment setup:** the root `package.json` has no `dev` script; run `pnpm dev:api` and `pnpm dev:web` in separate terminals (`dev:collab` is not needed for Phase 2). Next.js does not automatically read the root `.env`; the local workaround was `apps/web/.env.local` with `APP_URL` and `API_INTERNAL_URL`. Decide whether to document this or change the development script.
4. **Network binding:** the API was observed listening on all network interfaces during development. Review exposure and proxy configuration before production.
5. **Production reverse proxy:** D43's trusted-address-list design is accepted, but the actual proxy address list and production topology must be configured for the selected hosting environment (U10).

#### Remaining before Phase 2 final sign-off

- Phase 2 GitHub Actions CI was run by the owner and reported as passed (recorded 2026-11-15). The `web-auth.int.test.ts` stability note above still applies.
- Decide whether to raise the default timeout for spawn-heavy tests and document/fix root `.env` loading for `pnpm dev:web`.
- Select the production hosting and reverse-proxy topology (U10) before deployment. This does not block local Phase 2 feature verification, but is a production deployment requirement.
- Record the owner's explicit final Phase 2 acceptance before starting Phase 3.

## 8. Phase 3 – implementation record (2026-11-14)

**Sections 8.1–8.7 describe the implementation as delivered on 2026-11-14 and were written before anything was executed; the owner's verification results are in §8.8.**

### 8.1 What was implemented

- **Database** (`packages/db`): models `Workspace`, `WorkspaceMember`, `Invitation`, `Page`, `PagePermission`, `ActivityLog`; enums `WorkspaceRole`, `PageAccessRole`, `InvitationStatus` (+`DECLINED`, D48); migration `20261114090000_workspaces_pages_permissions` with the one-owner partial index and deferred trigger, invitation CHECKs and partial unique index, page self-parent and position CHECKs, and a Prisma-managed composite parent foreign key (DATABASE_SCHEMA §12).
- **Shared** (`packages/shared`): `permissions.ts` (roles, `resolveEffectivePageRole`, invite/role-change/removal rules), `page-position.ts` (fractional keys, re-spacing), `workspaces.ts` (all Phase 3 schemas, invite-link helpers, email masking), extended `AccessEvent`.
- **API** (`apps/api`): `workspaces/` (`AccessService`, activity logging, access-event publishing, placement, DTOs, pagination) and routes `workspaces.ts` (WS-01–09), `invitations.ts` (INV-01–07), `pages.ts` (PAGE-01–09), `page-permissions.ts` (PP-01–03), `activity.ts` (ACT-01–02); `plugins/account-limiter.ts`; `jobs/page-purge.ts` wired into `main.ts`; config gained `appUrl` and the `invitation` rate-limit rule.
- **Web** (`apps/web`): workspace dashboard, create workspace, workspace shell with responsive page sidebar and nested navigation, page view (breadcrumbs, title edit, move, delete, permissions panel), members and invitations management, settings (rename, transfer ownership, leave, delete with name confirmation), trash, and the public `/invite` accept/decline page. The stale Phase 1 `app/page.tsx` was removed (it shadows the home page, §7.9 finding 1; the uploaded ZIP still contained it).
- **Documentation:** DECISIONS D48–D53, API_CONTRACTS (INV-07, §15), DATABASE_SCHEMA §12, IMPLEMENTATION_PLAN, TESTING §8.0b, ARCHITECTURE §20, PROJECT_MASTER and WEBSOCKET_PROTOCOL status lines, this file.

### 8.2 Acceptance criteria (IMPLEMENTATION_PLAN, Phase 3)

Status means "a test exists"; **none has been run.**

| AC | Test written | Notes |
|---|---|---|
| 3.1 exhaustive permission function | Yes (`permissions.test.ts`) | **Executed under a shim: 14/14 passed**; not yet under Vitest |
| 3.2 permission matrix | Yes (`permission-matrix.int.test.ts`) | Not run |
| 3.3 404 vs 403 | Yes (matrix, `permissions.int.test.ts`) | Not run |
| 3.4 second owner / OWNER invitation rejected | Yes (`workspace-constraints.int.test.ts`) | Not run |
| 3.5 invitation single-use, expiry, email-bound, hash only | Yes (`workspaces.int.test.ts`) | Expiry is set directly in the database, not by advancing the shared clock (sessions would expire); not run |
| 3.6 INVALID_MOVE cases | Yes (`pages.int.test.ts`) | Not run |
| 3.7 batch delete/restore, purge cascade | Yes (API and DB tests) | Not run |
| 3.8 member removal deletes overrides | Yes | Not run |
| 3.9 ownership transfer, password required | Yes | Not run |
| 3.10 activity per catalogued action | Partly | Only the actions Phase 3 writes are checked, and not each one individually; **gap** |
| 3.11 E2E | **No** | Playwright not implemented; API-level flow tests approximate it |
| 3.12 U9 out of scope, U6 recorded | Documented | D52 |

### 8.3 What was and was not executed

Executed in the preparation environment (Node 22.23, TypeScript 6.0.3, tsx; **no PostgreSQL, Redis, pnpm, network or installed dependencies**): the fractional-position property test (3 000 random insertions) and the shared permission and position unit tests (14 + 7 passed) and the web page-tree tests (7 passed) under a ~30-line `describe/it/expect` shim that is **not Vitest**; a TypeScript **parse** of all 131+ `.ts/.tsx` files (0 syntax errors).

Not executed: `pnpm install`, Prisma client generation, **type checking** (Phase 3 code depends on the regenerated Prisma client types and has never been compiled), ESLint, Prettier, any Vitest suite, the migration, `next build`, any browser. Expect to fix some type or lint errors on first compile; see §8.5.

### 8.4 Deviations from the design documents

1. **INV-07 (decline) and `DECLINED`** added (D48); the design had no invitee-side rejection.
2. Composite parent FK is named `pages_workspaceId_parentId_fkey` and declared in `schema.prisma` (DATABASE_SCHEMA §12) instead of the hand-written name in §5.
3. Not built (D52): invitation email adapter, development seed script, Playwright E2E, page search (never in scope), PAGE-10 (Phase 6).
4. Pagination exists in the API (invitations, trash, activity) but the web UI requests `limit=100` and has no paging controls; the workspace activity feed has no web view.
5. Page `icon` is supported by the API but has no UI.
6. Web `DELETE` calls send the same `{}` JSON body as other mutations; `WS-05` requires its `confirmName` body.

### 8.5 Findings and risks to check first

1. **Never compiled.** Highest risk: Prisma-generated types. Check `schema.prisma` validates (the composite self-relation `Page.parent` with `onDelete: Cascade` over a nullable + required field pair is the least conventional part), then `pnpm db:generate`, `pnpm typecheck`.
2. **Migration hand-written.** Run `pnpm db:migrate:deploy`, then the scratch-database `migrate:dev` drift check. A partial unique index or constraint that Prisma reports as drift would show up here; if so, adjust per DATABASE_SCHEMA §12.
3. **`$queryRaw` with `::uuid` casts** (recursive CTEs, advisory lock) assume the `pg` driver adapter returns `int`/`text` columns as numbers/strings.
4. **Existing tests:** `security.int.test.ts` and `auth-harness.ts` were edited (new `invitation` rate-limit key, `APP_URL`, workspace cleanup before user cleanup).
5. **Test environment:** the new API tests need the same PostgreSQL/Redis as the Phase 2 integration tests. The default 5 s timeout was already borderline (§7.9 finding 2); run with `--testTimeout=20000`. The matrix test is large (about 130 cases).
6. **Account deletion** (future) must handle owned workspaces first (DATABASE_SCHEMA §12).
7. **Rebalancing** of sibling keys is exercised by one test that forces a long key; real append growth is covered only by the pure unit test.

### 8.6 Owner verification checklist

1. `pnpm install` (no new dependencies were added), `pnpm db:generate`.
2. `pnpm db:migrate:deploy`, `pnpm db:migrate:status`; scratch-database `migrate:dev` must propose nothing new.
3. `pnpm lint`, `pnpm format:check`, `pnpm typecheck` (expect to fix type/format issues; send the output back).
4. `pnpm test -- --testTimeout=20000`. Report failures with their output.
5. Browser: sign in, create a workspace, create root/child pages, collapse/expand, rename a page, move it, delete and restore it from Trash; invite a second user (copy link), open it in another browser profile, register/sign in with the invited email, accept; change that member's role; set a page override to No access and confirm the page disappears for them; remove the member; try a workspace delete with a wrong then the right name. Check the layout at phone width (sidebar toggle).
6. Decide D48–D53 and the Phase 2 sign-off/CI items.

### 8.8 Owner verification results (2026-11-15)

Run locally by the owner (Windows, Git Bash, PostgreSQL 17 on host port 5433, Redis 7) following §8.6.

| Check | Result | Notes |
|---|---|---|
| `pnpm install`, `prisma validate`, `pnpm db:generate` | **Passed** | The `Page.parent` composite self-relation (the risk flagged in §8.5 item 1) was accepted |
| `pnpm db:migrate:deploy` / `migrate:status` | **Passed** | `20261114090000_workspaces_pages_permissions` applied; schema up to date |
| Scratch-database drift check | **Passed** | All three migrations applied to an empty database; second `migrate:dev` reported "Already in sync"; no new migration proposed |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | **Passed** | After the fixes below |
| `pnpm check` | **Passed** | 482 tests, including the permission matrix (133/133) and the DB constraint tests (one-owner trigger and index) against real PostgreSQL and Redis |
| Manual browser walkthrough (§8.6 item 5) | **Passed** | Owner reported all flows working: workspace and page tree, rename, move, delete/restore, invitations across two sessions, role change, page override to No access, member removal, workspace delete confirmation, phone-width layout |

**Changes made during verification** (no API behaviour was changed):

1. `packages/shared`: files from the Phase 3 delivery (`permissions.ts`, `page-position.ts`, `workspaces.ts`, the extended `AccessEvent` and their exports) were missing from the working tree on first compile; restoring them cleared roughly 150 type errors in `apps/api`.
2. Web lint: seven `react-hooks/set-state-in-effect` errors fixed. `invite-accept.tsx` and `workspace-dashboard.tsx` read the URL fragment and the stored invitation with `useSyncExternalStore`; `page-view.tsx` and `workspace-shell.tsx` are wrapped so they remount per `pageId` / `workspaceId` (`key`), keep a local title draft instead of syncing it in an effect, and open ancestors by adjusting state during render; `use-load.ts` derives `loading` by comparing the settled request with the current one instead of setting it in an effect. The public `useLoad` shape is unchanged. See the note under D53.
3. `apps/api/test/permission-matrix.int.test.ts`: the `PUT`/`DELETE page permission` actions applied a `NONE` override to the VIEWER actor, which hid the page from that actor and produced a correct 404 where the test expected 403. They now target a separate `target` member who never acts.
4. `tests/boundaries.test.ts`: the `describe` has a 30 s timeout; the first ESLint call is slow under a parallel full run and exceeded the 5 s default.

**Findings**

- `pnpm test -- --testTimeout=20000` does **not** forward the flag (the `--` is passed through to Vitest). Use `pnpm test --testTimeout=20000`.
- §8.2 "Not run" entries in the Evidence column predate this verification; the automated rows are now covered by the results above.

**Still open**

- Final owner acceptance of Phase 3 and the Phase 2 final sign-off (§7.9). D48–D53 were accepted by the owner on 2026-11-15.
- GitHub Actions CI for Phase 3 and the optional Docker `apps` profile have not been run.
- Known limitations in §8.4 stand unchanged (no paging controls, no activity-feed view, no page icon UI).

### 8.7 Suggested commit message

```
feat: Phase 3 workspaces, pages and permissions

- db: workspaces, members, invitations, pages, page permissions, activity log;
  one-owner deferred trigger, invitation and page constraints
- shared: permission resolution (D23), fractional page positions, Phase 3 schemas
- api: WS-01..09, INV-01..07 (decline added), PAGE-01..09, PP-01..03, ACT-01..02;
  per-workspace advisory lock, access events, page purge job
- web: workspace dashboard, shell with page tree, members/invitations, settings,
  trash, permissions panel, invite page
- tests: exhaustive permission unit tests, permission matrix, API/DB/web tests
- docs: D48-D53, API/DB/testing/architecture updates, HANDOVER

Verified locally: pnpm check passes (482 tests); migration drift check and manual
browser acceptance passed (see docs/HANDOVER.md section 8.8).
```

## 9. Phase 4 – implementation record (2026-11-15)

**§9.1–§9.10 below were produced in a preparation environment (Node 24.18.0, pnpm 12.18.0, PostgreSQL 16.15, Redis 7.0.15; no browser, no Docker, no Prisma schema engine) and are kept as delivered. The owner ran the delivery locally on 2026-11-16; the results, and where they supersede §9.3, §9.4, §9.6 and §9.8, are in §9.11.**

### 9.1 Conflicts with the plan and the decisions taken

The Phase 4 task asked for document loading, saving, autosave and "validate persisted content", and for "image support". `IMPLEMENTATION_PLAN.md` lists persistence and autosave as out of scope for Phase 4 (Phase 6), D15 makes persistence Yjs-based, and the plan defines image support as upload to object storage (MinIO or alternative, U7). `CLAUDE.md` requires such conflicts to be raised, not settled silently; they were put to the owner, who answered **"do what is best for now"** to both. The resulting choices were proposed on 2026-11-15 and **approved by the owner on 2026-11-16**:

| Decision | Choice | Cost |
|---|---|---|
| **D54** | Interim persistence: validated ProseMirror JSON in a separate `page_contents` table, revision compare-and-set, `CONTENT-01/02`, autosave in the web client. Removed in Phase 6. | A second source of truth until Phase 6; no merge, only conflicts. |
| **D55** | Image upload flow, 5 MiB limit, PNG/JPEG/GIF/WebP, behind a storage adapter with a **local-disk backend**. | S3/MinIO adapter, MinIO in Compose and avatar upload are **not** done; single-instance only. |
| **D56** | Document schema v1, one definition in `packages/shared`, Tiptap 3.33.1, unapproved StarterKit nodes disabled. | Pasted blockquotes/code/strikethrough are dropped. |

Had D54 been rejected, that would have meant removing `page_contents`, `CONTENT-01/02`, `savePageContent` and the autosave wiring (the editor, validator and images remain).

### 9.2 What was implemented

- **Shared** (`packages/shared`): `editor-content.ts` (schema v1, `validateEditorDocument`, link helpers, limits), `page-content.ts` (CONTENT schemas), `assets.ts` (types, limit, signature detection, asset schemas); `ASSET_STORAGE_DIR` in the API environment schema.
- **Database** (`packages/db`): models `PageContent`, `Asset`, enums `AssetPurpose`, `AssetStatus`; migration `20261115120000_editor_content_assets` (hand-written SQL, CHECKs).
- **Editor** (`packages/editor`): `ExtensionRegistry` and default features, configured extensions, slash commands and the `SlashCommand` extension, type re-exports.
- **API** (`apps/api`): `routes/page-content.ts` (CONTENT-01/02), `routes/assets.ts` (ASSET-01…04), `storage/` (adapter interface, local-disk adapter), `jobs/asset-cleanup.ts` (hourly), a per-route 1 MiB body limit for CONTENT-02, two rate-limit rules, and a narrow content-type exemption for ASSET-04 in `plugins/security.ts`.
- **Web** (`apps/web`): `components/editor/` (editor, toolbar, slash menu, save indicator, save-error classification), `lib/autosave.ts`, `lib/image-upload.ts`, API client calls, editor styles in `globals.css`, `PageView` now renders the editor (the placeholder is gone).
- **Documentation:** DECISIONS (D54–D56, U7, D20 note), API_CONTRACTS (§7.1, §9), DATABASE_SCHEMA §13, ARCHITECTURE §21, TESTING §8.0c, IMPLEMENTATION_PLAN (Phase 4 status), DEPLOYMENT, PROJECT_MASTER and README status, `.env.example`, `.gitignore`, this file.

### 9.3 Acceptance criteria (IMPLEMENTATION_PLAN, Phase 4)

| AC | Status | Evidence / gap |
|---|---|---|
| 4.1 | **Partial** | Component or unit test for each of FR-ED-01…08 (editor-behavior, page-editor tests) — pass. **No E2E tests through a real browser** (Playwright unavailable). Owner's manual browser walkthrough of every feature passed 2026-11-16 (§9.11); still no automated E2E. |
| 4.2 | Pass | `registry.test.ts` registers a custom mark and slash command without touching core code. |
| 4.3 | **Partial** | Authorize → upload → complete → read round trip passes in API tests and in the live smoke test (2 MB through the proxy, identical hash); users without access get 404/401. **Against the local-disk adapter, not object storage.** No E2E. Owner confirmed button, paste and drag-and-drop uploads, reload persistence and rejections in a browser 2026-11-16; still the local-disk adapter. |
| 4.4 | Pass | 415 (type, SVG), 413 (size), 409 (missing object, size mismatch, wrong signature) in `assets.int.test.ts`. |
| 4.5 | **Partial** | Toolbar (one tab stop, arrows/Home/End) and slash menu (arrows, Enter, Escape) are tested with keyboard events in jsdom; no E2E keyboard test, no screen-reader check. Owner's manual keyboard-only check passed 2026-11-16; still no automated E2E or screen-reader check. |
| 4.6 | Pass | `createDefaultRegistry({ undoRedo: false })` removes the built-in extension (headless editor test). |
| 4.7 | **Partial** | Flow, limits and types recorded (D55, U7 partly resolved); production storage backend and MinIO check open. D55 accepted 2026-11-16; production backend (U7) still open. |
| Task: viewer permissions prevent editing | Pass | Read-only editor, no toolbar, no autosave client-side; server answers 403/404 (permission-matrix style tests in `page-content.int.test.ts`). |
| Task: responsive | **Manually verified** | CSS written for narrow screens (scrollable toolbar and tables, 44 px touch targets); never rendered in a browser. Owner checked phone width in a browser 2026-11-16: passed. |
| FR-AUTH-05 avatar upload | **Not done** | Deferred (D55); `USER-02 avatarAssetId` not implemented. |

### 9.4 What was and was not executed

Executed: `pnpm install --frozen-lockfile` (plus the new Tiptap packages), Prisma `validate` and client generation, the new migration (applied with psql through a script that also fills `_prisma_migrations`, because Prisma's schema engine could not be downloaded), `pnpm lint` (no problems), `pnpm typecheck`, `pnpm build` (packages, API, collab, web), `pnpm test --testTimeout=20000`: **38 files, 692 tests passed** (baseline in the same environment: 27 files, 482 tests, matching your Phase 3 result), and a smoke test against the built API and web servers (§TESTING 8.0c).

Not executed: `prisma migrate deploy`/`status` and the scratch-database drift check for the new migration; `pnpm format:check` clean (see 9.6); any browser or Playwright test; Docker images and Compose; GitHub Actions; PostgreSQL 17 (16.15 was used); S3/MinIO.

### 9.5 Deviations from the design documents

1. Interim `CONTENT-01/02` and `page_contents` (not in the design; D54). 2. `ASSET-04` added; `ASSET-03` streams instead of redirecting (local adapter); `filename` removed from `ASSET-01`; `AVATAR` not accepted. 3. `User.avatarAssetId` not created. 4. `Asset.createdAt` is set by the application clock. 5. The JSON-only rule of D25 has one route-scoped exception (ASSET-04). 6. Table cells forbid nested tables (a tightening of Tiptap's default).

### 9.6 Findings and risks to check first

1. **Pre-existing lint errors:** five Phase 3 route files (`activity`, `invitations`, `page-permissions`, `pages`, `workspaces`) imported `AccessService` as a value although it is only used as a type (`@typescript-eslint/consistent-type-imports`). They are byte-identical to the uploaded zip. I applied the one-line autofix (`import { type AccessService }`) so lint is clean; if your lint was clean before, something else differs and you should check.
2. **Pre-existing Prettier drift:** `prettier --check .` flags 19 Phase 3 files that I did not touch (lines over 100 columns, for example `packages/shared/src/workspaces.ts`) and 5 files I modified that were already unformatted (`routes/invitations.ts`, `routes/page-permissions.ts`, `routes/pages.ts`, `routes/workspaces.ts`, `lib/api-client.ts`). All 25 files I created or modified that were clean before are formatted. I did not reformat other people's files to keep this change reviewable; run `pnpm format` as a separate commit if you want a clean `format:check`.
3. **Zod 4 encodes responses:** a `.transform` in a response schema fails at serialization ("unidirectional transform"). The document schema is therefore a refinement cast to its type. Keep this in mind for any shared schema used in a response.
4. **Table command chains:** chaining `addRowAfter` and `addColumnAfter` in one Tiptap command duplicated the table (jsdom); the toolbar issues one command per click.
5. **Migration drift is unchecked:** the SQL follows Prisma's conventions and applied cleanly, but only your `migrate:dev` scratch-database check can prove the schema and migration agree.
6. **PostgreSQL 16 vs 17** and an Ubuntu-packaged Redis were used for the tests.

### 9.7 Known limitations

No real-time collaboration (two editors get a conflict choice, not a merge); retries are lost if the tab is closed while offline (the browser asks before closing) and when navigating inside the app while offline; no history; image `alt` defaults to the file name and cannot be edited; images use `Cache-Control: no-store`; images removed from a document stay on disk; local-disk storage serves a single API instance and the Docker `apps` profile has no volume for it; the slash menu hides on Escape but reappears when typing continues; image width/height are not set by the UI; mobile soft-keyboard and IME behaviour untested; the upload request is not resumable.

### 9.8 Owner verification checklist

1. `pnpm install`, `pnpm db:generate`, **`pnpm db:migrate:deploy`**, `pnpm db:migrate:status`, then the **scratch-database drift check** (`migrate:dev` against an empty database) — expect no drift for `20261115120000_editor_content_assets`.
2. `pnpm check` (lint, format check — see 9.6 — typecheck, tests). Expect 692 tests.
3. Browser walkthrough with two roles: open a page (empty editor), type, wait for "Saved", reload (content returns); use each toolbar control and each slash command (`/`, type, Enter); insert an image by button, paste and drag-and-drop; open the same page in two tabs, edit in both and check the conflict message and both choices; sign in as a Viewer (read-only, no toolbar) and as a Commenter; go offline (retry message), come back online; narrow the window to phone width (toolbar scrolls, tables scroll, nothing overflows); keyboard only (Tab to the toolbar, arrows between buttons, `/` menu with arrows and Enter).
4. Decide D54, D55, D56 and U7 (production storage backend, MinIO).
5. Optionally: Docker `apps` profile (images need a volume for `ASSET_STORAGE_DIR`), GitHub Actions.

### 9.9 Notes for Phase 5

Seed each `Y.Doc` from `page_contents.content` for pages without document state (Tiptap's Collaboration uses a ProseMirror schema; this document format is valid for it); build the editor with `createDefaultRegistry({ undoRedo: false })` plus the Collaboration extension; drop `page_contents`, `CONTENT-01/02`, `savePageContent` and the autosave HTTP save in Phase 6; keep `validateEditorDocument` for imports and for any server-side content writes; check which Yjs binding package Tiptap 3.33.1 requires (D20).

### 9.10 Suggested commit message

```
feat: Phase 4 rich-text editor with interim autosave and image upload

- Tiptap 3.33.1 editor (headings, bold/italic/underline, lists, checklists,
  links, tables, text alignment, images, slash commands, toolbar) built from an
  extension registry; undo/redo can be removed for the Yjs binding
- shared document schema v1 and validator (D56) used by the API and checked
  against the real ProseMirror schema
- interim page-content API CONTENT-01/02 with revision compare-and-set and
  client autosave (D54; replaced by the Yjs document store in Phase 6)
- image upload ASSET-01..04 behind a storage adapter, local-disk backend,
  type/size/signature checks, hourly cleanup job (D55)
- viewers get a read-only editor; server enforces PAGE>=EDITOR for writes
- migration 20261115120000_editor_content_assets (page_contents, assets)
- tests: 692 passing (210 new); docs and HANDOVER updated
- lint: add `type` to AccessService imports in five Phase 3 route files
- deps: declare @tiptap/* 3.33.1 and @floating-ui/dom in packages/editor and
  apps/web; update pnpm-lock.yaml
- docs: D54-D56 accepted; Phase 4 owner verification recorded (section 9.11)

Verified locally: db:migrate:deploy and the drift check are clean, pnpm test
--testTimeout=20000 passes (692 tests) and the browser walkthrough passed (see
docs/HANDOVER.md section 9.11).
```


### 9.11 Owner verification results (2026-11-16)

Run locally by the owner (Windows, Git Bash, Node 24.18.0, pnpm 12.18.0, PostgreSQL 17 on host port 5433, Redis 7) following §9.8.

| Check | Result | Notes |
|---|---|---|
| `pnpm install`, `pnpm db:generate` | **Passed** | After the delivery gaps below were closed; the first `pnpm install` was a no-op because the Tiptap dependencies were not declared |
| `pnpm db:migrate:deploy` / `migrate:status` | **Passed** | Prisma applied `20261115120000_editor_content_assets`; status "up to date"; a second `deploy` found nothing pending |
| Scratch-database drift check | **Passed** | All four migrations applied to an empty `conote_scratch`; second `migrate:dev` reported "Already in sync"; no new migration proposed; `git status` showed only the expected Phase 4 changes |
| `pnpm lint`, `pnpm format:check` | **Passed** | `format:check` reported all files formatted, so the Prettier drift predicted in §9.6 item 2 did not appear in the owner's tree |
| `pnpm typecheck` | **Passed** | After the delivery gaps below were closed |
| `pnpm test` (default 5 s timeout) | **690 / 692** | The two `tests/startup.test.ts` cases (api and collab exit-code tests) timed out at 5 s; the same borderline spawn-heavy timeout is recorded for Phase 2 (§7.9 finding 2). Total 139 s with 38 workers |
| `pnpm test --testTimeout=20000` | **Passed: 38 files, 692 tests** | Matches the preparation-environment count (482 baseline + 210) |
| Browser walkthrough (§9.8 item 3) | **Passed** | Owner reported all of it working: empty editor, typing, "Saved", reload persistence; every toolbar control and slash command; images by button, paste and drag-and-drop; two-tab conflict with both choices; Viewer, Commenter and Editor roles; offline retry and recovery; phone-width layout; keyboard-only operation |
| D54, D55, D56 | **Accepted** | Owner approval 2026-11-16; U7 (production storage backend, MinIO) remains open |

**Delivery gaps found and fixed during verification** (no application behaviour was changed):

1. `packages/editor/package.json` and `apps/web/package.json` did not declare the Tiptap dependencies, and `pnpm-lock.yaml` had no Tiptap entries, so `packages/editor` could not resolve any `@tiptap/*` module. The owner added the dependencies (`packages/editor`: `@tiptap/core`, `extension-image`, `extension-list`, `extension-table`, `extension-text-align`, `extensions`, `pm`, `starter-kit`, `suggestion` at 3.33.1 and `@floating-ui/dom` 1.8.0; `apps/web`: `@tiptap/core`, `pm`, `react` at 3.33.1 and `@floating-ui/dom` 1.8.0); `pnpm install` then added 55 packages and updated the lockfile. These two `package.json` files and `pnpm-lock.yaml` must be in the Phase 4 commit.
2. The editor tsconfig change from the delivery had not been copied into the owner's tree; the `Cannot find name 'document'` errors in `packages/editor` disappeared once it was applied. `packages/editor/tsconfig.build.json` still compiles the test files into `dist` (unlike `packages/shared`, which excludes `src/**/*.test.ts`); excluding them is optional cleanup.

**Findings**

- Use `pnpm test --testTimeout=20000` for the full suite on this machine; whether to raise the default timeout for spawn-heavy tests in the repository is still undecided (§7.9).
- The responsiveness and keyboard rows in §9.3 are now covered by the owner's manual checks; they are not automated tests, and screen-reader, soft-keyboard and IME behaviour remain unchecked.

**Still open**

- Final owner acceptance of Phase 4, Phase 3 and the Phase 2 sign-off.
- U7: production storage backend (S3-compatible adapter, MinIO and its licensing check, avatar upload / `USER-02 avatarAssetId`).
- Docker `apps` profile (needs a volume for `ASSET_STORAGE_DIR`) and GitHub Actions for Phases 3 and 4.
- Known limitations in §9.7 stand unchanged.

## 10. Phase 5 – implementation record (2026-11-16)

**§10.1–10.7 record how Phase 5 was first written, without network access, so nothing was run then. It was run afterwards, on 2026-11-16, in a preparation environment: the results and the fixes it needed are in §10.8, and where §10.3 and §10.4 disagree with §10.8, §10.8 is current.**

### 10.1 Decisions taken for the owner ("do what is best for me")

Phase 4 accepted. Choices recorded as **D57 (proposed 2026-11-16, accepted by the owner 2026-11-16)**: binding package and pins (V9), shared Yjs helpers, `DocumentStore`, the extra `persistedDigest` column, load order, server-only seeding. Snapshots stay in Phase 8 (compaction is this phase's "snapshot and recovery foundation"). The web editor was **not** switched to Yjs: it has no provider or server until Phase 6, and switching now would break the working autosave (D54). The binding is an opt-in entry point, `@conote/editor/collaboration`.

### 10.2 What was written

| Area | Files |
|---|---|
| `packages/shared` | `src/collab.ts`, `src/yjs.ts` (+ tests), `yjs` 13.6.33 dependency, `sideEffects: false` |
| `packages/db` | models `DocumentState`, `DocumentUpdate` in `schema.prisma`; migration `20261116120000_yjs_document_store`; `src/document-store.ts` (`appendDiff`, `load`, `compact`, `seedIfEmpty`); `yjs` dependency; tests `document-store.int.test.ts`, `document-load-baseline.int.test.ts`, `document-test-support.ts` |
| `packages/editor` | `src/collaboration.ts` (`createCollaborativeRegistry`, `contentToYDoc`, `ydocToContent`), `src/collaboration.test.ts`, dependencies `@tiptap/extension-collaboration` 3.33.1, `@tiptap/y-tiptap` 3.0.7, `y-protocols` 1.0.7, `yjs` 13.6.33, `./collaboration` export |
| Docs | DECISIONS (D57), ARCHITECTURE §22, §18 V9, DATABASE_SCHEMA §3/§7/§14, WEBSOCKET_PROTOCOL §5a, IMPLEMENTATION_PLAN, TESTING §8.0d, this file |

### 10.3 Acceptance criteria (IMPLEMENTATION_PLAN, Phase 5) — results in §10.8

| AC | Test written | Status |
|---|---|---|
| 5.1 two editors converge | `collaboration.test.ts`, `yjs.test.ts` | Passed (§10.8) |
| 5.2 randomized convergence prints the seed | `yjs.test.ts` (25 seeds), `collaboration.test.ts` (5 seeds); the seed is in the test name and message | Passed (§10.8) |
| 5.3 diff-only, no-op store | `document-store.int.test.ts` | Passed (§10.8) |
| 5.4 concurrent stores serialize | same, 8 parallel stores and stores with compactions | Passed (§10.8) |
| 5.5 per-client maximum merge | same | Passed (§10.8) |
| 5.6 recovery equals the live document | same, 12 seeded histories + restart test | Passed (§10.8) |
| 5.7 atomic compaction | same, injected failure via `beforeCommit` | Passed (§10.8) |
| 5.8 commit boundary | same | Passed (§10.8) |
| 5.9 PERF-06 baseline | `document-load-baseline.int.test.ts` | Recorded in TESTING §8.0d (preparation environment only) |
| 5.10 V9 resolved | D57 / ARCHITECTURE §18 | Verified in the preparation environment and on the owner's machine (§10.9): installs without peer warnings, one `yjs`, all tests pass; newest `y-tiptap` is 3.3.0 and untested |

Task items: 1–8 and 10–12 are implemented as library code (`Y.Doc`, binding, `Y.XmlFragment`, state-vector sync, update application, local/remote handling, out-of-order/duplicate safety); 13–14 as the store and migration; 15 as compaction/recovery only (no snapshot table, Phase 8); 16 as a restart test using a new Prisma client and store, **not** a real process restart (do that manually, §10.4 item 6).

### 10.4 Owner verification checklist

**Completed on 2026-11-16: items 1–4, 6 and 7 are done (results in §10.9). Item 5 (recording the PERF-06 baseline) is done in TESTING §8.0d; the CPU model and RAM of the owner's machine were not recorded.**

1. `pnpm install` (not `--frozen-lockfile`: the lockfile lacks the new dependencies). Read the peer-dependency warnings for `@tiptap/y-tiptap`, `y-protocols`, `prosemirror-*`; if 3.0.7 is wrong, change the pin and record it in D57. Make sure only one `yjs` is installed (`pnpm why yjs`); two copies cause silent bugs.
2. `pnpm db:generate`, `pnpm db:migrate:deploy`, `pnpm db:migrate:status`, then the scratch-database `migrate:dev` drift check; it must propose nothing new (the migration SQL is hand-written to match Prisma's output).
3. `pnpm lint`, `pnpm format:check` (run `pnpm format` first if needed), `pnpm typecheck`; send me the output. Likely trouble spots: `Uint8Array<ArrayBuffer>` typing for Prisma `Bytes`, `doc.store.pendingStructs` typing in `DocumentReplica.hasPendingUpdates`, `@tiptap/y-tiptap` function typings, the `{ Collaboration }` named import.
4. `pnpm test --testTimeout=20000`; send failures with output. Things I could not know and would check first: whether a document reloaded from storage re-stores nothing ("a document reloaded from storage is not stored again" depends on the digest being identical after a reload); `Y.mergeUpdates` on disordered/duplicated rows; jsdom timing in the editor tests (`settle()` waits 20 ms for the binding's first render).
5. Record the `PERF-06 baseline` line printed by `document-load-baseline.int.test.ts` in TESTING.md with your machine details.
6. Manual restart check (optional, no UI needed): in a scratch script, store a document with `DocumentStore`, stop the process, start a new one and `load`.
7. Decide D57.

### 10.5 Known limitations and open items

- Not executed (above). The web app still uses the interim autosave (D54); there is no provider, server, presence or snapshots.
- `collab → editor` is not an allowed module boundary but Phase 6 needs `contentToYDoc` (D57 consequence a).
- No compaction trigger and no store debounce yet (Phase 6); `COMPACTION_UPDATE_THRESHOLD` = 200 is the D15 starting value, not a measured one.
- Concurrent deletion of a whole paragraph and an edit inside it keeps the deletion (inherent to Yjs; the edit is not "silently lost" by a bug, but it is not visible afterwards).
- Arbitrary malformed bytes sent to Yjs are untested by design (Phase 6 must authenticate and limit input).
- The lockfile was not updated.

### 10.6 Suggested commit message

```
feat: Phase 5 Yjs CRDT integration (see HANDOVER section 10)

- shared: Yjs helpers (DocumentReplica, per-client state-vector merge, document coverage),
  document-name helpers and constants
- editor: @conote/editor/collaboration (Tiptap Collaboration binding, JSON <-> Y.Doc)
- db: DocumentState/DocumentUpdate models, migration 20261116120000_yjs_document_store,
  DocumentStore (appendDiff, load, compact, seedIfEmpty) with row-locked transactions
- tests: convergence, out-of-order/duplicate delivery, recovery, atomic compaction,
  restart, PERF-06 baseline harness
- docs: D57, ARCHITECTURE s22, DATABASE_SCHEMA s14, WEBSOCKET_PROTOCOL s5a, HANDOVER s10

Verified in a preparation environment (802 tests, typecheck, lint) and on the owner's machine
(Node 24.18.0, PostgreSQL 17: install, migrate deploy/status and drift check, lint, format check,
typecheck, 802 tests, SIGKILL restart check; HANDOVER section 10.9). D57 accepted.
Not verified: Docker apps profile, GitHub Actions, a single `pnpm check` run.
```

### 10.7 Change log (Phase 5)

| Date | Change |
|---|---|
| 2026-11-16 | Phase 4 accepted by the owner. Phase 5 implemented without execution; D57 proposed; owner verification pending (§10.4). |
| 2026-11-16 | Phase 5 verified on the owner's machine (§10.9); D57 accepted by the owner. |

### 10.8 Execution results and fixes (2026-11-16)

**Environment:** Node v22.23.4 (the repo requires 24; `engine-strict` was overridden), PostgreSQL 16.13 and Redis 7 from apt on Linux x64 (Compose uses PostgreSQL 17), migrations applied by `psql` because the Prisma schema engine could not be downloaded. Not equivalent to the owner's machine; treat every number as a first observation.

**Commands and results**

| Command | Result |
|---|---|
| `pnpm install --config.engine-strict=false` | Succeeded; one `yjs` (13.6.33), no peer warnings |
| `pnpm typecheck` | Clean after fix 1 below |
| `pnpm lint` | Clean |
| `prettier --check` | Phase 5 files clean after `--write`. Still reported (not Phase 5, untouched): `packages/shared/src/workspaces.ts`, `workspaces.test.ts`, `packages/db/test/workspace-constraints.int.test.ts`, and 19 files under `apps/` from Phase 3; `infra/docker-compose.yml` fails to parse (`name:` at line 8). Check on the owner's machine |
| `vitest run` (unit and integration, `--testTimeout=20000`) | 43 files, 802 tests, all passed |
| Yjs unit suites (`yjs.test.ts`, `collaboration.test.ts`) repeated 10 times | 70 of 70 each time, no flakiness |
| `document-store.int.test.ts` | 35 passed (restart recovery, concurrent stores, compaction atomicity, per-client maximum) |
| Real restart: a Node process stored two updates and was killed with SIGKILL; a new process called `load` | Recovered both paragraphs exactly (`appliedRows: 2`) |

**Defects found and fixed**

1. `yjs.test.ts`: `synchronizeReplicas` was called with test peers, not replicas (typecheck error). Added a test-side wrapper.
2. `collaboration.ts` `ydocToContent`: the binding does not store `null` attributes, so the JSON lacked `textAlign: null`, `alt: null` and so on, and differed from `editor.getJSON()` and from the Phase 4 content in `page_contents`. It now reads the JSON through the ProseMirror schema, which restores the defaults. This was a library bug: 19 editor tests failed because of it.
3. Randomized convergence tests (shared and editor): the harness only published a peer's updates after its own edits. Applying a remote update can make Yjs clean up redundant formatting, which is a local update of its own; unpublished, replicas deleted different format items and showed different bold/underline on one character (seeds 3 and 5, varying between runs because client ids are random). The harness now publishes every local update and delivers until quiet, as a provider would. **Consequence for Phase 6: the provider and `DocumentStore` must treat updates produced while applying remote updates like any other update. Do not filter by origin.**
4. Tests: a Tiptap editor shows an empty trailing paragraph after a final image or table (TrailingNode). It is view-only (opening a document produced 0 Yjs updates and no duplicate paragraph with two clients), so the tests now expect it in the editor JSON and not in the stored content.

**Not verified**

- `prisma migrate deploy`, `migrate status` and the scratch-database `migrate:dev` drift check: the Prisma schema engine could not be downloaded, so the five migrations were applied with `psql` and `_prisma_migrations` was filled in by hand. Run §10.4 item 2 on your machine; the hand-written migration SQL is only proven to apply and to satisfy the tests.
- Node 24 and PostgreSQL 17 (Node 22 and PostgreSQL 16 were used); `pnpm check` as a whole; the Docker and CI paths.
- The newest `@tiptap/y-tiptap` (3.3.0).
- Web editor: still not on Yjs (no provider until Phase 6), so no browser check of collaboration exists.

| Date | Change |
|---|---|
| 2026-11-16 | Phase 5 executed in a preparation environment; fixes 1-4 above; documentation updated to match. |

### 10.9 Owner verification on the owner's machine (2026-11-16)

**Environment:** Windows (win32/x64), Node v24.18.0, pnpm 12.18.0, PostgreSQL 17 (`postgres:17-alpine`) and Redis 7 (`redis:7-alpine`) from Compose (PostgreSQL on host port 5433), Prisma 7.10.1. CPU and RAM were not recorded.

| Command / check | Result |
|---|---|
| `pnpm install` | Lockfile already up to date; no peer warnings. `pnpm why yjs`: one version, 13.6.33 (shared by `@conote/*`, `@hocuspocus/server` 4.8.0, `@tiptap/extension-collaboration` 3.33.1, `@tiptap/y-tiptap` 3.0.7, `y-protocols` 1.0.7) |
| `pnpm infra:up`, `docker ps` | PostgreSQL and Redis healthy |
| `pnpm db:generate` | Prisma Client 7.10.1 generated |
| `pnpm db:migrate:deploy`, `pnpm db:migrate:status` | 5 migrations found, no pending migrations, schema up to date (the Phase 5 migration had been applied beforehand) |
| Scratch-database drift check | `conote_scratch` created empty; first `migrate:dev` applied all 5 migrations including `20261116120000_yjs_document_store` and proposed no new migration; second run "Already in sync"; no stray migration in `git status` |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Clean. The typing spots flagged in §10.4 item 3 (`Uint8Array<ArrayBuffer>` for Prisma `Bytes`, `pendingStructs`, `@tiptap/y-tiptap` typings, the `{ Collaboration }` import) compiled without changes |
| `pnpm test --testTimeout=20000` | 43 files, 802 tests passed, 139.5 s |
| PERF-06 baseline | 10 / 100 / 400 pending rows: `load` median 6.1 / 8.7 / 11.2 ms (recorded in TESTING §8.0d) |
| Real process restart (scratch scripts, since removed) | A process stored two updates and was killed with SIGKILL; a new process recovered both paragraphs (`appliedRows: 2`, `foldedSeq: 0`); re-storing the loaded document wrote nothing (`stored: false`), which settles the "reloaded document is not stored again" question from §10.4 item 4 |

**Outcome:** no defects found on the owner's machine; no code or pin changes were needed. **D57 accepted by the owner on 2026-11-16.**

**Still not verified:** Docker `apps` profile, GitHub Actions (the Phase 5 dependencies and lockfile have never run on a clean CI runner), a single `pnpm check` run (the commands were run separately), the newest `@tiptap/y-tiptap` (3.3.0), and any browser behaviour (the web editor is not on Yjs yet).

| Date | Change |
|---|---|
| 2026-11-16 | Phase 5 verified on the owner's machine; no fixes needed; D57 accepted; DECISIONS, TESTING §8.0d and this file updated. |

## 11. Phase 6 – implementation record (2026-11-17)

### 11.1 Scope, and what the task required of the plan

Phase 6 = WebSocket server and real-time collaboration (IMPLEMENTATION_PLAN Phase 6; the task list of 16 items and the "important requirements"). It was written and executed by Claude in a **preparation environment** (Node v22.23.4 with `engine-strict` overridden, PostgreSQL 16 and Redis 7 from apt, `ws` and jsdom for clients, no real browsers, no Docker). **Nothing in this section has been run on the owner's machine.** Three decisions are **proposed and need approval**: D58 (collab may import the editor package), D59 (interim content endpoints removed; `page_contents` kept as a read-only seed source), D60 (Phase 6 server behaviour). The plan's "single instance, no Redis document extension" (D28) was followed; the task did not ask for more.

### 11.2 What was implemented

| Task item | Where |
|---|---|
| 1–3 Server, provider, document-specific connections | `apps/collab/src/server.ts` (Hocuspocus hooks), `apps/web/src/lib/collab-session.ts` (HocuspocusProvider, document name `page:<uuid>`) |
| 4 Authenticate connections | `apps/api/src/auth/collab-tokens.ts` + `routes/collab-token.ts` (`PAGE-10`), `apps/collab/src/token-verifier.ts`; keys: `scripts/generate-collab-keys.mjs` (`pnpm collab:keys` prints a pair) |
| 5, 13 Workspace/page permissions, no unauthorized subscriptions | `packages/db/src/collab-access.ts` (`resolveCollabAccess`), `apps/collab/src/access-control.ts` |
| 6–8 Initial sync, broadcast, incoming updates | Hocuspocus sync; seeding in `apps/collab/src/persistence.ts` |
| 9, 14 Subscription management, cleanup | `apps/collab/src/connection-registry.ts`; `connected` / `onDisconnect` hooks; per-user and total limits |
| 10–12 Disconnects, reconnection, temporary failures | provider backoff + a fresh token per reconnection; `CollabSession` states; store retry; flush on shutdown |
| 15 Logging and errors | structured pino logs (user id, page id, role, reason; never tokens or content), refusal reasons, `error` messages |
| 16 Connect the editor | `apps/web/src/components/editor/page-editor.tsx` (rewritten), `collab-status.tsx`, `use-collab-session.ts` |
| Permissions over time | `access-events.ts` (Redis), `revalidation.ts` (timer) |

**Removed** (D59): `CONTENT-01/02`, `savePageContent` schemas, the `contentSave` rate limit, `autosave.ts`, `save-errors.ts`, `save-status.tsx` and their tests, and the two Phase 1 shell tests `apps/collab/test/server.test.ts` and `apps/collab/test/server.int.test.ts` (they use the old server API; the owner deleted them on 2026-11-18, §11.11). **Changed:** `packages/shared` (new `collab-protocol.ts`, env schemas), `packages/db` (`collab-access.ts`), ESLint boundary rule and its test, `.env.example`, `scripts/setup.sh`, `tests/startup*.test.ts`.

### 11.3 Acceptance criteria and requirements (results in §11.8)

| Criterion | Result |
|---|---|
| Several users open the same page in different browsers and see each other's edits live | **Tested with jsdom editors on the real client code and server**, 2, 3 and 4 clients (`apps/web/test/two-browsers.int.test.ts`); **not tested in a real browser** |
| State stays consistent after disconnection and reconnection | Tested: single drop, five drops in a row, long absence, server restart, crash |
| Unauthorized users cannot access or modify documents | Tested: bad/forged/expired tokens, wrong page, no membership, deleted page, `NONE` override, revoked session, foreign origin, pre-authentication frames, read-only roles, revocation while connected |
| Persistence before durable | Nothing reports durability to clients; stores confirmed by `appendDiff`; flush on shutdown; crash test shows what is and is not recoverable |
| No unnecessary database writes | Tested: connect/idle/disconnect writes nothing; a 60-keystroke burst makes fewer than 15 rows |
| No second synchronization mechanism | Interim HTTP save removed; test asserts the editor makes no page-content request |
| Update the four documents | WEBSOCKET_PROTOCOL §17, ARCHITECTURE §23, TESTING §8.0e, this section; also DECISIONS D58–D60 and API_CONTRACTS |

### 11.4 Findings made while implementing

1. **Hocuspocus 4.8 refusal does not close the socket** (§17.1 of the protocol), and **`Connection.close` closes only the document channel**: a revoked client could keep sending on the same socket for that document. The server closes the socket too and drops any later message of a revoked connection.
2. **A failed store is not retried by the library**, and a document whose store keeps failing blocks `Server.destroy()` for ever (found by a test whose data was deleted under a running server). Added retries, dropping of documents whose page is gone, and a bounded shutdown.
3. **A dropped read-only update leaves a gap** in the client's causal history; after an upgrade to editable the client must call `forceSync()`, or its later edits wait for ever (found by a test; now a client rule, D60.4).
4. **The provider needs `attach()`** when it is given an external socket; `HocuspocusProviderConfiguration` has no `WebSocketPolyfill` type, but the forwarded option works at runtime.
5. **The delivered `pnpm-lock.yaml` was out of date** (missing the Phase 5 `yjs` entry for `packages/db`), so `pnpm install --frozen-lockfile` failed. The regenerated lockfile is part of this change; check `git diff pnpm-lock.yaml`.
6. A `.env` key line with an empty value (`COLLAB_JWT_PRIVATE_KEY=`) must mean "not set"; handled.

### 11.5 Known limitations and open items

See WEBSOCKET_PROTOCOL §17.8 (nine items). Most important: no presence (Phase 7); single instance; no offline page loading; idle-connection behaviour with no awareness traffic not observed for more than a few seconds; rate-limit values untuned; **no real-browser test, no load test (PERF/LOAD), no multi-instance test, no Docker/CI run**; `page_contents` still holds Phase 4 data (D59); production CSP and proxy must allow the WebSocket (§17.8.9). **Update 2026-11-18:** on the owner's machine a page left idle for two minutes with no one else on it stayed "Live" (§11.11); real browsers and the owner's platform are now covered for the §11.7 items. Still not covered: load, multi-instance, Docker, CI, a proxy, a CSP, longer idle, laptop sleep.

### 11.6 What the owner must do first

1. Approve or amend **D58, D59, D60**.
2. `pnpm install` (the lockfile changed), run `node scripts/generate-collab-keys.mjs --write` (it adds the two keys to your existing `.env` only if they are missing and never replaces a key) or re-run `pnpm bootstrap`, **restart the API and the collab server** (new required variables `COLLAB_JWT_PUBLIC_KEYS` for collab; without `COLLAB_JWT_PRIVATE_KEY` the API answers 503 on `PAGE-10`).
3. Run the checks in §11.7.

**Done on 2026-11-18:** D58–D60 accepted; install, keys, migration status and the §11.7 checks were run (§11.11).

### 11.7 Owner verification checklist

1. `pnpm install`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`.
2. `pnpm test --testTimeout=30000`; expected: see §11.8 (the same files; counts may differ by platform).
3. Start `pnpm dev:api`, `pnpm dev:collab`, `pnpm dev:web`. Open one page in two different browsers (two accounts, both members) and type in both: edits appear in both within a second; the indicator says "Live".
4. Add a third browser (or a private window) and repeat. Open a second page in another tab: edits do not cross.
5. Make one account a Viewer (the workspace's Members page): its editor becomes read-only within a few seconds, without reloading; make it an Editor again: editing returns.
6. Remove that member from the workspace while the page is open: its page shows "Your access to this page has ended" and the other browsers keep working.
7. Stop the collab server while typing, keep typing for a few seconds, start it again: the indicator goes Offline, then Live; nothing typed is lost and both browsers show the same text. Repeat by turning off the network of one browser (DevTools → Offline).
8. Open a page that was written in Phase 4 and never opened since: its content appears once.
9. Leave a page open and idle for two minutes (including with no one else on it): it should stay "Live". If it flaps to Offline and back, report it (limitation §17.8.6).
10. Try to open a page by its address without access: "do not have access".
11. Look at the collab log: you should see `connection opened`, `connection closed`, `connection revoked`, and no tokens or document text.

### 11.8 Execution results (preparation environment, 2026-11-17)

| Check | Result |
|---|---|
| Baseline (zip as delivered, after regenerating the lockfile and generating the Prisma client) | 43 files, 802 tests passed |
| `pnpm test --testTimeout=30000` after Phase 6 | **49 files, 878 tests passed** (about 110 s). New or rewritten: collab 62 + 9, API `PAGE-10` 9, web session 20, web editor 34, two-browsers 8, shared 17, boundaries 20, startup 9 |
| `pnpm lint`, `pnpm typecheck` | clean |
| `prettier --check .` | clean for every file Phase 6 touched; reports 22 untouched Phase 3 files and `infra/docker-compose.yml` (YAML parse error), as at the start of Phase 6 in this environment (the owner's machine did not show them in Phase 5); left alone on purpose |
| Repeat runs | collab and web integration suites twice more (79 tests, all passing); the sync suite four more times (13/13) |
| Flaky tests found | two, both test races, fixed (TESTING §8.0e) |
| Real process | `apps/collab/src/main.ts` started with generated keys, listened, and stopped on SIGTERM |
| **Not executed** | real browsers, Docker, CI, the owner's platform, load, multi-instance, idle-for-minutes, a proxy, a production CSP (TESTING §8.0e) |

### 11.9 Suggested commit message

```
feat: Phase 6 – WebSocket collaboration server and live editing

- collab: Hocuspocus server with EdDSA collaboration-token verification,
  DB-derived roles on every connection, read-only enforcement, access
  events + periodic revalidation, store retry, graceful shutdown, limits
- api: PAGE-10 collab-token endpoint; remove interim CONTENT-01/02 (D59)
- db: resolveCollabAccess shared role resolution for the collab server
- web: CollabSession + provider, live TipTap/Yjs editor, status and
  read-only/revoked handling; remove HTTP autosave
- shared: collaboration protocol schemas and env settings
- tooling: collab key generator, boundary rule collab->editor (D58)
- test: delete the superseded Phase 1 collab shell tests
  (apps/collab/test/server.test.ts, server.int.test.ts)
- docs: WEBSOCKET_PROTOCOL §17, ARCHITECTURE §23, TESTING §8.0e,
  DECISIONS D58-D60, API_CONTRACTS, HANDOVER §11
```

### 11.10 Change log (Phase 6)

2026-11-17: Phase 6 implemented and executed in a preparation environment; D58–D60 proposed; HANDOVER §11, WEBSOCKET_PROTOCOL §17, ARCHITECTURE §23, TESTING §8.0e, API_CONTRACTS, DECISIONS updated.

2026-11-18: Phase 6 verified on the owner's machine (§11.11): install, migrate status, lint, format check, typecheck (after deleting two superseded Phase 1 collab test files), 878 tests, and a manual real-browser walkthrough passed; D58–D60 accepted; HANDOVER, DECISIONS, TESTING §8.0e, WEBSOCKET_PROTOCOL §17, ARCHITECTURE §23, API_CONTRACTS, IMPLEMENTATION_PLAN and PROJECT_MASTER updated.

### 11.11 Owner verification on the owner's machine (2026-11-18)

**Environment:** Windows (Git Bash), Node v24.18.0, pnpm 12.18.0, PostgreSQL 17 (`postgres:17-alpine`, host port 5433) and Redis 7 (`redis:7-alpine`) from Compose (`docker compose -f infra/docker-compose.yml up -d --wait`), Prisma 7.10.1 (Prisma offered 8.0.0-rc.34; not adopted). The browsers used, their versions, the CPU and the RAM were not recorded.

| Command / check | Result |
|---|---|
| Compose services | PostgreSQL and Redis healthy |
| `pnpm install` | Already up to date (the regenerated lockfile was in place) |
| Collaboration keys | `.env` held a non-empty `COLLAB_JWT_PRIVATE_KEY` and `COLLAB_JWT_PUBLIC_KEYS` (checked by counting matching lines; the values were not shown) |
| `pnpm db:migrate:status` | 5 migrations found; schema up to date (Phase 6 adds no migration) |
| `pnpm lint` | Clean |
| `pnpm format:check` | Clean; the 22 Phase 3 files and `infra/docker-compose.yml` that the preparation environment reported did not appear |
| `pnpm typecheck`, first run | **Failed in `apps/collab` with 10 errors, all in `test/server.test.ts` and `test/server.int.test.ts`** (the Phase 1 shell tests): they still used the old server API (`port`, `listen`, `address`, `destroy`, `configuration`, and a `Dependencies` object without `prisma` and `createSubscriber`). The failures reported for `shared`, `api`, `web` and `db` were collateral of `pnpm -r --parallel` stopping. Cause: the Phase 6 delivery said to delete these files and the owner had not yet done so. |
| `pnpm typecheck`, after deleting those two files | Clean in all projects |
| `pnpm test --testTimeout=30000` | **49 files, 878 tests passed**; duration 185.56 s (tests 65 %, import 19 %, environment 13 %, transform 3 %) |

**Manual walkthrough in real browsers** (owner-reported as working; no per-step detail, timings or screenshots were recorded). Two accounts in two different browsers, both members of one workspace:

- Edits typed in either browser appeared in the other, simultaneous typing in different places lost nothing and both views ended identical, and the indicator said "Live" (§11.7 items 3 and 4); edits on a second page did not appear on the first.
- Role change to Viewer: the editor became read-only without a reload, and after changing back to Editor the edits reached the other browser (item 5, including the `forceSync()` case of §11.4 finding 3). Removal from the workspace while the page was open: "Your access to this page has ended" in the removed browser, the other kept working (item 6). Opening the page by its address without access showed the no-access message (item 10).
- Stopping and restarting the collab server while both browsers typed, and setting one browser Offline in DevTools: the indicator went Offline then Live again, nothing typed was lost and both browsers showed the same text (item 7).
- A page written in Phase 4 and not opened since appeared once, also after a reload (item 8; D59).
- A page left idle for two minutes with nobody else on it stayed "Live" (item 9; limitation §17.8.6 did not show up in this single observation).

**Not reported, so not claimed:** a third browser (item 4, optional); inspection of the collab log for item 11; how many seconds the Viewer change and the removal took to appear; the browser names and versions.

**Outcome:** no defect in the Phase 6 code was found; the only failure was the two undeleted Phase 1 test files, a delivery step, not a code change. **D58, D59 and D60 were accepted by the owner on 2026-11-18.**

**Still not verified:** Docker `apps` profile, GitHub Actions (the Phase 5 and Phase 6 lockfile changes have not run on a clean runner), a single `pnpm check` run (the commands were run separately), load and PERF measurements, more than a few concurrent editors in real browsers, two collab instances, a reverse proxy, a production CSP, idle longer than two minutes, laptop sleep, and automated browser E2E (Playwright).

| Date | Change |
|---|---|
| 2026-11-18 | Phase 6 verified on the owner's machine; the two superseded Phase 1 collab test files deleted; D58–D60 accepted; documents updated. |

---

## 12. Phase 7 – implementation record (2026-11-18)

### 12.1 Scope

Phase 7 = Presence and Collaborative UI (IMPLEMENTATION_PLAN Phase 7; FR-PR-01 … FR-PR-05): Yjs awareness, collaborator carets and selections, avatars, online list, join/leave notices, with identity the client cannot forge. Written and executed by Claude in a preparation environment (Node v22.23.5, PostgreSQL 16, Redis 7; TESTING §8.0f). Stopped after Phase 7. Database and REST API: no changes.

### 12.2 What was implemented

- **`packages/shared/src/presence.ts`** (new): the awareness state shape, strict cursor schema, `sanitizeClientAwareness` (server side), `parseRelayedAwareness` (client side), `deriveCollaborators` (one entry per person), avatar helpers, constants. New env setting `COLLAB_MAX_AWARENESS_PER_SECOND` (default 30).
- **`apps/collab`**: `presence.ts` (`PresenceGuard`) and the `beforeHandleAwareness` hook replace the Phase 6 "discard awareness" rule. The server stamps `{ id, name, color }` from PostgreSQL (loaded once per connection in `access-control.ts`), keeps only a validated cursor, binds each connection to one awareness client id (`connection-registry.ts`), lets a reconnection by the same user take its id over, rate-limits awareness, and never stores it.
- **`packages/editor/src/presence-caret.ts`** (new) and `collaboration.ts`: carets with name labels and selection highlights as decorations, outgoing cursor throttled to one change per 80 ms; `createCollaborativeRegistry(doc, { awareness })`. No new dependency (the Yjs cursor plugin comes with TipTap).
- **`apps/web`**: `CollabSession` owns a long-lived awareness that survives provider rebuilds and republishes after sync; `presence-tracker.ts`, `use-presence.ts`, `presence-bar.tsx` (avatar stack, "N online", keyboard-operable list, polite live announcements), caret CSS in `globals.css`, wired into `page-editor.tsx`.
- **Docs:** WEBSOCKET_PROTOCOL §18, DECISIONS D61 (proposed), TESTING §8.0f, ARCHITECTURE, IMPLEMENTATION_PLAN, PROJECT_MASTER, this section.

### 12.3 Requirements and acceptance criteria

| Item | Result |
|---|---|
| Multiple collaborators in the same document; consistent identity | Passed in jsdom tests (two and three simultaneous editors); colour comes from the stored presence colour, so it is the same in every session. |
| Cursors move in real time; selection highlighting | Passed in jsdom tests; seen working in real browsers by the owner on 2026-11-19 (§12.11). |
| Disconnected users disappear | Passed: clean close, cut network, revocation. A silent vanish expires after the y-protocols 30 s constant (tested with an aged record, not 30 s of wall-clock time). |
| Presence correct during reconnection | Passed: same client id after a provider reconnect, and after "Reconnect now" (provider rebuilt). |
| Client identity not trusted; bound to the authenticated user | Passed: forged id, name, colour and email never reach other clients; client-id squatting and removing another person's presence are dropped. |
| Document access enforced; no private data | Only users with page access are connected at all (Phase 6); awareness holds id, display name and colour, never an email. |
| Presence not persisted | Passed: no `document_updates` rows from presence alone; stored updates contain no names or ids. |
| Tests pass across multiple browser sessions | Passed with jsdom editors; real browsers checked by the owner on 2026-11-19 (§12.11). |

### 12.4 Findings made while implementing

1. **y-protocols ignores a client's first awareness update** (clock 0), so a person who has not moved a cursor would never show up. Fixed by republishing after sync (WEBSOCKET_PROTOCOL §18.3). This also keeps a reconnection under the same client id visible.
2. **The awareness timeout is not configurable** (`outdatedTimeout` is a constant of 30 s). A planned environment setting was removed.
3. **`HocuspocusProvider.destroy()` destroys the awareness it was given**; the session therefore wraps it so it lives as long as the document.
4. **Reconnection needs an id takeover** on the server, otherwise the old connection closing later would remove the new connection's presence.
5. **Deviation from WEBSOCKET_PROTOCOL §6:** names and colours are stamped by the server rather than resolved from REST (D61, accepted by the owner on 2026-11-19).
6. **Phase 6 limitation 17.8 item 6 (idle connections)** changes: awareness is now renewed every 15 s. Not re-tested for long idle runs.

### 12.5 Known limitations and open items

Real-browser rendering was checked by the owner on 2026-11-19 (§12.11), who reported no problems with label position, clipping or avatar layout. Names and colours update on the next connection. A person's other tab is shown as a caret with their own name. Join/leave notices are suppressed for the first 1.5 s after connecting. No avatar images (U7). Multi-instance presence is Phase 9. See also WEBSOCKET_PROTOCOL §18.7.

### 12.6 What the owner must do first

D61 was accepted on 2026-11-19. Merge the files from this phase, run `pnpm install` (no dependency changes), `pnpm build:packages`, and then the checks below.

### 12.7 Owner verification checklist

1. `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test --testTimeout=30000` (expect 55 files, 966 tests on a machine like the preparation environment; counts may differ slightly if your Phase 6 tree differs).
2. Two different browsers, two accounts in one workspace, the same page: both appear in the avatar stack and as "2 online"; each sees the other's caret with the right name and colour, and a coloured selection while the other selects text; carets move while typing; labels are readable and do not cover the text being typed.
3. Open a third account as a viewer: it appears, its cursor shows, and it cannot edit.
4. Open the same page in a second tab as one of the users: the list still shows one entry for that person ("2 tabs" in the list).
5. Close one browser: the person disappears and "… left" is announced after about 3 s. Stop the network (browser offline mode) for 10 s, then restore: presence returns without a duplicate.
6. Click into the editor of one account and out of it: its caret disappears for the other.
7. Check that nothing about presence is saved: reload the page with nobody else there; no carets and no names in the content.

### 12.8 Execution results (preparation environment, 2026-11-18)

Baseline 49 files / 878 tests; after: **55 files / 966 tests passed (146 s)**; `eslint .` clean; `tsc --noEmit` clean in all six packages and apps; `prettier --check` clean for all changed files (the repository-wide check fails only on `infra/docker-compose.yml`, untouched). Details and the list of what was not tested: TESTING §8.0f.

### 12.9 Suggested commit message

```
feat: Phase 7 – presence and collaborative cursors

- collab: PresenceGuard replaces the discard-all awareness rule; relayed
  identity is built by the server (id/name/colour from the token and
  PostgreSQL), one awareness client id per connection, reconnection
  takeover, validated cursor only, awareness rate limit; nothing stored
- editor: collaborator caret and selection decorations with name labels,
  throttled cursor publishing
- web: session-owned awareness that survives provider rebuilds; avatar
  stack, online list (one entry per person), join/leave notices with grace
  period, caret styles
- shared: presence schemas and helpers, COLLAB_MAX_AWARENESS_PER_SECOND
- test: presence unit, editor, collab integration and multi-session tests;
  abuse test updated (awareness is no longer discarded)
- docs: WEBSOCKET_PROTOCOL §18, DECISIONS D61 (proposed), TESTING §8.0f,
  ARCHITECTURE, IMPLEMENTATION_PLAN, HANDOVER §12
```

### 12.10 Change log (Phase 7)

New: `packages/shared/src/presence.ts`, `presence.test.ts`; `packages/editor/src/presence-caret.ts`, `presence-caret.test.ts`; `apps/collab/src/presence.ts`; `apps/collab/test/presence.int.test.ts`; `apps/web/src/lib/presence-tracker.ts`, `presence-tracker.test.ts`, `use-presence.ts`; `apps/web/src/components/editor/presence-bar.tsx`, `presence-bar.test.tsx`; `apps/web/test/presence-browsers.int.test.ts`. Changed: see PHASE7_FILES.txt in the delivered archive.

2026-11-19: Phase 7 verified on the owner's machine (§12.11); D61 accepted; ARCHITECTURE, DECISIONS, IMPLEMENTATION_PLAN, PROJECT_MASTER, TESTING, WEBSOCKET_PROTOCOL and this file updated.

### 12.11 Owner verification (2026-11-19)

**Environment:** the owner's Windows machine (Git Bash), PostgreSQL and Redis from Compose (`docker compose -f infra/docker-compose.yml up -d --wait`). Browser names and versions were not recorded.

| Step | Result |
|---|---|
| `pnpm install`, `pnpm build:packages`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Passed (owner-reported) |
| `pnpm test --testTimeout=30000`, first full run | **55 files, 965 of 966 tests passed (54 files passed, 1 failed), 257.73 s.** The failure: `apps/collab/test/sync.int.test.ts` > persistence (PERSIST) > "keeps a document in memory and retries when PostgreSQL fails to store"; `expect(local.collab.persistence.failingDocuments).toBe(0)` (line 231) received 1 |
| That file alone, `pnpm test apps/collab/test/sync.int.test.ts --testTimeout=30000` | Passed 13 of 13 on four runs of 9–10 s each. (A first attempt through `pnpm vitest run` skipped all 13 tests because `DATABASE_URL` and `REDIS_URL` were not loaded; the `pnpm test` script reads `.env`.) |
| API, collab and web started (`pnpm dev:api`, `pnpm dev:collab`, `pnpm dev:web`); login | Worked (owner-reported) |
| §12.7 item 2: two browsers, two accounts, one page | Reported as expected: both people in the avatar stack and "2 online", carets with name and colour, selection highlight, carets moving while typing, readable labels |
| §12.7 item 7: nothing about presence saved | Reported as expected: after closing the second browser and reloading, no carets, names or presence in the content |
| §12.7 items 3–6: Viewer, second tab, close and offline, focus and blur | Reported as expected: the Viewer appeared with a visible cursor and could not edit; one entry per person for two tabs; presence left and returned without a duplicate; the caret disappeared on blur |

The checks were reported as "all good" per group; no per-step detail, screenshots or timings were recorded.

**The failed test is a Phase 6 test, not a Phase 7 one.** It passed in isolation every time, so it is flaky under the load of 55 parallel workers on a laptop. Likely cause (a hypothesis, not proven): the test asserts the counter once, right after the stored row appears, while the persistence code may clear the counter a moment later. A possible fix is to wait for it, `await until(() => local.collab.persistence.failingDocuments === 0, 'failing flag cleared')`. **The owner decided not to change the test.** Treat it as a known flaky test; the same failure may appear in a full run, in CI included.

**Decision:** D61 accepted by the owner on 2026-11-19.

**Still not verified:** Docker `apps` profile; GitHub Actions; a single `pnpm check` run (the commands were run separately); idle longer than two minutes with the 15 s awareness renewal; the 30 s expiry in wall-clock time; more than three concurrent users in real browsers; a profile change while connected; two collab instances (Phase 9); automated browser E2E (Playwright, AC-7.1).
## 13. Phase 8 – implementation record (2026-11-19)

### 13.1 Scope

Phase 8 = Comments and Version History (IMPLEMENTATION_PLAN Phase 8; FR-CM-01 … 06, FR-VH-01 … 06): anchored threads with replies, resolve, reopen and delete; automatic and manual snapshots with contributors; version list and read-only view; restore as a new transaction that is safe against concurrent editing. Written and executed by Claude in a preparation environment (Node v22.23.5, PostgreSQL 16, Redis 7; no Docker; Prisma's schema engine could not be downloaded). Stopped after Phase 8.

### 13.2 What was implemented

- **`packages/db`:** models `DocumentSnapshot`, `CommentThread`, `Comment`, enums `SnapshotKind`, `AnchorStatus`, restore-barrier columns on `DocumentState`; migration `20261119120000_comments_versions` (hand-written, with CHECKs and an immutability trigger); `SnapshotStore` (create with contributors, AUTO skip and pruning, state load); `DocumentStore` barrier (`acquireRestoreBarrier`, `releaseRestoreBarrier`, `isRestoring`, `restoreToken` option, `DocumentRestoringError`).
- **`packages/shared`:** `comments.ts` (REST schemas, page-event schema and channel), new server messages and the `version.create` / `version.restore` command schemas in `collab-protocol.ts`; four new collab settings in `env.ts`.
- **`apps/api`:** `routes/comments.ts` (CMT-01 … 06), `routes/versions.ts` (VER-01 … 03), `workspaces/page-events.ts` (publisher), six new activity actions.
- **`apps/collab`:** `versions.ts` (`VersionService`: manual and automatic snapshots, `page.edited` tracking, restore with barrier, gate and delta, anchor re-evaluation, cross-instance catch-up), `page-events.ts` (Redis listener), hooks in `server.ts` (`onStateless` commands, write gate in `beforeHandleMessage`, `onChange`, `beforeUnloadDocument`), a `publish` dependency, a token provider in `persistence.ts`.
- **`packages/editor`:** `comment-anchors.ts` (anchors, resolution, server-side status, `planRestore`), `comment-highlights.ts` (decorations plugin), content helpers split into `collaboration-content.ts`.
- **`apps/web`:** `CollabSession` commands, answers and refetch signals; `comments-panel.tsx`, `version-history.tsx` (list, save, read-only preview, restore with confirmation), page editor integration, `useReloadOn`, highlight CSS, API client methods.
- **Docs:** DATABASE_SCHEMA §15, API_CONTRACTS §16, WEBSOCKET_PROTOCOL §19, ARCHITECTURE §24 (and V10), DECISIONS D62 and D63 (U8, U11 resolved), TESTING §8.0g, IMPLEMENTATION_PLAN status, this section.

### 13.3 Requirements and acceptance criteria

| Item | Result |
|---|---|
| AC-8.1 anchors follow content | Passed (editor tests, two real editors, insertions before and inside the range, concurrent edits). Edge: typing exactly at index 0 of a paragraph joins a range that starts at that paragraph's first character (D63). |
| AC-8.2 Commenter on a read-only connection; Viewer cannot | Passed (API tests for every endpoint; UI test for a read-only Commenter). |
| AC-8.3 deleted text → detached with quoted text | Passed (editors, bare `Y.Doc`, UI shows the badge and the quote; the server also stores the status after a restore). Detachment caused by ordinary editing is decided live by clients, not stored. |
| AC-8.4 create and restore only over read-write | Passed (Commenter and Viewer get `FORBIDDEN`; role re-read at command time, tested with a demotion that no event announced). |
| AC-8.5 restore safety | Passed: PRE_RESTORE committed before anything changes; fault injection at the snapshot, at planning and with an invalid snapshot leaves the document unchanged and the barrier released; snapshots cannot be updated (trigger) and are never deleted by a restore. |
| AC-8.6 restore convergence across two instances | **Partly met.** Tested: the barrier in PostgreSQL stops the second instance's store and its held edit is stored after release; everything stored by the second instance before the barrier is in the PRE_RESTORE snapshot; the restore reaches a client on the second instance through the `document.restored` event; with one instance, clients converge, writes during the restore are held back and merge after `forceSync`, nothing accepted before the barrier is lost. **Not tested and not possible yet:** ordinary edits made on two instances reaching each other live (Redis document sync is Phase 9), so a second instance's clients keep typing against stale content during the barrier and see the restore only through the event. |
| AC-8.7 second restore → CONFLICT | Passed (overlapping, and simultaneous requests). |
| AC-8.8 version endpoints and viewer | Passed (API tests; UI test shows the stored content read-only and leaves the live page untouched). No browser E2E. |
| AC-8.9 contributors | Passed (DB and collab tests, throttle reset after each snapshot). |
| AC-8.10 `comments.changed` and refetch after reconnect | Passed (API publishes after commit only; collab relays to the page only; session refetches on event and on every sync). |
| AC-8.11 U8, U11, V10 | Recorded: U8 and U11 in D63 (activity-log pruning left to Phase 10), V10 in ARCHITECTURE §18. |
| Part A item 9 (comment notifications "where in scope") | Not in scope in the plan beyond the real-time `comments.changed` signal; no e-mail, mention or in-app notification was built. |

### 13.4 Findings made while implementing

1. Throwing in Hocuspocus `beforeHandleMessage` closes the connection, so the restore gate sets `connection.readOnly` instead (D62).
2. An update always carries the whole delete set, so "is the delta empty" cannot be read from its size; `planRestore` compares coverage before and after.
3. The collaboration server's Redis client is lazy and does not queue, so publishing needs an explicit connect (a real bug, found by the cross-instance test).
4. y-tiptap cannot resolve a character-level relative position at index 0 of a text node (D63, edge).
5. The editor's sync plugin opens an empty Yjs transaction on every update; reacting to it looped (fixed).
6. Every transaction of ProseMirror's structural diff keeps unchanged paragraphs, so comment anchors on unchanged text survive a restore: a useful consequence, tested.
7. Tests that create several rows with the fake clock must advance it: rows with equal `createdAt` are ordered by random id.

### 13.5 What the owner must do first

1. Merge the files, run `pnpm install` (no dependency changes), `pnpm db:migrate:deploy`, `pnpm db:migrate:status`, and the scratch-database drift check (`pnpm db:migrate:dev` against an empty database; **it must produce no new migration**). The migration SQL was written to match Prisma's naming without the schema engine; if the drift check wants changes, regenerate this one migration.
2. Add the four new settings to `.env` if you keep your own copy (defaults exist): `COLLAB_AUTO_SNAPSHOT_INTERVAL_MS`, `COLLAB_AUTO_SNAPSHOT_KEEP`, `COLLAB_EDIT_ACTIVITY_INTERVAL_MS`, `COLLAB_RESTORE_BARRIER_TTL_MS`.
3. `pnpm build:packages`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test --testTimeout=30000` (expect 61 files, 1077 tests on a machine like the preparation environment).

### 13.6 Known limitations and open items

- AC-8.6 across instances: see §13.3 (Phase 9).
- Text typed into content that a restore replaced is not shown afterwards (as with any concurrent deletion).
- Restore and snapshots use memory for extra copies of the document; no size limit yet (Phase 10, PERF-05/06).
- Comments cannot be edited; no notifications; re-anchoring detached threads by text is not built (U8).
- A thread deleted by deleting all its comments cannot be restored.
- Detachment from ordinary editing is shown live but not stored; the API's `anchorStatus` reflects the last restore only.
- Activity-log pruning is not implemented (U11, Phase 10).

### 13.7 Owner verification checklist

1. Two browsers, two accounts (an Editor and a Commenter) on one page. Select text in the Editor's browser, open **Comments**, comment: the highlight appears in both browsers within a moment. Reply from the Commenter's browser, resolve, reopen.
2. Type before, inside and after the commented text in the other browser: the highlight stays on the same words and grows only for text typed inside it.
3. Delete all the commented text: the thread stays, marked "Detached", with its quote.
4. Log in as a Viewer: comments are readable, no way to add or reply.
5. Open **Version history**, **Save version** with a name. Keep typing, then open the version: it shows the old content read-only and the live page is unchanged.
6. In the Editor's browser restore that version and confirm: both browsers show the old content; a "Before a restore" entry exists with the content that was replaced; view it and restore it to undo.
7. While one browser restores, type in the other: typing pauses with a notice and resumes after; refresh both: the same content.
8. Stop the collab server during a page edit session and start it: nothing lost; versions still listed.
9. Check the database: `UPDATE document_snapshots SET label='x'` fails.

### 13.8 Execution results (preparation environment, 2026-11-19)

Baseline 55 files / 966 tests (137 s); after: **61 files / 1077 tests passed (172 s)**, `--testTimeout=30000`; `eslint apps packages` clean; `tsc --noEmit` clean in all packages (`pnpm typecheck`); `prettier --check apps packages` clean. A first full run had one failure, a test of mine that depended on two rows having different timestamps (fixed); the second full run was clean. Not run: browsers, Docker, Node 24, `migrate deploy`, the drift check.

### 13.9 Suggested commit message

```
feat: Phase 8 – comments and version history

- db: DocumentSnapshot, CommentThread, Comment, SnapshotKind, AnchorStatus;
  restore barrier columns on document_states; SnapshotStore; DocumentStore
  barrier (token, expiry, DocumentRestoringError); immutable snapshots
  (trigger), CHECKs; migration 20261119120000_comments_versions
- api: CMT-01..06 threads/replies/resolve/reopen/delete, VER-01..03 list,
  detail and binary state; comments.changed page event after commit
- collab: VersionService – manual and automatic snapshots, contributors via
  page.edited, restore as one Yjs transaction behind a PostgreSQL barrier,
  in-process write gate, PRE_RESTORE snapshot, anchor re-evaluation,
  cross-instance catch-up; Redis page-event listener; version.* commands
- editor: comment anchors (Yjs relative positions), highlight decorations,
  planRestore (structural diff delta, applied atomically)
- web: comments panel, version history with read-only preview and restore,
  editor paused during a restore, refetch on events and reconnect
- shared: comment/version schemas, new server messages, page-event schema,
  four collab settings
- test: 111 new tests (api, db, editor, collab integration, web); 61 files,
  1077 tests passing
- docs: DATABASE_SCHEMA §15, API_CONTRACTS §16, WEBSOCKET_PROTOCOL §19,
  ARCHITECTURE §24, DECISIONS D62/D63 (U8, U11, V10), TESTING §8.0g,
  HANDOVER §13
```

### 13.10 Change log (Phase 8)

New: `packages/db/src/snapshots.ts`, migration `20261119120000_comments_versions`, `packages/db/test/versions.int.test.ts`; `packages/shared/src/comments.ts`; `apps/api/src/routes/comments.ts`, `routes/versions.ts`, `workspaces/page-events.ts`, `test/comments.int.test.ts`, `test/versions.int.test.ts`; `apps/collab/src/versions.ts`, `page-events.ts`, `test/versions.int.test.ts`; `packages/editor/src/comment-anchors.ts`, `comment-highlights.ts`, `collaboration-content.ts`, `comment-anchors.test.ts`; `apps/web/src/components/editor/comments-panel.tsx`, `version-history.tsx`, `comments-versions.test.tsx`.
Changed: `packages/db` (schema, document store, index), `packages/shared` (protocol, env, index), `apps/api` (route registration, activity), `apps/collab` (server, persistence, config, dependencies, harness), `packages/editor/src/collaboration.ts`, `apps/web` (collab session and test, API client, page editor and test, page view, use-load, CSS), `.env.example`, and the docs listed in §13.2.

2026-11-20: Phase 8 verified on the owner's machine (§13.11); one test corrected (`apps/collab/test/versions.int.test.ts`, a test-ordering bug, no code change); D62 and D63 accepted; ARCHITECTURE, DECISIONS, IMPLEMENTATION_PLAN, PROJECT_MASTER, TESTING, WEBSOCKET_PROTOCOL, API_CONTRACTS and this file updated.

### 13.11 Owner verification (2026-11-20)

**Environment:** the owner's Windows machine (Git Bash), PostgreSQL 17 and Redis 7 from Compose (`pnpm infra:up`, PostgreSQL on host port 5433); pnpm 12.18.0, Vitest 5.1.0, Prisma 7.10.1. The Node version and browser names and versions were not recorded in this session.

| Step | Result |
|---|---|
| `pnpm infra:up`, `pnpm install` | Redis and PostgreSQL healthy; install already up to date |
| `pnpm db:migrate:deploy`, `pnpm db:migrate:status` | 6 migrations found; `20261119120000_comments_versions` applied; "Database schema is up to date!" (the Prisma CLI printed an update notice for 8.0.0-rc.34; not applied) |
| Scratch-database drift check (`pnpm db:migrate:dev` against an empty `conote_scratch`) | The scratch database from an earlier phase already existed, so it was dropped and created again. All 6 migrations applied from empty; "Your database is now in sync with your schema"; **no new migration was proposed**, so the hand-written SQL matches `schema.prisma`. `git status` showed only the not yet committed Phase 8 migration folder |
| `pnpm build:packages`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Passed (owner-reported; whether `format:check` still lists `infra/docker-compose.yml` was not recorded) |
| `pnpm test --testTimeout=30000`, first full run | **61 files, 1076 of 1077 tests passed, 265.11 s.** The failure: `apps/collab/test/versions.int.test.ts` > "the barrier across collaboration instances (D62, AC-8.6)" > "stops a second instance storing while the restore runs, and lets it store afterwards: nothing is lost"; line 589, `expect(await new DocumentStore(first.prisma).isRestoring(pageId)).toBe(true)` received `false` |
| That file alone (26 of 27 passed), that test alone | Failed every time: deterministic, so not the load problem seen in Phase 6 and 7 |
| Cause | **A test-ordering bug, not a defect in the code.** `VersionService.isRestoring()` reports the in-process gate, which `restore()` raises synchronously at its start, before the PostgreSQL barrier is acquired (after the awaited role check and the awaited load of the snapshot). The test read the database barrier immediately after the gate went up. The order in the code (gate first) is the intended, conservative one (D62) |
| Fix (test only) | In `apps/collab/test/versions.int.test.ts` the test waits for the gate and then for the barrier in PostgreSQL (`until(async () => await store.isRestoring(pageId), 'barrier up in PostgreSQL')`) before asserting. The file then passed **27 of 27** (16.92 s). The `DocumentRestoringError` lines on stderr are the second instance's refused stores, which this test expects |
| §13.7 items 1–4 (comments) | Two browsers (Editor and Commenter) plus a Viewer: create from a selection, highlight in both browsers, reply, resolve, reopen; highlight stays on the same words when text is typed before, inside and after; deleting all the commented text leaves the thread marked detached with its quote; Viewer can read but not add or reply. Reported as working |
| §13.7 items 5–9 (versions) | Save version; read-only view of an old version with the live page unchanged; restore, with a "Before a restore" entry created and used to undo; typing in the other browser during a restore (paused with a notice, then resumed; both browsers identical after a refresh); collaboration-server restart without losing content or versions; `UPDATE document_snapshots SET label='x'` rejected. Reported as working |

The browser checks were reported per group ("all worked", "everything passes"); no per-step detail, screenshots or timings were recorded.

**Decisions:** D62 and D63 accepted by the owner on 2026-11-20 (U8 and U11 resolved as recorded in D63).

**Files that must be part of the commit:** the new migration folder `packages/db/prisma/migrations/20261119120000_comments_versions/` (untracked when the drift check ran) and the corrected `apps/collab/test/versions.int.test.ts`.

**Still not verified:** a full-suite run after the test fix (1077 of 1077 expected; the known flaky Phase 6 test in `sync.int.test.ts` did not fail in this run but may fail under load); Docker `apps` profile; GitHub Actions; two collaboration instances in real browsers, that is live convergence of ordinary edits across instances (Phase 9, AC-8.6); more than two concurrent users; restore of very large documents (Phase 10); automated browser E2E (Playwright).