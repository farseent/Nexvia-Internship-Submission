# CoNote – Testing Strategy

**Status:** Phase 1a test foundation (reported passing by the owner: 9 files, 59 tests) plus **Phase 2 authentication tests, run by Claude in a preparation environment: 17 files, 228 tests passed (115 unit + 113 integration), twice in a row** (§8.0a). The Phase 1b spike harness is under `spikes/collab-poc/`. **Phase 3 tests were run by the owner on 2026-11-15 against PostgreSQL and Redis: `pnpm check` passed with 482 tests** (§8.0b). **Phase 5 (Yjs integration) tests were run by the owner on 2026-11-16: 43 files, 802 tests passed on Node 24.18.0 and PostgreSQL 17** (§8.0d). There is no network collaboration yet (Phase 6), so no collaboration test runs through a server or a browser. **Browser E2E (Playwright) is not implemented.**
**Last updated:** 2026-11-21 (owner verification of Phase 9 recorded in §8.0e (Phase 9); Phase 8 tests added: §8.0g; owner verification of Phase 8 recorded in §8.0g)

Decision IDs (`D#`, `U#`) are in [DECISIONS.md](DECISIONS.md); requirements and metrics (`FR-*`, `NFR-*`, `PERF-*`) in [PROJECT_MASTER.md](PROJECT_MASTER.md); guarantees `G1`–`G7` in [ARCHITECTURE.md](ARCHITECTURE.md) §8; phases and acceptance criteria (`AC-*`) in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 1. Principles

1. **Tests are evidence.** A feature or guarantee is "done" only when named tests pass. Documentation must not claim more than the tests show (D14).
2. **No invented results.** This document defines *how* to measure. It contains no measured values, targets or expected numbers. Results are recorded only after they are measured, together with the environment (§10).
3. **Test at the right level.** Pure logic in unit tests; real PostgreSQL/Redis for integration and database tests (no mocking of the database for persistence or permission queries); real WebSocket servers for collaboration tests.
4. **Deterministic by default.** Randomized tests use a logged seed; time is controllable; failures must be reproducible from the log.
5. **Security and permissions are tested as first-class behaviour**, from both REST and WebSocket.
6. **Every phase ships its tests** (Definition of Done, IMPLEMENTATION_PLAN §1).

## 2. Tooling (D26)

| Purpose | Tool |
|---|---|
| Unit, integration, API, database, WebSocket tests | Vitest 5.1.0 |
| Multi-browser and end-to-end tests | Playwright 1.65.0 (Chromium, Firefox, WebKit) |
| Collaboration, reconnection, recovery and load tests | Custom **Node.js Yjs client harness** (headless clients using `yjs`, `y-protocols`, `@hocuspocus/provider`) driven from Vitest or standalone scripts |
| HTTP API tests | Fastify's in-process `inject` where possible; real HTTP through the Next.js rewrite for proxy/cookie tests |
| Infrastructure | Docker Compose services: PostgreSQL 17, Redis 7.x, S3-compatible storage |
| Static checks | ESLint (module boundaries, ARCHITECTURE §5), TypeScript strict |

Versions are exact pins (D13); changes follow DECISIONS.md.

## 3. Test categories

Each category has an abbreviation used throughout the plan and in test names/ids. Test ids follow `<CAT>-<AREA>-<nn>` (e.g. `PERM-PAGE-07`) and are assigned when a test is written.

| Cat. | Name | What it covers | Real dependencies | Runs |
|---|---|---|---|---|
| `UT` | Unit | Pure functions: permission resolution, validation schemas, token claims, Yjs utilities, hashing helpers | none | every PR |
| `IT` | Integration | Several modules together: services with a real DB, proxy path, job runners, document store with Redis events | PostgreSQL, Redis | every PR |
| `API` | API | Every REST endpoint: success, each documented error code, validation, authentication, authorization, envelope shape | PostgreSQL, Redis, storage | every PR |
| `DB` | Database | Constraints, partial unique indexes, cascades, row locking under parallel transactions, migrations from scratch and from the previous migration | PostgreSQL | every PR |
| `WS` | WebSocket | Connection, authentication hook, read-only enforcement, application messages, close reasons, abuse handling | collab server, PostgreSQL, Redis | every PR |
| `CE` | Concurrent editing | Convergence of many replicas under randomized concurrent edits, delivery reordering, duplication and offline periods | collab server (and in-process Y.Docs), PostgreSQL | short seeds every PR; long seeds nightly |
| `MB` | Multi-browser | Two or more real browsers/contexts collaborating through the UI | full stack | nightly; smoke subset per PR |
| `PERM` | Permission | Role × action × resource matrix over REST and WebSocket, inheritance, revocation | full stack | every PR |
| `RECON` | Reconnection | Network drops, token refresh, offline edits merging, instance switch | collab, proxy to simulate drops | nightly; subset per PR |
| `REC` | Recovery | Process kill and restart, compaction fault injection, backup/restore | collab, PostgreSQL | nightly; subset per PR |
| `LOAD` | Load | Performance and capacity measurement (PERF-01 … PERF-07) | multi-instance stack | on demand, before release |
| `E2E` | End-to-end | User journeys through the browser | full stack | every PR (smoke), nightly (full) |
| `SEC` | Security | Authentication, session, cookie, CSRF, token, upload, injection and abuse tests | full stack | every PR (fast), pre-release (full) |
| `GT` | Guarantee | Tests that specifically evidence G1–G7 (tagged subset of the above) | as needed | every PR / nightly |

## 4. Environments and test data

- **Isolation:** each Vitest worker uses its own PostgreSQL database (created from a migrated template) and its own Redis key prefix or database number. Tests never share mutable state.
- **Time:** services accept an injectable clock; session expiry, invitation expiry, throttles and revalidation are tested with a controlled clock, not real waiting.
- **Fixtures:** factories create users, workspaces, members of each role, page trees and permission overrides. A seed script (Phase 3) builds the dev dataset; tests do not depend on it.
- **Secrets:** tests use throw-away keys (an Ed25519 pair generated per run); no real credentials; nothing is committed.
- **Browsers:** Playwright uses separate browser contexts for separate users (isolated cookies and storage).
- **Network faults:** a TCP/WebSocket fault-injection proxy (written for the harness) sits between clients and the collab server to drop, delay or sever connections deterministically.
- **Process faults:** the harness starts/kills collab processes directly to test crashes and restarts.

## 5. Test design by area

### 5.1 Unit tests (`UT`)

- **Permission resolution (D23):** exhaustive table over workspace role × page override × inheritance depth; `NONE` denies; Admin/Owner cannot be restricted; non-members denied; deleted-page handling.
- **Validation:** each Zod schema accepts valid and rejects invalid inputs, unknown fields rejected.
- **Token logic:** collaboration-token claims, expiry, audience, key selection by `kid`.
- **Yjs utilities:** diff computation against a persisted vector, per-client maximum vector merge, empty-document handling.
- **Fractional-index `position`** generation (ordering and insertion between siblings).

### 5.2 Database tests (`DB`)

- Every SQL constraint in DATABASE_SCHEMA §5 is tested for acceptance and rejection. Owner invariant tests cover both at-most-one (partial unique index) and at-least-one (deferred constraint trigger), including create, transfer, member removal, rollback and direct SQL attempts to commit a workspace with zero owners.
- Cascade behaviour per DATABASE_SCHEMA §8 (workspace → pages → document data → comments; user deletion nulling references).
- **Document locking:** parallel stores on the same page serialize and lose no data; stores for different pages do not block each other. **Workspace tree locking:** concurrent moves/create/delete/restore operations serialize on the workspace-tree advisory lock; tests attempt opposing moves that would create a cycle, simultaneous cross-workspace moves and depth-limit races. The composite parent FK rejects cross-workspace parent references even when service validation is bypassed.
- Migrations: apply from scratch; apply on top of the previous release's schema.

### 5.3 API tests (`API`)

For each endpoint id in API_CONTRACTS.md: success path; each documented error code; missing authentication; insufficient role (`403`) vs no access (`404`); validation failures; envelope shape; pagination where applicable; rate-limit behaviour on limited endpoints. Side effects are asserted (activity entries, Redis events published, DB rows).

### 5.4 WebSocket tests (`WS`)

- Authentication: valid token; expired; bad signature; wrong `aud`/`iss`; `pid` mismatch; token for a different page; deleted page; revoked session; JWT `alg` confusion (`none`, HS256 with the public key as secret) rejected.
- Authorization: Viewer/Commenter read-only (updates ignored: verified through other clients and the database); Editor read-write.
- Application messages: schema validation, unknown type/version, command authorization, correlation (`replyTo`), `CONFLICT` on concurrent restore.
- Close reasons and codes as in WEBSOCKET_PROTOCOL §9/§11.
- Abuse: malformed Yjs updates, oversized messages, awareness floods, too many connections.

### 5.5 Concurrent editing tests (`CE`)

**Randomized convergence test design**

1. A seeded PRNG chooses a number of replicas (clients and, where relevant, server documents) and a sequence of operations per replica.
2. Operations on headless Tiptap/ProseMirror editors bound to `Y.Doc`s: insert text at random positions, delete ranges, toggle marks, split/merge blocks, insert/remove list items and table rows. A simpler `Y.Text`-level variant runs faster for large iteration counts.
3. The delivery network is simulated: updates are delayed, reordered, duplicated and withheld during simulated offline periods, then delivered.
4. After quiescence all replicas are compared: equal **state vectors** and equal **document JSON** (and equal persisted content after a store).
5. On failure, the test prints the seed and the minimal reproducing operation log (shrinking is attempted).

Variants: in-process replicas (fast, many iterations); through the real collab server with N clients; with a mid-run server restart; with simultaneous restore (Phase 8); with multiple instances (Phase 9, done: TESTING §8.0e). Redis outage tests must disconnect one instance, publish updates from the other, reconnect Redis, and prove the selected recovery mechanism detects and repairs stale state; a Redis restart alone is not a passing reconvergence test.

### 5.6 Multi-browser tests (`MB`)

Playwright launches two or more contexts (different users) on Chromium, Firefox and WebKit: concurrent typing, caret/selection visibility, presence list, comments appearing live, version restore seen by all. Waits use explicit conditions with a generous timeout, never fixed sleeps. These tests assert **convergence and visibility**, not latency (latency is measured only in `LOAD`).

### 5.7 Permission tests (`PERM`)

- The permission matrix (PROJECT_MASTER §5) is encoded once as test data (in `packages/shared` test fixtures) and drives generated tests: for every role, action and resource, expect allowed or denied over **REST**, and for editing/commenting over **WebSocket**.
- Additional cases: page override `NONE`; override on an ancestor; moving a page changes inherited access; Admin/Owner cannot be restricted; removing a member deletes overrides; ownership transfer.
- **Revocation tests:** member removal, role downgrade, session revocation, page deletion and permission change take effect on open connections via events, and via periodic revalidation when events are suppressed (G6). The observed delay is recorded.

### 5.8 Reconnection tests (`RECON`)

Drop the network (fault-injection proxy) for varying durations while one or more clients edit; verify new token acquisition on reconnect, re-sync, merged offline edits, correct behaviour when the token endpoint returns `401`/`404`, reconnect to a different instance, and the unsynced-changes warning state.

### 5.9 Recovery tests (`REC`)

- **Kill points:** kill the collab process (a) before any store, (b) between debounce store cycles, (c) during a store transaction, (d) during compaction (fault injection); restart; verify content equals the last **committed** state (G2, G3, G4).
- **Surviving client:** with a client that stays open, unsynced edits are re-sent after reconnect; **without** a surviving client the lost edits are exactly those after the last commit. The test records which edits were lost; this documents G3 honestly rather than hiding it.
- **Compaction fault injection:** failure mid-compaction leaves the previous state and rows intact (G4).
- **Backup and restore (Phase 11):** restore PostgreSQL into a fresh database; verify application data and collaborative documents; record restore time.

### 5.10 Load tests (`LOAD`)

Scenarios (profiles are defined in a run plan before each run; stop criteria are set in the plan, not guessed here):

| ID | Scenario | Primary metrics |
|---|---|---|
| L1 | Many documents, few clients each (typical usage) | PERF-02, PERF-07 |
| L2 | One hot document, many clients editing | PERF-01, PERF-03 |
| L3 | Reconnect storm (many clients reconnect at once, including after an instance restart) | PERF-04, PERF-06 |
| L4 | Large document with many stored updates: load time and compaction | PERF-06, PERF-05 |
| L5 | Sustained write load: persistence lag and PostgreSQL behaviour | PERF-05 |
| L6 | Multi-instance fan-out (2 and 3 instances): Redis message rate, CPU effect of "all instances handle all messages" | PERF-01, PERF-02, PERF-03 |
| L7 | REST mixed workload | PERF-07 |

### 5.11 End-to-end tests (`E2E`)

Journeys: register → login → create workspace; invite and accept; build a page tree; edit; image upload; collaborate (two browsers); comment; snapshot and restore; permission restriction; logout/session revoke. A small smoke subset runs on every PR.

### 5.12 Security tests (`SEC`)

| Area | Checks |
|---|---|
| Passwords and sessions | Argon2id only; only token hashes stored; cookie attributes; idle and absolute expiry; revocation; password change revokes other sessions |
| CSRF/Origin | Disallowed `Origin` and non-JSON content types rejected on state-changing requests |
| Enumeration | Uniform login failures; invitation token errors indistinguishable (`INVITATION_INVALID`) |
| Rate limiting | `429` on auth, invitation, token and upload endpoints |
| Authorization (IDOR) | Access to resources in other workspaces/pages returns `404` by id guessing; cross-workspace parent/move rejected |
| Collaboration token | Tampering, wrong key, `alg` confusion, replay across pages, expiry |
| WebSocket | Origin allow-list, unauthorized document names, awareness spoofing (V14), oversized/malformed messages, command authorization |
| Uploads | Content-type vs actual content mismatch, size limits, key generation (client filename never used) |
| Injection / XSS | Titles, comment bodies, link URLs (`javascript:` and other disallowed schemes), image URLs; output encoding |
| SQL | Raw queries are parameterized (test with injection payloads) |
| Headers | `helmet` headers present; CORS allow-list |
| Dependencies | `pnpm audit` reviewed each release |
| Logging | No tokens, passwords or document content in logs (log-capture test) |

## 6. Guarantee verification (G1–G7)

A guarantee is stated in README/ARCHITECTURE as verified only when its tests pass in CI. Evidence is the list of passing test ids, recorded in HANDOVER.md.

| ID | Guarantee (short) | Required tests | Phase(s) |
|---|---|---|---|
| G1 | Convergence of replicas that applied the same updates | `CE` randomized in-process; `CE` through server; with restart; with restore; multi-instance | 5, 6, 8, 9 |
| G2 | Durability only after commit | `DB` locking and commit-boundary tests; `REC` kill before/after commit | 5, 6 |
| G3 | Bounded at-risk window; surviving client re-sends | `REC` with and without surviving client; PERF-05 measured lag | 6 |
| G4 | Recovery rebuilds all committed updates; compaction atomic | `REC` kill/restart; compaction fault injection; random history recovery equality | 5, 6, 9 |
| G5 | PostgreSQL durability is independent of Redis; live reconvergence requires explicit recovery | `REC`/`RECON` disconnect one subscriber, publish missed updates, reconnect Redis, detect stale documents, execute recovery/resync, compare document state and persisted state | 9 |
| G6 | Authorization at connect, downgrade/close within bounded time | `WS`, `PERM` revocation tests with and without events | 6, 9 |
| G7 | Snapshot immutability; pre-restore snapshot; non-destructive, serialized restore | `DB`, `WS`, `CE`, `REC`; cross-instance barrier, edits during restore, failure injection before/after PRE_RESTORE commit and restore commit | 8 |

## 7. Measurable performance metrics (PERF-01 … PERF-07)

All metrics are measured, never assumed. Targets are set only after a baseline exists (IMPLEMENTATION_PLAN AC-9.7), by decision.

| ID | Metric | How it is measured | Reported as |
|---|---|---|---|
| PERF-01 | Synchronization latency | A sender client makes a unique edit and records `performance.now()` when the change is applied to its local `Y.Doc`; the receiving client observes the same change through a document observer and records its own timestamp. **Sender and receiver run in one harness process (one clock)** to avoid clock skew. Same-instance and cross-instance runs are separate. | p50/p95/p99 and max over a defined sample; run profile |
| PERF-02 | Concurrent connections | Ramp connected clients per instance under a fixed per-client edit/awareness workload until a pre-declared limit condition (error rate, PERF-01 degradation, resource saturation) is reached; the last stable level is reported. | Count and the limit condition that ended the run |
| PERF-03 | Update propagation | Updates per second per document and per instance delivered to N subscribers; Redis messages per second; server CPU and memory at those rates. | Throughput, fan-out factor, resource use |
| PERF-04 | Recovery time | (a) Time from instance restart to the first client regaining a synced, editable document; (b) client reconnection time after a network drop. | Distribution over repeated runs |
| PERF-05 | Persistence lag | Time from an update being applied on the server to its commit in PostgreSQL (timestamps in server logs/metrics at apply and commit). | Distribution; maximum observed |
| PERF-06 | Document load time | Time to hydrate a document from `DocumentState` plus pending updates, as a function of state size and update count. | Table over sizes |
| PERF-07 | API latency | Per endpoint group, under a defined request mix and concurrency. | p50/p95/p99, error rate |

**Method rules:** warm-up period excluded; steady-state sampling window defined; several repetitions per profile; outliers reported, not discarded; machine, OS, CPU/RAM, Node.js version, dependency versions, PostgreSQL/Redis versions and configuration, instance count and network setup recorded with every result.

## 8. Traceability

Phase 1a infrastructure tests exist and have been run; feature-specific rows below remain not started until their phase implements them. The Phase 10 acceptance criterion AC-10.1 requires no empty rows.

### 8.0 Phase 1a executed evidence (owner-reported 2026-11-12)

| Evidence | Result |
|---|---|
| Test suite | 9 files; 59 tests passed (47 unit, 12 integration) |
| Unit/integration coverage | Shared env/envelope/error/health logic, API and collab shell endpoints, dependency readiness/degraded behaviour, real-process startup/shutdown, and module-boundary lint rules |
| Root checks | `pnpm check` passed: lint, Prettier check, typecheck and tests |
| CI | GitHub Actions workflow passed on the owner-reported run |
| Database | `pnpm db:migrate:deploy` succeeded; `pnpm db:migrate:status` reported up to date |
| Infrastructure | Docker Compose PostgreSQL and Redis services reported healthy; local PostgreSQL host port is 5433 → container 5432 |
| Not covered | S1–S11 collaboration spike, product-feature tests, performance/load baselines, production Docker image build/deployment |

The table records results reported by the project owner; it is not an independent rerun by this documentation review. Detailed phase acceptance evidence is in HANDOVER.md.

### 8.0a Phase 2 executed evidence (Claude, preparation environment, 2026-11-13)

Environment (not the owner's machine and not CI): Linux x86-64, 1 vCPU, Node 24.18.0 (npm package `node@24.18.0`), pnpm 12.18.0, **PostgreSQL 16.x** (apt; the project targets 17), Redis 7.x from apt, `next dev`/`next start` 16.4.6. The Prisma schema engine binary could not be downloaded there, so the Phase 2 migration SQL was applied with `psql` and `_prisma_migrations` was filled by script instead of `prisma migrate deploy`.

| Evidence | Result |
|---|---|
| `pnpm test` (twice) | 17 files, 228 tests passed both times (about 35–48 s); exit code 0 |
| `pnpm run test:unit` | 9 files, 115 tests passed |
| `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck` | all passed |
| `next build` | succeeded (all routes dynamic) |
| Mutation spot checks | Temporarily breaking one behaviour at a time made tests fail as intended: ignoring `revokedAt` (3 failures), skipping the Origin allow-list (3), cookie without `HttpOnly` (2), accepting any password (2), ignoring the absolute expiry (1), removing the web 401 handler (2). Sources were restored afterwards. |

| File | Category | Covers |
|---|---|---|
| `packages/shared/src/auth.test.ts` | UT | Request/response schemas, normalization, password bounds, strict objects, cookie name, session env |
| `apps/api/test/auth-units.test.ts` | UT | Argon2id hashing/verification, token generation/hash (SHA-256 vector), Redis-outage error detection |
| `apps/api/test/auth.int.test.ts` | API, DB, SEC | Register, login, logout, session list/revoke, password change, profile, all endpoints' success and error codes, 401 on every protected route, cookie attributes, Origin/Content-Type/CORS, uniform login errors, event publication, no secrets in responses |
| `apps/api/test/session-lifecycle.int.test.ts` | API, DB | Idle expiry, sliding refresh, 30-day absolute cap, throttled `lastSeenAt` (controlled clock), expired sessions hidden/not revocable, cleanup job, DB constraints (lower-case email, colour format, token-hash format, unique email, cascade) |
| `apps/api/test/security.int.test.ts` | SEC | Per-IP and per-account rate limits, 429 + `Retry-After`, fail-closed 503 for Redis and 503 for PostgreSQL outages, `X-Forwarded-For` handling (trusted/untrusted peer, forged left-most entry), production `__Host-` cookie, no secrets in logs, uniform error envelope |
| `apps/api/test/web-auth.int.test.ts` | IT, E2E (HTTP level) | Real API process + real `next dev` server: redirects, proxy forwarding (V7), register → protected page → profile update → logout |
| `apps/web/src/lib/api-client.test.ts`, `apps/web/src/components/auth-flows.test.tsx` | UT (jsdom) | API client envelope handling; login, registration, profile, password, header/logout and sessions UI flows, 401 handling, double-submit protection |
| `packages/db/test/health.int.test.ts` (extended) | DB | Readiness requires every shipped migration; tolerates newer extras |

**Not tested, stated plainly:** real browsers (cookie storage, form behaviour, layout); any Docker image build; the Compose `apps` profile; `prisma migrate deploy`/`migrate diff` for the Phase 2 migration; PostgreSQL 17; load behaviour of the rate limiter or Argon2 under concurrency beyond the 8-hash timing above; the web app behind a real reverse proxy.

Owner-reported after the table above: the Phase 2 GitHub Actions workflow run, initially deferred, passed (recorded 2026-11-15; run date and commit not supplied).

### 8.0b Phase 3 tests (written 2026-11-14; run by the owner 2026-11-15)

Phase 3 was written without PostgreSQL, Redis or pnpm, so the tests were first run by the owner on 2026-11-15 (Windows, PostgreSQL 17 on host port 5433, Redis 7). Result: `pnpm check` passed (lint, Prettier, typecheck, tests) with **482 tests**, including the permission matrix (133 cases) and the DB constraint tests. Two test-side problems were found and fixed: the matrix `PUT`/`DELETE page permission` actions overrode the VIEWER actor (hiding the page from it, a correct 404), so they now target a separate member; and `tests/boundaries.test.ts` needed a 30 s timeout under a parallel full run. Flags are not forwarded by `pnpm test -- --flag`; use `pnpm test --testTimeout=20000`. The manual browser walkthrough (HANDOVER §8.6 item 5) also passed. Details: HANDOVER §8.8.

| File | Category | Covers |
|---|---|---|
| `packages/shared/src/permissions.test.ts` | UT | Role order, D23 resolution incl. **exhaustive** role × override-chain (depth 0–4, 4 686 combinations, AC-3.1), management rules (invite, role change, removal) |
| `packages/shared/src/page-position.test.ts` | UT | Fractional keys: validity, ordering over 2 000 random insertions, append growth, re-spacing |
| `packages/shared/src/workspaces.test.ts` | UT | Phase 3 request schemas, invitation link build/parse, email masking |
| `packages/db/test/workspace-constraints.int.test.ts` | DB | One owner (index + deferred trigger, transfer in one transaction, workspace delete), invitation CHECKs/partial unique index, composite parent FK, self-parent, position format, cascades (AC-3.4, 3.7) |
| `apps/api/test/workspaces.int.test.ts` | API, SEC | WS-01–09; INV-01–07: single use, concurrent accept, expiry (DB-set), email binding, decline, revoke/resend rotation, token never stored/logged, existence hiding (AC-3.3, 3.5, 3.9) |
| `apps/api/test/pages.int.test.ts` | API, DB | PAGE-01–09: ordering and re-spacing, depth, INVALID_MOVE cases, breadcrumbs, batch delete/restore, purge, retention job (AC-3.6, 3.7) |
| `apps/api/test/permissions.int.test.ts` | PERM, API | Overrides, inheritance, `NONE` hiding, admin non-restrictability, breadcrumb filtering, access events, ACT-01/02, activity metadata hygiene (AC-3.8, 3.10) |
| `apps/api/test/permission-matrix.int.test.ts` | PERM | 19 actions × {OWNER, ADMIN, EDITOR, COMMENTER, VIEWER, non-member, no session} (AC-3.2) |
| `apps/web/src/lib/page-tree.test.ts`, `apps/web/src/components/workspace-flows.test.tsx` | UT (jsdom) | Tree building/ordering, dashboard, create form, tree navigation, member and invitation management, invite page |

**Not covered, stated plainly:** AC-3.11 automated browser E2E (Playwright is not implemented; the API-level flow tests and the owner's manual walkthrough approximate it); the page-view, settings, trash and permissions-panel components have no component tests; real-browser layout/responsiveness; concurrency beyond the concurrent-accept test; the effect of a PostgreSQL collation on ordering (ordering is done in the application, D50).

### 8.0c Phase 4 tests (written and run by Claude, 2026-11-15)

Environment: Node 24.18.0, pnpm 12.18.0, **PostgreSQL 16.15** and Redis 7.0.15 installed from Ubuntu packages (the project targets PostgreSQL 17), no browser, no Docker. The Prisma schema engine could not be downloaded, so migrations were applied with a script that runs the SQL files (see DATABASE_SCHEMA §13). Result of `pnpm test --testTimeout=20000`: **38 files, 692 tests passed** (the Phase 3 baseline reproduced in the same environment: 27 files, 482 tests; Phase 4 adds 11 files and 210 tests). Lint reports no problems, typecheck and `pnpm build` pass.

| File | Type | Tests | Covers |
|---|---|---|---|
| `packages/shared/src/editor-content.test.ts` | UT | 14 | Document validator: structure, attributes, marks, limits, hostile keys, link rules, no echo of content |
| `packages/shared/src/assets.test.ts` | UT | 6 | Image signature detection, asset URL, upload request schema, `ASSET_STORAGE_DIR` |
| `packages/editor/src/schema-conformance.test.ts` | UT | 43 | Shared schema model equals the real ProseMirror schema; validator and ProseMirror agree on structure; validator is stricter on values |
| `packages/editor/src/editor-behavior.test.ts` | UT | 22 | Every approved formatting feature in a headless editor, undo/redo and its removal (AC-4.6), read-only, round trip, invalid content, slash commands |
| `packages/editor/src/registry.test.ts` | UT | 4 | Registry, custom extension without core changes (AC-4.2), unapproved StarterKit features absent |
| `packages/editor/src/slash-commands.test.ts` | UT | 5 | Slash filtering and ranking, image command hidden without a host |
| `apps/api/test/page-content.int.test.ts` | API | 30 | CONTENT-01/02: round trip, revisions, 409 on stale and simultaneous saves, validation, 413/400 size limits, viewers/commenters 403, non-members 404, overrides, trash, purge cascade, Origin/content-type, rate limit, stored-content corruption |
| `apps/api/test/assets.int.test.ts` | API/SEC | 24 | ASSET-01…04: full flow and byte-identical read, types and sizes (415/413), roles, uploader-only, expiry, signature and size mismatch (409), disguised script, Origin and raw-body exemption scope, access control on read, cleanup job, storage key safety |
| `apps/web/src/lib/autosave.test.ts` | UT | 14 | Autosave controller with fake timers |
| `apps/web/src/lib/image-upload.test.ts` | UT | 9 | Client checks and error mapping |
| `apps/web/src/lib/api-client.test.ts` | UT | +4 | Content and image calls, raw upload headers |
| `apps/web/src/components/editor/page-editor.test.tsx` | UT (jsdom) | 35 | Loading and error states, read-only viewers, autosave, retry, conflict choices, permission loss, leaving, toolbar (one tab stop, arrow keys, every control), links, tables, images, slash menu keyboard and mouse |

Also executed (not part of the suite): a smoke test against the **built** API and web servers through the Next.js proxy: a 992 KB document saved and read back identical, a stale save answered 409, an invalid document 400, a 2 MB image uploaded as raw bytes through the proxy and read back with an identical hash, SVG refused, a script renamed to PNG refused.

**Not covered:** browser end-to-end tests (Playwright was not available), real typing, IME, drag and drop, visual layout and responsiveness (the CSS was written for narrow screens but never rendered), Docker, GitHub Actions, S3-compatible storage.

### 8.0d Phase 4 owner verification (2026-11-16)

Run locally by the owner (Windows, Git Bash, Node 24.18.0, pnpm 12.18.0, PostgreSQL 17 on host port 5433, Redis 7) following HANDOVER §9.8.

| Check | Result |
|---|---|
| `pnpm db:migrate:deploy`, `pnpm db:migrate:status` | Passed: `20261115120000_editor_content_assets` applied by Prisma; schema up to date; a second `deploy` found nothing pending |
| Scratch-database drift check (`migrate:dev` against an empty `conote_scratch`) | Passed: all four migrations applied; second run "Already in sync"; no new migration proposed |
| `pnpm check`: lint, format check, typecheck | Passed after the two delivery gaps in HANDOVER §9.11 were closed |
| `pnpm check` tests, default 5 s timeout | 690 of 692 passed; the two `startup.test.ts` cases (api, collab) timed out. Same borderline spawn-heavy timeout recorded for Phase 2 (HANDOVER §7.9) |
| `pnpm test --testTimeout=20000` | **Passed: 38 files, 692 tests** |
| Browser: editor, autosave "Saved", reload persistence, toolbar, slash commands | Passed |
| Browser: every toolbar control and slash command, images by button, paste and drag-and-drop, reload persistence | Passed (owner-reported) |
| Browser: two-tab conflict (both choices), Viewer/Commenter/Editor roles, offline retry and recovery, phone width, keyboard-only | Passed (owner-reported) |

**Still not covered:** automated browser end-to-end tests (Playwright), screen-reader checks, mobile soft-keyboard and IME behaviour, Docker (the `apps` profile needs a volume for `ASSET_STORAGE_DIR`), GitHub Actions, S3-compatible storage.

### 8.0e Phase 9 tests and measurements (written and run by Claude, preparation environment, 2026-11-21; owner-verified on the owner's machine, 2026-11-21)

**Environment:** one virtual CPU, 4 GB, Linux, Node v22.23.5, PostgreSQL 16.15, Redis 7.0.15, pnpm 12.18.0 (not the owner's Windows / Node 24 / PostgreSQL 17 setup). PostgreSQL and Redis ran on the same machine as the collab instances; migrations were applied with `psql` because the Prisma engine download is blocked in this environment (as in earlier phases).

**New automated tests (40, all passing in the final full run):**

| File | Tests | Covers |
|---|---|---|
| `apps/collab/test/cluster.int.test.ts` | 14 | AC-9.1, 9.2, 9.3, 9.9 (loops): propagation both ways; late joiner; peer handshake with an unstored change; 3 instances / 6 clients under 150 seeded random edits (seed 20261121, identical text and state vectors, PostgreSQL agrees); presence across instances, identity forgery, presence of a killed instance (35 s test); message count bounded and stopping (7 Redis messages for one edit across 3 instances); no duplicated content; replicated store writes no extra row; crash with and without replicated stores; rebuild from PostgreSQL after all instances restarted |
| `apps/collab/test/cluster-failure.int.test.ts` | 10 | AC-9.4, 9.6, 9.8: Redis cut with a TCP proxy; reconnect alone insufficient; automatic recovery in both directions; document opened during an outage; start without Redis; shutdown without Redis; periodic check without any Redis event; the G3 loss window recorded; per-instance connection limit; heartbeat; rolling restart behind a load balancer (4 clients, 65 edits, both instances restarted) |
| `apps/collab/test/cluster-access.int.test.ts` | 4 | AC-9.5: a removed member cut off on both instances; downgrade read-only on the holding instance, writes reach nobody; deleted page closes both; periodic revalidation on each instance with no event |
| `packages/db/test/document-store.int.test.ts` | +5 | `persistedVectors`; `skipIfUnchanged` (already stored, never stored, new content, deletion, concurrent stores write one row) |
| `packages/shared/src/yjs.test.ts`, `shared.test.ts` | +4, +3 | `storedAheadOfLive`; the new `COLLAB_CLUSTER_*` settings |

**Test infrastructure added:** `Cluster` (several real collab servers sharing PostgreSQL, keys and a Redis prefix), `RedisProxy` (cut and restore the network between one instance and Redis), `RoundRobinProxy` (a load balancer), `Harness.crash()` (an instance that disappears without storing or announcing anything), seeded random edits (`seededRandom`).

**Results of the last runs:** full workspace run at the end: **64 files, 1,117 tests passed (baseline 1,077), 261 s.** An earlier full run had 63 files and 1,113 tests. `eslint .` over the whole repository and `tsc --noEmit` for `apps/collab` were clean; `prettier --check .` fails only on `infra/docker-compose.yml` (pre-existing, recorded in Phase 8).

**Defects the tests found (all fixed):** (1) shutting an instance down while Redis was unreachable threw from the extension's `onDestroy`; (2) with Redis down at startup the event subscribers waited without limit, so `start()` never returned (this defect predates Phase 9); (3) unloading a document while Redis was down printed an error per document and left its channel subscribed; (4) the instance-crash presence test first passed in 0.3 s because the simulated crash still announced departures; it now cuts Redis first and shows the real 34 s expiry; (5) a first version of the loop test did not subscribe to the reply channels and under-counted messages; (6) a replicated-store test asserted a fast-path count that races the origin's own store, so it asserts the invariant (no extra row, no write) instead.

**Acceptance criteria (IMPLEMENTATION_PLAN, Phase 9):**

| AC | Status | Evidence |
|---|---|---|
| 9.1 convergence, 2 then 3 instances | **Met** in the tests above (3 instances, 6 clients, seeded random edits) | `cluster.int.test.ts` |
| 9.2 awareness across instances | **Met in tests** (identity, cursor field, removal on leaving, forged identity). Not checked in real browsers | `cluster.int.test.ts` |
| 9.3 persistence across instances; recovery after killing an instance | **Met in tests**: PostgreSQL holds committed content through kills, restarts and replicated stores; G2/G4 not re-proved beyond these runs | `cluster.int.test.ts`, benchmark `recovery-instance` |
| 9.4 Redis outage | **Met** including "reconnect alone is insufficient" and the G3 loss window | `cluster-failure.int.test.ts` |
| 9.5 access events and revalidation across instances | **Met in tests** for removal, downgrade, page deletion, and timer-only revalidation. Session-revocation and workspace-deleted events were not repeated across instances (same code path, not tested) | `cluster-access.int.test.ts` |
| 9.6 limits and heartbeat | **Met in tests**: per-instance connection limit (total), heartbeat. The per-user limit is the Phase 6 test on one instance; a global per-user limit does not exist | `cluster-failure.int.test.ts`, `abuse.int.test.ts` |
| 9.7 PERF-01…07 measured | **Partly met.** All seven were measured once, but PERF-02 did not reach a limit, most runs were single runs, PERF-07 is in-process, and the machine has one core. Observed values are in PERFORMANCE.md; they are **not** proposed as targets because the environment cannot support targets | PERFORMANCE.md |
| 9.8 rolling restart | **Met in test** (2 instances, 4 clients) and benchmark (SIGKILL, 8 clients, 0 of 73 edits lost) | both |
| 9.9 sticky-routing evaluation | **Evaluated with measured evidence and a recommendation** (D67); not built | PERFORMANCE §8 |

**Not tested (do not read these as passed):** real browsers; Docker `apps` profile and GitHub Actions; the owner's platform; more than three instances; a real network or balancer; TLS to Redis; Redis Cluster/Sentinel; Redis memory limits and eviction; session-revoked / workspace-deleted events across instances; long soak runs; load above 1,000 connections or 20 changes per second per document; the `server.shutting_down` time with many documents; the Redis recovery with thousands of open documents (the per-document cost of the resynchronization pass was not measured).

#### Owner verification on the owner's machine (2026-11-21)

Full record: HANDOVER §14.9. On the owner's Windows machine (Git Bash; PostgreSQL 17 and Redis 7 from Compose; pnpm 12.18.0, Vitest 5.1.0, Prisma 7.10.1; Node version and browsers not recorded): install, package build, lint, format check and typecheck passed (the format check was fully clean). `pnpm test --testTimeout=30000` ran **64 files, 1,116 of 1,117 tests passed, 317.19 s.**

- **The failing test:** `cluster.int.test.ts` > "no message loops and no duplicate processing (AC-9.9)" > "one edit produces a bounded number of Redis messages that stops once the instances agree". It counts Redis messages after the instances agree, waits one second and expects the count not to change. It failed in the full run (10 then 15), and in three runs of the file alone (7 then 10; 13 then 27; 7 then 30), always with a different count. The other 13 tests of the file passed every time. Run alone with `-t "one edit produces"`, the test passed twice (2.4 s).
- **Reading of the result:** the test is order-dependent. The counter subscribes to every channel under the cluster prefix and the tests share one cluster, so traffic left by earlier tests is the likely source of the late messages. A real message loop is not supported by the evidence (the test passes alone and the exactly-once test passes), but the cause was **not confirmed**: printing the channel and time of each late message was suggested and not run. **The test is not yet a reliable proof of AC-9.9 (no loops) and should be changed to count only its own page's channel, or to wait for earlier clients to close, before Phase 10.** The expected full-suite result after that change is 1,117 of 1,117.
- **Manual checks in real browsers** (HANDOVER §14.7 items 2–4), reported as working: two collaboration instances on ports 4100 and 4101 (`cluster: "connected"` in both logs), the API's `COLLAB_URL` switched between them so that each browser used a different instance, live text and carets in both directions; Redis stopped for about ten seconds while both browsers typed, with all text present in both after Redis returned and no reload; one instance stopped while typing. Not recorded: the log lines `redis unavailable` and `redis is back`, the time to convergence, and whether the browser reconnected on its own after the instance stopped.

**Update to the "Not tested" list above:** real browsers (two instances, Redis outage, stop of one instance) and the owner's platform are now covered by the manual run. **Still not tested:** Docker `apps` profile and GitHub Actions; more than two instances in browsers; a real network or balancer; TLS to Redis; Redis Cluster/Sentinel; Redis memory limits and eviction; long soak runs; load; any multi-core run; an automated browser E2E.

### 8.1 Requirements

| Requirement group | Primary categories | Phase |
|---|---|---|
| FR-AUTH-01 … 07 | `UT`, `DB`, `API`, `SEC`, `E2E` | 2 |
| FR-WS-01 … 08 | `API`, `PERM`, `DB`, `E2E` | 3 |
| FR-PG-01 … 06 | `API`, `PERM`, `DB`, `E2E` | 3 |
| FR-PG-07 | `WS`, `REC`, `E2E` | 6 |
| FR-ED-01 … 09 | `UT`, `E2E`, `API` (assets), `SEC` | 4 |
| FR-RT-01, 03 | `CE`, `UT`, `DB` | 5 |
| FR-RT-02, 04 … 06 | `WS`, `CE`, `RECON`, `REC`, `MB` | 6 |
| FR-PR-01 … 05 | `MB`, `SEC`, `E2E` | 7 |
| FR-CM-01 … 06 | `API`, `PERM`, `CE`, `E2E` | 8 |
| FR-VH-01 … 06 | `API`, `WS`, `DB`, `CE`, `E2E` | 8 |
| FR-PM-01, 02 | `PERM`, `API` | 3 |
| FR-PM-02 (WS part), 03, 04 | `PERM`, `WS` | 6, 9 |
| FR-SC-01, 03 | `CE`, `REC`, `LOAD`, `WS` | 9 |
| FR-SC-02, 04 | `DB`, `REC`, `GT` | 5, 6, 9 |
| NFR-SEC-01 … 05 | `SEC` | 2, 6, 10 |
| NFR-REL-01 | `GT` (G1–G7) | 5–9 |
| NFR-MNT-01, 02 | CI lint/typecheck/boundary tests | 1 onward |
| NFR-A11Y-01 | `E2E` keyboard checks | 4, 7, 10 |

### 8.2 Endpoints

| Endpoint group (ids) | Categories | Phase |
|---|---|---|
| `AUTH-01` … `AUTH-07`, `USER-01`, `USER-02` | `API`, `SEC`, `DB` | 2 (avatar part 4) |
| `WS-01` … `WS-09`, `INV-01` … `INV-06` | `API`, `PERM`, `SEC`, `DB` | 3 |
| `PAGE-01` … `PAGE-09`, `PP-01` … `PP-03` | `API`, `PERM`, `DB` | 3 |
| `ACT-01`, `ACT-02` | `API`, `PERM` | 3 |
| `ASSET-01` … `ASSET-03` | `API`, `SEC`, `E2E` | 4 |
| `PAGE-10` | `API`, `WS`, `SEC` | 6 |
| `CMT-01` … `CMT-06` | `API`, `PERM` | 8 |
| `VER-01` … `VER-03` | `API`, `PERM` | 8 |
| `OPS-01`, `OPS-02` | `IT` | 1 (Phase 1a tests pass) |

### 8.3 Permission matrix

PROJECT_MASTER §5 is the single source for the matrix. Every cell (role × action) maps to at least one generated `PERM` test (REST and, for editing/commenting, WebSocket). The generated test list is stored with the fixtures and counted in AC-3.2 and AC-10.1.

## 9. CI pipeline

| Stage | Contents | Trigger |
|---|---|---|
| Fast | install (frozen lockfile), lint (incl. boundaries), typecheck, `UT`, `DB`, `API`, `IT` | every push/PR |
| Standard | `WS`, `PERM`, `SEC` (fast), `CE` (short seeds), `REC`/`RECON` subsets, `E2E` smoke | every PR |
| Nightly | `CE` (long seeds), `MB` full (3 browsers), `REC`, `RECON`, `E2E` full | scheduled |
| Pre-release | `LOAD` runs with recorded results, `SEC` full, dependency audit | before a release/phase sign-off |

GitHub Actions is the configured and owner-reported passing CI provider. The current workflow uses PostgreSQL and Redis service containers; object storage is not part of Phase 1 CI (D37). The Fast/Standard/Nightly/Pre-release stages above are the intended future testing strategy, not all implemented as separate jobs in the current workflow.

## 10. Recording results

- Measured results go in dated records under `docs/` (spike results in `docs/spikes/`, load results in `docs/PERFORMANCE.md` with raw files in `docs/benchmarks/`, created in Phase 9), with the environment details from §7.
- HANDOVER.md lists, per phase, the acceptance criteria and the test ids that satisfy them.
- A test that is skipped, flaky or deleted must have a recorded reason and owner; flaky tests are fixed or quarantined within the phase, never silently retried.
- Coverage is reported for information; gating thresholds are decided in Phase 10.

## 11. Open items

GitHub Actions is the confirmed CI provider; the Phase 1a workflow is configured and the owner reports a passing run on 2026-11-12. The owner also reports a passing Phase 2 run (recorded 2026-11-15). CI has not been run for Phase 3.

| Item | Resolved in |
|---|---|
| Value of N (client count) for the standard `CE` through-server test | Phase 6 (chosen from spike results and recorded) |
| Fault-injection proxy implementation | Phase 6 |
| Load-test stop criteria and run plans | Phase 9 (before each run) |

## 12. Commands (implemented in Phase 1)

| Command | What it does | Needs services |
|---|---|---|
| `pnpm lint` / `pnpm format:check` | ESLint (including module-boundary rules) / Prettier check | No |
| `pnpm typecheck` | Builds packages, runs `tsc --noEmit` in every workspace and for root tests | No |
| `pnpm test:unit` | Vitest project `unit` (`*.test.ts` and, with `// @vitest-environment jsdom`, `*.test.tsx`): env validation, envelope/errors, health logic with fake dependencies, collab HTTP/WebSocket shell, boundary-lint deliberate violations, startup fail-fast | No |
| `pnpm test:integration` | Vitest project `integration` (`*.int.test.ts`): real PostgreSQL and Redis, readiness incl. outage cases, real process start and shutdown. POSIX/Linux verifies graceful SIGTERM and exit code 0; Windows verifies startup, health endpoints and process termination because Windows does not deliver catchable POSIX signals to child processes. | Yes: `DATABASE_URL`, `REDIS_URL`, migrations applied |
| `pnpm test` | Both projects | Yes |

Integration tests **fail** (they do not skip) if `DATABASE_URL`/`REDIS_URL` are missing. The GitHub Actions verification job runs on `ubuntu-latest`, so the real-process tests exercise the production SIGTERM handlers and require exit code 0 in CI. Windows local runs still verify that both child processes start, serve their health/readiness endpoints, and terminate; they do not claim to verify graceful SIGTERM handling. Playwright (E2E) is not configured yet; it arrives with the first end-to-end flow (Phase 2).

### 8.0d Phase 5 tests (written 2026-11-16, executed in a preparation environment and on the owner's machine 2026-11-16)

Executed in a preparation environment (Node v22.23.4 (the repo requires 24; `engine-strict` was overridden), PostgreSQL 16.13 and Redis 7 from apt on Linux x64 (Compose uses PostgreSQL 17), migrations applied by `psql` because the Prisma schema engine could not be downloaded): all Phase 5 tests pass (HANDOVER §10.8). The first run found three defects in the tests and in `ydocToContent`, fixed the same day. The PERF-06 numbers below are from that environment, not a target.

**PERF-06 baseline (first measured value, three runs of the harness):** with 10 / 100 / 400 unfolded update rows (218 / 1,838 / 7,799 bytes), `DocumentStore.load` median was 2.7 / 15.9 / 17.8 ms, then 2.5 / 9.1 / 14.8 ms; 5 loads per size, tiny documents, local database. Run it again on the owner's machine before using any number.

| File | Project | Covers |
|---|---|---|
| `packages/shared/src/yjs.test.ts` | unit | AC-5.1, AC-5.2 on bare Yjs: handshake, different/same section, simultaneous insert/delete, formatting, repeated and out-of-order delivery (30 seeded shuffles), 25 seeded 5-replica random runs, local/remote handling |
| `packages/shared/src/collab.test.ts` | unit | document-name helpers and constants |
| `packages/editor/src/collaboration.test.ts` | unit (jsdom) | the same scenarios through real Tiptap editors, 5 seeded 3-editor random runs, compatibility of the Phase 4 JSON with the Y.Doc (seed and read back) |
| `packages/db/test/document-store.int.test.ts` | integration | AC-5.3 to AC-5.8: diff-only append, no-op store, deletions, per-client maximum vector, parallel stores and compaction, atomic compaction (injected failure), disordered/duplicated stored rows, recovery after restart (new client), 12 seeded random histories, commit boundary, constraints, seeding |
| `packages/db/test/document-load-baseline.int.test.ts` | integration | AC-5.9: prints load time for 10/100/400 pending rows with node/platform; asserts only correctness; the owner's first real run is recorded below |

Run: `pnpm test --testTimeout=20000`. The new int tests need `pnpm db:migrate:deploy` first.

#### Owner verification on the owner's machine (2026-11-16)

**Environment:** Windows (win32/x64), Node v24.18.0, pnpm 12.18.0, PostgreSQL 17 (`postgres:17-alpine`) and Redis 7 (`redis:7-alpine`) from the project's Docker Compose, PostgreSQL on host port 5433. CPU model and RAM were not recorded; add them here before quoting any number outside this project.

| Check | Result |
|---|---|
| `pnpm install` | No peer-dependency warnings; `pnpm why yjs` reports a single version, 13.6.33 |
| `pnpm db:generate`, `pnpm db:migrate:deploy`, `pnpm db:migrate:status` | 5 migrations found; no pending migrations (the Phase 5 migration `20261116120000_yjs_document_store` had already been applied); database schema up to date |
| Scratch-database drift check (`migrate:dev` against an empty `conote_scratch`) | All 5 migrations applied from empty, including `20261116120000_yjs_document_store`; no new migration proposed; a second run reported "Already in sync"; `git status` showed no stray migration |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | All clean (the Phase 3 formatting and `infra/docker-compose.yml` findings of the preparation environment did not appear) |
| `pnpm test --testTimeout=20000` | 43 files, 802 tests passed; duration 139.5 s |
| Real process restart | A process stored two updates with `DocumentStore.appendDiff` and was killed with SIGKILL; a new process called `load` and recovered both paragraphs exactly (`exists: true`, `appliedRows: 2`, `foldedSeq: 0`); storing the reloaded document again wrote nothing (`stored: false`) |

**PERF-06 baseline, owner's machine** (5 loads per size, tiny documents, local Docker PostgreSQL; first measured value, not a target):

| Unfolded update rows | Update bytes | `load` median (ms) | min / max (ms) |
|---|---|---|---|
| 10 | 218 | 6.1 | 5.8 / 15.9 |
| 100 | 1,838 | 8.7 | 8.2 / 10.4 |
| 400 | 7,799 | 11.2 | 10.7 / 11.6 |

Raw line printed by the harness: `PERF-06 baseline {"node":"v24.18.0","platform":"win32/x64","results":[{"pendingRows":10,"runs":5,"loadMsMedian":6.1,"loadMsMin":5.8,"loadMsMax":15.9,"totalUpdateBytes":218},{"pendingRows":100,"runs":5,"loadMsMedian":8.7,"loadMsMin":8.2,"loadMsMax":10.4,"totalUpdateBytes":1838},{"pendingRows":400,"runs":5,"loadMsMedian":11.2,"loadMsMin":10.7,"loadMsMax":11.6,"totalUpdateBytes":7799}]}`. These numbers supersede the preparation-environment numbers above for this project; they say nothing about large documents, real network latency or concurrent users. The individual commands were run separately; `pnpm check` as one command was not run.

### 8.0g Phase 8 tests (written and run by Claude in a preparation environment, 2026-11-19; owner-verified on the owner's machine, 2026-11-20)

**Environment:** Node v22.23.5 (the project requires 24), PostgreSQL 16 and Redis 7 installed locally, Prisma schema engine unavailable (migrations applied by script, see DATABASE_SCHEMA §15). Baseline before the phase: **55 files, 966 tests passed (137 s)**. After: **61 files, 1077 tests passed (172 s)** with `--testTimeout=30000`; 111 new tests in six new files plus extensions of `collab-session.test.ts`.

| File | Tests | What it proves |
|---|---|---|
| `apps/api/test/comments.int.test.ts` | 15 | CMT-01 … 06: create/reply/resolve/reopen/delete, validation, pagination and filters, role matrix (Viewer 403, stranger 404 identical to missing), page-permission overrides, idempotence and activity counts, `comments.changed` published after commit and not for refused or no-op calls, trashed pages, authentication (AC-8.2, AC-8.10) |
| `apps/api/test/versions.int.test.ts` | 4 | VER-01 … 03: order, kind filter, pagination, contributors, binary state identical to the stored bytes and loadable, 404 across pages and for strangers, authentication (AC-8.8) |
| `packages/db/test/versions.int.test.ts` | 15 | snapshots: full state round trip, page scoping, AUTO skipped only when unchanged (also after a deletion), immutability (Prisma and raw `UPDATE` rejected), rollback on a fault, size CHECK, cascade; contributors (AC-8.9); barrier: single holder, 8 simultaneous requests → 1 winner, store refused for others and unchanged, held edit stored after release, expiry, compaction not blocked, CHECK (AC-8.5, D62) |
| `packages/editor/src/comment-anchors.test.ts` | 20 | on real Tiptap editors bound to Y.Docs: anchors follow text through insertions before and inside the range by another client, concurrent edits, two paragraphs; boundary behaviour; detached on deletion in editors and on a bare `Y.Doc`; highlights are decorations only (document and Yjs state unchanged), follow edits, report detached, wait for sync; `planRestore`: content equals the snapshot, history kept, null when equal, idempotent, anchors on unchanged text survive, convergence with a concurrent client, invalid snapshot refused, empty snapshot (AC-8.1, AC-8.3) |
| `apps/collab/test/versions.int.test.ts` | 27 | on the real collaboration server: manual snapshots (live content, unstored edits included, FORBIDDEN for Commenter/Viewer, malformed commands, contributors); automatic snapshots (interval, unload, no repeat when idle, retention of AUTO only); restore (all clients converge, PRE_RESTORE holds the replaced state, event logged, history kept and re-restorable, equal content, role matrix, NOT_FOUND, role read again at command time); concurrency (writes held back and merged after `forceSync`, nothing accepted before the barrier lost, writes accepted again without reconnecting, second restore → CONFLICT, simultaneous restores serialized); failures (PRE_RESTORE fault, invalid snapshot, planning fault: document unchanged, barrier released, editing continues); two instances (second instance cannot store during the barrier and does afterwards, restore reaches the other instance, other instance's stored edits are in the PRE_RESTORE snapshot); anchors after restore (unchanged ACTIVE, replaced DETACHED, nothing lost); `comments.changed` relay and malformed events (AC-8.4 … 8.7, 8.9, 8.10) |
| `apps/web/src/lib/collab-session.test.ts` (+10) | 30 | commands and answers, in-flight separation, not connected, destroy, restore started/restored/failed, refetch ticks including after reconnect (AC-8.10) |
| `apps/web/src/components/editor/comments-versions.test.tsx` | 20 | comments panel (list, detached, resolved tab and reopen, reply, delete own only, create from selection with highlight, highlight follows edits, Viewer and read-only Commenter, API failure keeps the draft); version history (list, read-only preview leaves the live page untouched, confirm/cancel/refused restore, Viewer, save version, unloadable version); editor paused during a restore |

**Findings during testing (all fixed):** the collaboration server's Redis client connects lazily and queues nothing, so the first `document.restored` publish was silently dropped (found by the cross-instance test); a highlight plugin that reacted to the sync plugin's empty transactions looped forever (found when the editor tests hung); y-tiptap cannot resolve a character-level position at index 0 of a text node (documented edge, D63); a failed reply cleared the typed text (UI test).

**Not tested / not claimed:** real browsers (no E2E in this environment; the owner checklist is HANDOVER §13.7); live convergence of ordinary edits between two instances (Phase 9); restore of very large documents (Phase 10); `prisma migrate deploy` and the drift check (engine unavailable); Node 24. One pre-existing test (`sync.int.test.ts`, persistence retry) failed once on the owner's machine under full-suite load (HANDOVER §12.11); it passed in every run here.

#### Owner verification on the owner's machine (2026-11-20)

**Environment:** the owner's Windows machine (Git Bash); PostgreSQL 17 and Redis 7 from the project's Docker Compose, PostgreSQL on host port 5433; pnpm 12.18.0, Vitest 5.1.0, Prisma 7.10.1 (the Prisma CLI printed an update notice for 8.0.0-rc.34, which was not applied). The Node version was not recorded in this session.

| Check | Result |
|---|---|
| `pnpm infra:up` | Redis and PostgreSQL healthy |
| `pnpm install` | Already up to date |
| `pnpm db:migrate:deploy`, `pnpm db:migrate:status` | 6 migrations found; `20261119120000_comments_versions` applied; database schema up to date |
| Scratch-database drift check (`migrate:dev` against an empty `conote_scratch`) | The scratch database left from an earlier phase already existed and was dropped and created again; all 6 migrations applied from empty; "Your database is now in sync with your schema"; no new migration proposed; `git status` showed only the not yet committed Phase 8 migration folder |
| `pnpm build:packages`, `lint`, `format:check`, `typecheck` | Passed (owner-reported; whether `format:check` still lists `infra/docker-compose.yml` was not recorded) |
| `pnpm test --testTimeout=30000`, first full run | **61 files, 1076 of 1077 tests passed, 265.11 s.** Failure: `apps/collab/test/versions.int.test.ts` > "the barrier across collaboration instances (D62, AC-8.6)" > "stops a second instance storing while the restore runs, and lets it store afterwards: nothing is lost", assertion at line 589 (`expect(await new DocumentStore(first.prisma).isRestoring(pageId)).toBe(true)` received `false`) |
| That file alone, and that test alone | Failed every time (file: 26 of 27 passed): deterministic, not a load problem |
| Cause | A test-ordering bug, not a code defect. `VersionService.isRestoring()` reports the in-process gate, set synchronously at the start of `restore()`, which is before the PostgreSQL barrier is acquired (after an awaited role check and an awaited load of the snapshot). The test read the database barrier right after the gate went up. The order in the code is the intended, conservative one (D62) |
| Fix (test only) | The test waits for the gate and then for the PostgreSQL barrier (`until(async () => await store.isRestoring(pageId), 'barrier up in PostgreSQL')`) before asserting. File then passed 27 of 27 (16.92 s). The `DocumentRestoringError` lines printed on stderr are the second instance's refused stores, which the test expects |
| Owner checklist, comments (HANDOVER §13.7 items 1–4) | Two browsers (Editor and Commenter), plus a Viewer: create, reply, resolve, reopen, anchors following edits before, inside and after the commented text, detached thread with its quote, Viewer read-only. Reported as working |
| Owner checklist, versions (HANDOVER §13.7 items 5–9) | Save version, read-only view of an old version, restore, undo through the "Before a restore" entry, typing in the other browser during a restore, collaboration-server restart, and the rejected `UPDATE document_snapshots` (immutability trigger). Reported as working |

The browser checks were reported per group ("all worked", "everything passes"); no per-step detail, screenshots or timings were recorded. The known flaky Phase 6 test (`sync.int.test.ts`, HANDOVER §12.11) did not fail in this run.

**Not verified:** a full-suite run after the test fix (1077 of 1077 expected); Docker `apps` profile; GitHub Actions; two collaboration instances in real browsers (live convergence of ordinary edits waits for Phase 9); more than two concurrent users; restore of very large documents (Phase 10); automated browser E2E.

### 8.0e Phase 6 tests (written and run by Claude in a preparation environment, 2026-11-17)

**Environment:** Node v22.23.4 (the repo requires 24; `engine-strict` was overridden), pnpm 12.18.0, PostgreSQL 16 and Redis 7 from apt on Linux x64 (Compose uses PostgreSQL 17), `prisma generate` with the schema-engine download bypassed (no network to `binaries.prisma.sh`) and migrations applied with `psql`. Not run on the owner's machine, not run in Docker or CI. **No real browser was available**: "two browsers" below means two jsdom windows' worth of the real client code (`CollabSession`, the Hocuspocus provider, a TipTap editor on the collaborative document) connected over real WebSockets to the real collaboration server, PostgreSQL and Redis.

**Results.** Baseline before the change (the delivered zip): 43 files, 802 tests, all passing. After: **`pnpm test --testTimeout=30000`: 49 files, 878 tests, all passing (about 110 s)**. `pnpm lint` and `pnpm typecheck` clean. `prettier --check .` passes for every file Phase 6 created or changed; it still reports 22 Phase 3 files that Phase 6 did not touch (the same files, unmodified, are reported at the start of Phase 6 in this environment: `apps/api/src/routes/{invitations,page-permissions,pages,workspaces}.ts`, `apps/api/src/workspaces/{activity,pagination}.ts`, four API tests, nine web files and three shared/db tests) and `infra/docker-compose.yml` (YAML parse error), exactly as the Phase 5 preparation environment did; the owner's machine did not show either in Phase 5. They were deliberately left alone to keep the Phase 6 diff to Phase 6. The collab and web integration suites were run twice more in full after the last change (79 tests, all passing) and `apps/collab/test/sync.int.test.ts` four more times (13/13 each). **Flaky tests found and fixed while doing so (both were test races, not server defects):** an `endsWith` check that depended on the arrival order of a flooding client's last updates, and a "no write" check that raced the compaction on unload.

The test count dropped where Phase 4 tests were deleted with the code they covered (`page-content.int.test.ts`, `autosave.test.ts`, the autosave, conflict and read-only-save sections of `page-editor.test.tsx`).

| File | Project | Tests | Covers |
|---|---|---|---|
| `apps/collab/test/auth.int.test.ts` | integration | 23 | `WS`, `PERM`, `RO`, `SEC`: valid token; signature by another key, unknown `kid`, no `kid`, expired, wrong audience/issuer, issued in the future, one-hour lifetime, token for another page, not a JWT, empty, `alg: none`; invalid document names; foreign `Origin` (403); non-member; deleted and missing pages; revoked, expired and foreign sessions; `NONE` override; read-only override; permission inherited from a parent page; VIEWER and COMMENTER see live edits but cannot change the document or what is stored; offline edits of a read-only client are not accepted after reconnecting |
| `apps/collab/test/sync.int.test.ts` | integration | 13 | `SYNC`, `CE`, `PERSIST`, `SEED`: two clients both ways; late joiner; 3 and 5 concurrent editors (20 rounds each, every token exactly once); two pages open at once without cross-talk; page A's token refused for page B; stored and rebuilt after the debounce; no write for connect/idle/disconnect; a 60-keystroke burst makes fewer than 15 rows; compaction by count and on unload; failed stores retried and the document kept in memory; seeding from `page_contents` exactly once with four simultaneous openers; invalid interim content refuses to open and is not blanked |
| `apps/collab/test/resilience.int.test.ts` | integration | 7 | `RECON`, `REC`: reconnect after a network drop with a fresh token and offline edits merged; five drops in a row; catching up after absence; graceful shutdown stores pending changes (debounce 60 s, so only the flush can store them), tells clients (`server.shutting_down`, 1012) and clients recover after restart; crash with the database unreachable (nothing stored; the clients resend); a stopping server is not ready; `/health` and `/ready` |
| `apps/collab/test/access.int.test.ts` | integration | 10 | `EVENTS`, `REVALIDATE`: `session.revoked`, `member.removed`, page deleted, `NONE` override, `workspace.deleted`; downgrade to read-only and upgrade back (with `forceSync`); ignored events (other workspace, not JSON, wrong version, unknown type); a lost event found by revalidation; the timer; connections kept when PostgreSQL cannot be reached for the check |
| `apps/collab/test/abuse.int.test.ts` | integration | 9 | `ABUSE`, `LIMITS`: oversized frame closes (1009); malformed Yjs updates; document messages before authentication; random garbage frames; invalid application messages and the violation limit (4400); message flood (4429); per-user connection limit and slot release; ten simultaneous connects cannot overshoot the limit; client presence state is discarded |
| `apps/collab/src/units.test.ts` | unit | 9 | registry limits and reservations, rate window, access-event matching, wire-frame classifier on hostile input |
| `apps/api/test/collab-token.int.test.ts` | integration | 9 | `PAGE-10`: claims exactly as designed and no role; fresh `jti` per request; role hints; 404 for strangers, deleted pages and `NONE`; 401, foreign origin, malformed id; 503 without a key; 429 |
| `apps/web/src/lib/collab-session.test.ts` | unit | 20 | session phases, first-token reuse then fresh tokens, 404/403/503/network on the token endpoint, refusal reasons, `access.revoked`, downgrade (fresh document), upgrade (`forceSync`), invalid server messages, teardown |
| `apps/web/src/components/editor/page-editor.test.tsx` | unit (jsdom) | 34 | loading state, live document, connection states, read-only mirroring and following the server, unload warning, no page-content request, plus the retained toolbar, image and slash-command tests |
| `apps/web/test/two-browsers.int.test.ts` | integration (jsdom) | 8 | **`MB`:** 2, 3 and 4 editors, rich text and formatting, simultaneous typing in one place, viewer cannot change anything even by a forced programmatic edit, offline edits merged after reconnecting, server restart with recovery, revocation of one member, seeding of Phase 4 content exactly once for three simultaneous openers |
| `packages/shared/src/collab-protocol.test.ts`, `shared.test.ts` | unit | 17, 13 | claims, messages, envelope, events, close codes; env schemas (private key material refused for collab) |
| `tests/boundaries.test.ts`, `tests/startup.test.ts`, `tests/startup.int.test.ts` | unit / integration | 20, 7, 2 | `collab → editor` allowed, `editor → collab` and `api → editor` forbidden; fail-fast on missing, malformed or private collaboration keys without printing them; the real collab process starts, serves `/health` and `/ready`, and stops |

**Mapping to the task's test list:** two browsers on one document → `two-browsers` (2 clients) and `sync` (2 clients); three or more connections → `two-browsers` (3, 4), `sync` (3, 5); live propagation → both; disconnection and reconnection → `resilience`, `two-browsers`; unauthorized connections → `auth`, `abuse`; viewer and commenter restrictions → `auth`, `two-browsers`, `access`; server restart and recovery → `resilience`, `two-browsers`; multiple document subscriptions → `sync`, `abuse` (limits).

**Not tested (do not read these as passed):** a real browser (Chrome/Firefox/Safari); Docker and GitHub Actions; the owner's platform (Windows, Node 24, PostgreSQL 17); more than five editors or any load (LOAD, PERF-01 to PERF-05 remain unmeasured); two collab instances (Phase 9); PostgreSQL or Redis being stopped under a running server (store failures and revalidation failures are simulated by making calls fail, not by stopping the services); an idle connection for minutes (§17.8.6); reconnection after laptop sleep or a changing network; a reverse proxy in front of the WebSocket; browser Content-Security-Policy; real `Origin` headers from browsers (the test client sends one, and a raw socket sends a foreign one).

**Commands:** `pnpm test --testTimeout=30000` (needs the migrations deployed, PostgreSQL and Redis; the tests generate their own collaboration keys, so no key setup is needed). Collab suites only: `pnpm test apps/collab apps/web/test --testTimeout=30000`.

#### Owner verification on the owner's machine (2026-11-18)

**Environment:** Windows (Git Bash), Node v24.18.0, pnpm 12.18.0, PostgreSQL 17 (`postgres:17-alpine`, host port 5433) and Redis 7 (`redis:7-alpine`) from the project's Docker Compose, Prisma 7.10.1. Browser names and versions, CPU model and RAM were not recorded.

| Check | Result |
|---|---|
| `pnpm install`, `pnpm db:migrate:status` | Lockfile up to date; 5 migrations found, schema up to date |
| `pnpm lint`, `pnpm format:check` | Clean (the preparation environment's Phase 3 formatting findings did not appear) |
| `pnpm typecheck` | First run failed with 10 errors in `apps/collab/test/server.test.ts` and `server.int.test.ts`, the Phase 1 shell tests that still used the old server API. They are superseded by the Phase 6 suites and had not been deleted; after deleting them the run was clean in every project |
| `pnpm test --testTimeout=30000` | **49 files, 878 tests passed**; 185.56 s (the preparation environment: about 110 s) |

**Manual real-browser checks (owner-reported as working, HANDOVER §11.11).** Two accounts in two different browsers: live two-way editing and simultaneous typing; "Live" indicator; no cross-talk between two pages; Viewer downgrade and upgrade without a reload (edits after the upgrade reached the other browser); removal from the workspace while the page was open; no-access message for a direct address; collab server stopped and restarted while typing; one browser set Offline in DevTools and back; a Phase 4 page opened once and again after a reload (content appeared once); two minutes idle with nobody else on the page (stayed "Live"). These are manual observations without timings or recordings; they do not replace the automated `MB` tests, which run on jsdom.

**Update to the "Not tested" list above:** a real browser, the owner's platform (Windows, Node 24, PostgreSQL 17) and a two-minute idle connection are now covered by the manual run (partly: browser names were not recorded and only two accounts were reported). **Still not tested:** Docker and GitHub Actions; more than five editors or any load (LOAD, PERF-01 to PERF-05 unmeasured); two collab instances (Phase 9); stopping PostgreSQL or Redis under a running server; idle longer than two minutes; laptop sleep or a changing network; a reverse proxy; a browser Content-Security-Policy; a third browser; inspection of the collab log (HANDOVER §11.7 item 11); the revocation delay in seconds; automated browser E2E (Playwright).

### 8.0f Phase 7 tests (written and run by Claude in a preparation environment, 2026-11-18)

**Environment:** Node v22.23.5 (the repo requires 24; `engine-strict` was overridden), pnpm 12.18.0, PostgreSQL 16.15 and Redis 7.0.15 from apt on Linux x64 (Compose uses PostgreSQL 17), `prisma generate` with a stub schema-engine binary (`PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`; the real download is blocked there), migrations applied with `psql`. Not the owner's platform. **No real browser was used.**

**Results.** Baseline before the change (the delivered zip, same environment): 49 files, 878 tests, all passing. After: **`vitest run --testTimeout=30000`: 55 files, 966 tests, all passing (146 s)**. `eslint .` exit 0; `tsc --noEmit` exit 0 for `packages/shared`, `packages/editor`, `packages/db`, `apps/api`, `apps/collab`, `apps/web`. `prettier --check` passes for every file this phase added or changed; for the whole repository it fails on `infra/docker-compose.yml` (a YAML syntax error reported in the preparation environment, a file this phase did not touch).

New tests (88): `packages/shared/src/presence.test.ts` (29: identity rewriting, cursor validation, size limit, one entry per user, avatar helpers); `packages/editor/src/presence-caret.test.ts` (13: publish throttle, names written as text, carets and selections drawn and removed as decorations only, positions follow edits, hostile states ignored); `apps/collab/src/units.test.ts` (+4: awareness id ownership and takeover); `apps/collab/test/presence.int.test.ts` (17, real server: stamped identity, forged id/name/colour, client-id squatting, removing another person's presence, viewer and commenter presence, clean disconnect, cut network, revocation, expiry of an unrenewed state (record aged by 31 s), reconnection, two tabs, nothing written to PostgreSQL, rate limit without closing the connection, unauthenticated publish); `apps/web/src/lib/presence-tracker.test.ts` (8); `apps/web/src/components/editor/presence-bar.test.tsx` (8: avatars, count, keyboard list, announcements, hostile name, hook with a live awareness); `apps/web/test/presence-browsers.int.test.ts` (9: two and three simultaneous editors with the real session, provider, WebSocket and server; carets, names, selections, movement, blur, edits before a selection, viewer, two tabs, cut network and reconnection, provider rebuild). One Phase 6 test in `apps/collab/test/abuse.int.test.ts` was changed from "awareness is discarded" to "only the server-built identity is relayed".

**"Multiple browsers" here means** several jsdom editors, each with its own `CollabSession` and provider, in one process. They share one document, so each has its own stubbed focus (a window has its own; `hasFocus` is overridden per editor in the test).

**Not tested:** real browsers (caret label placement, clipping at the top of a page, avatar layout, focus and blur behaviour); the owner's platform; the 30 s expiry in wall-clock time; long idle connections; presence across several server instances; a profile change while connected.

**Owner verification of Phase 7 (2026-11-19, HANDOVER §12.11).** On the owner's Windows machine (Git Bash; PostgreSQL and Redis from Compose): install, package build, lint, format check and typecheck passed. `pnpm test --testTimeout=30000` ran **55 files and 966 tests: 965 passed, 1 failed (257.73 s)**. The failure was `apps/collab/test/sync.int.test.ts` > "keeps a document in memory and retries when PostgreSQL fails to store" (a Phase 6 test; line 231 expected `failingDocuments` to be 0 and got 1). That file alone passed 13 of 13 on four runs (9–10 s each), so it is **flaky under full-suite load** (likely a one-shot assertion made right after the stored row appears; not proven). The owner chose not to change the test. A manual checklist in real browsers (two accounts, a Viewer, a second tab, closing a browser, browser offline and back, focus and blur, reload with nothing persisted) was reported as working, without per-step detail or timings.

**Update to the "Not tested" list above:** real browsers and the owner's platform are now covered by the manual run. **Still not tested:** the 30 s expiry in wall-clock time; idle longer than two minutes with the 15 s awareness renewal; more than three users in real browsers; a profile change while connected; presence across several server instances; Docker and GitHub Actions; automated browser E2E (Playwright).