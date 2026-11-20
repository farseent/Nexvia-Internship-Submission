# CoNote – Technical Decisions

**Status:** Phase 1 infrastructure implemented and Phase 1b spike executed; Phase 2 authentication and user management implemented and locally verified. D41–D47 explicitly accepted by the project owner on 2026-11-13. Phase 2 GitHub Actions CI was deferred by the owner and later reported as passed by the owner (recorded 2026-11-15). Evidence and remaining limitations are tracked in HANDOVER.md. D54–D57 were accepted by the owner on 2026-11-16 and D58–D60 on 2026-11-18. D61 (Phase 7) is proposed and awaits owner review.
**Last updated:** 2026-11-19
**Owner:** Project owner (approvals) / Claude (drafting)

This is the permanent decision register for CoNote. Decision IDs (`D#`) and unresolved-question IDs (`U#`) are **permanent**: they are never renumbered or reused. A changed decision is recorded by adding a new decision that supersedes the old one and updating the old one's status.

## Status legend

| Status | Meaning |
|---|---|
| **Accepted** | Explicitly approved by the project owner. |
| **Accepted (requirement)** | Stated by the project owner as a project requirement. |
| **Proposed** | Drafted during Phase 0 and included in the Phase 0 package. Treated as the working plan unless the owner changes it. |
| **Unresolved** | Not yet decided. Listed in the "Unresolved decisions" section. |
| **Superseded** | Replaced by a later decision (none yet). |

## Decision index

| ID | Title | Status |
|---|---|---|
| D1 | Collaboration server: Hocuspocus | Accepted |
| D2 | Multi-instance sync: Redis fan-out | Accepted |
| D3 | Separate API service (`apps/api`) | Accepted |
| D4 | API framework: Fastify + Zod | Accepted |
| D5 | Custom authentication (Argon2id, DB sessions, httpOnly cookies) | Accepted |
| D6 | Same-origin proxy through Next.js rewrites | Accepted |
| D7 | Short-lived collaboration JWTs | Accepted |
| D8 | Comment anchors via Yjs Relative Positions | Accepted |
| D9 | Version restore as a new transaction | Accepted |
| D10 | S3-compatible image storage | Accepted |
| D11 | pnpm monorepo, no Turborepo | Accepted (requirement) |
| D12 | TypeScript strict mode | Accepted (requirement) |
| D13 | Dependency pinning and Node.js requirements policy | Accepted (requirement) |
| D14 | PostgreSQL is the durable source of truth; Redis is never permanent storage | Accepted (requirement) |
| D15 | Yjs persistence model: incremental updates + compacted state + snapshots | Proposed |
| D16 | Node.js 24 LTS baseline | Accepted (owner approval, 2026-11-12) |
| D17 | TypeScript 5.9.x pin | Accepted (owner approval, 2026-11-12) |
| D18 | Prisma 7.10.x pin (CLI and client together) | Proposed (see U5) |
| D19 | ioredis 5.6.x pin | Proposed |
| D20 | Tiptap 3.x + Yjs 13.x + `@tiptap/y-tiptap` | Proposed |
| D21 | Collab server accesses PostgreSQL directly | Proposed |
| D22 | Collaboration JWT format, revalidation and revocation | Proposed (refines D7) |
| D23 | Roles and effective-permission resolution | Proposed |
| D24 | Soft delete for pages | Proposed |
| D25 | API security baseline | Proposed |
| D26 | Testing toolchain | Proposed |
| D27 | Frontend baseline: Next.js 16, React 19, Tailwind 4 | Proposed |
| D28 | Roadmap structure (Phase 1 spike; Phases 5 and 6 separate) | Accepted |
| D29 | Identifier strategy | Proposed |
| D30 | Invitation token handling | Proposed |
| D31 | API versioning and response envelope | Proposed |
| D32 | Application-level realtime events | Proposed |
| D33 | Phase 1 delivered in two parts; collaboration spike deferred (Phase 1b) | Accepted (owner chose Phase 1b before Phase 2) |
| D34 | Operational endpoints return plain JSON with a `service` field | Proposed (Phase 1) |
| D35 | Baseline migration is empty; readiness "schema-compatible" definition | Proposed (Phase 1) |
| D36 | Internal packages compile to `dist`; apps resolve packages by built output | Proposed (Phase 1) |
| D37 | Object storage (MinIO) not in Docker Compose in Phase 1 | Proposed (Phase 1) |
| D38 | Collab shell accepts the WebSocket handshake but rejects every document connection | Proposed (Phase 1) |
| D39 | Tooling versions pinned beyond D11–D13 | Proposed (Phase 1) |
| D40 | Environment validation scope and rules | Proposed (Phase 1) |
| D41 | Readiness verifies that every shipped migration is applied (completes D35) | Accepted (owner approval, 2026-11-13) |
| D42 | Session configuration: day-based TTL variables; cookie name derived from `NODE_ENV` | Accepted (owner approval, 2026-11-13) |
| D43 | `TRUST_PROXY` is a list of trusted proxy addresses; V7 result and production proxy requirement | Accepted (owner approval, 2026-11-13) |
| D44 | Authentication runs in `preValidation`, after the rate limiter | Accepted (owner approval, 2026-11-13) |
| D45 | Rate-limit scopes, initial values and fail-closed behaviour | Accepted (owner approval, 2026-11-13) |
| D46 | Web authentication architecture (server guards, client state, tests) | Accepted (owner approval, 2026-11-13) |
| D47 | Phase 2 dependencies and the release-age gate | Accepted (owner approval, 2026-11-13) |
| D48 | Invitee can decline an invitation (`DECLINED` status, INV-07) | Accepted (owner approval, 2026-11-15) |
| D49 | Per-workspace advisory lock serializes structural changes | Accepted (owner approval, 2026-11-15) |
| D50 | Page ordering: code-unit comparison in the application, re-spacing at 48 characters | Accepted (owner approval, 2026-11-15) |
| D51 | Invitation lifecycle details: derived `EXPIRED`, generic error, email match, rate limit | Accepted (owner approval, 2026-11-15) |
| D52 | Phase 3 scope exclusions and deferrals | Accepted (owner approval, 2026-11-15) |
| D53 | Phase 3 web architecture (workspace shell, client data loading) | Accepted (owner approval, 2026-11-15) |
| D54 | Interim editor-content persistence and autosave (`page_contents`, revision compare-and-set) | Accepted (owner approval, 2026-11-16) (made under the owner's "do what is best for now" on 2026-11-15; approved after local verification) |
| D55 | Image upload flow, limits and storage adapter (partly resolves U7) | Accepted (owner approval, 2026-11-16) |
| D56 | Editor document schema v1 and Tiptap configuration | Accepted (owner approval, 2026-11-16) |
| D57 | Phase 5 Yjs integration: binding entry point, store design, persisted digest, seeding | Accepted (owner approval, 2026-11-16) (made under the owner's "do what is best for me"; approved after local verification) |
| D58 | `apps/collab` may import `@conote/editor` (to seed Yjs documents with the editor's own schema) | Accepted (owner approval, 2026-11-18) |
| D59 | Remove the interim page-content endpoints (CONTENT-01/02) and the HTTP autosave; keep `page_contents` as a read-only seed source | Accepted (owner approval, 2026-11-18) |
| D60 | Phase 6 collaboration server: token carries identity only, one socket per document, application messages, access changes and client resync rules, presence disabled until Phase 7 | Accepted (owner approval, 2026-11-18) |
| D61 | Phase 7 presence: server-stamped identity, one awareness client id per connection, validated cursor only, no persistence | Accepted (owner approval, 2026-11-19) |

---

## Accepted decisions

### D1 – Collaboration server: Hocuspocus

- **Status:** Accepted
- **Context:** The reference `y-websocket` server keeps documents in memory and its own README states it cannot be scaled easily. The `y-redis` alternative is labelled beta and is dual-licensed (AGPL or proprietary). A custom server would duplicate what Hocuspocus already provides.
- **Decision:** Use **Hocuspocus 4.x** (`@hocuspocus/server`, `@hocuspocus/provider`) as the Yjs collaboration server and client provider. Yjs (CRDT) remains the synchronization model.
- **Rationale:** MIT licensed; authentication and read-only hooks; a Redis extension for multi-instance operation; maintained alongside Tiptap.
- **Consequences:**
  - Hocuspocus is Yjs-compatible. **Wire compatibility with the plain `y-websocket` client is not assumed or required.** The client must use `HocuspocusProvider`.
  - Hocuspocus 4 requires Node.js >= 22 (from package metadata) and uses web-standard `Request`/`Headers` objects in hooks.
  - If Hocuspocus proves unsuitable in the Phase 1 spike, the fallback is a custom server on `y-protocols` (recorded as a new decision that supersedes D1).
- **References:** Hocuspocus docs (hooks, authentication, Redis); `y-websocket` and `y-redis` READMEs. See ARCHITECTURE.md §17.

### D2 – Multi-instance sync: Redis fan-out

- **Status:** Accepted
- **Context:** Several collab instances must serve clients of the same document.
- **Decision:** Use the **Hocuspocus Redis extension** (`@hocuspocus/extension-redis`) as the initial multi-instance strategy. Redis carries Yjs updates and awareness between instances. Sticky per-document routing is documented as a possible future optimization, not implemented initially.
- **Documented limitations (from the official Redis extension docs):**
  - The Redis extension **does not persist data**; persistence is a separate responsibility (D14, D15).
  - **All messages are handled on all instances**, so adding instances behind Redis adds connection capacity and availability, not CPU relief per document.
  - When a document is loaded on one instance while open on another, the load waits for the other instance's current state, bounded by `awaitInitialSyncTimeout` (default 1000 ms).
  - Storing a document is mutually exclusive across instances (an instance that is storing a document blocks the others).
- **Consequences:** Behaviour under Redis failure, duplicate persistence and awareness propagation must be verified in the Phase 1 spike (U3, U4) before Phase 6 relies on it.
- **References:** Hocuspocus Redis extension docs. See ARCHITECTURE.md §9.

### D3 – Separate API service

- **Status:** Accepted
- **Decision:** REST API and application services live in a separate Node.js service, `apps/api`. Next.js (`apps/web`) does not contain business logic or database access.
- **Consequences:** Three deployable services: `web`, `api`, `collab` (ARCHITECTURE.md §4).

### D4 – API framework: Fastify + Zod

- **Status:** Accepted
- **Decision:** Fastify 5 with Zod 4 validation (via `fastify-type-provider-zod`). Request and response schemas are defined in `packages/shared` and reused by the web client.
- **Consequences:** `fastify-type-provider-zod` 7.x has peer requirements `fastify ^5.5` and `zod >= 4.1.5` (package metadata, 2026-11-11); versions in PROJECT_MASTER.md §6 satisfy them.

### D5 – Authentication

- **Status:** Accepted
- **Decision:** Custom authentication:
  - Passwords hashed with **Argon2id** (`argon2` package). Initial parameters follow the OWASP Password Storage Cheat Sheet baseline (m = 19456 KiB, t = 2, p = 1) and are re-tuned on target hardware in Phase 2.
  - **Database-backed sessions.** The session token is 32 random bytes, base64url-encoded. Only a **SHA-256 hash** of the token is stored.
  - Token delivered in a **host-only `HttpOnly` cookie** (attributes in ARCHITECTURE.md §10).
  - Initial lifetimes: **7 days idle** (sliding) and **30 days absolute**. Tunable.
- **Consequences:** The Prisma `Session` model is required (DATABASE_SCHEMA.md). Users can list and revoke sessions.
- **References:** OWASP Password Storage, Session Management and CSRF Prevention cheat sheets.

### D6 – Same-origin proxy through Next.js rewrites

- **Status:** Accepted
- **Decision:** The browser talks only to the Next.js origin for REST. Next.js `rewrites()` forward `/api/*` to the API service (`API_INTERNAL_URL`). The session cookie is therefore host-only on the web origin. Server-side rendering code calls the API directly at `API_INTERNAL_URL` and forwards the cookie explicitly.
- **WebSocket exception:** WebSocket traffic does **not** go through Next.js rewrites. Browsers connect directly to the collab origin and authenticate with a collaboration JWT (D7), not cookies.
- **Consequences:** Phase 2 must verify, with tests, how the proxy forwards `Origin`, `Host`, `X-Forwarded-*` and `Set-Cookie` (these are not assumed). Configuration is documented in ARCHITECTURE.md §10.

### D7 – WebSocket authentication with short-lived JWTs

- **Status:** Accepted (details and refinements in D22)
- **Decision:** The API issues short-lived collaboration JWTs. The collab server authorizes every connection server-side and revalidates access when permissions change. Token expiry and revocation behaviour are documented in D22 and WEBSOCKET_PROTOCOL.md.

### D8 – Comment anchors via Yjs Relative Positions

- **Status:** Accepted
- **Decision:** Comment anchors are stored as **Yjs Relative Positions** (start and end, encoded). Comment threads and metadata live in PostgreSQL. Comments are **not** stored as ordinary editor content (no comment marks in the document).
- **Rationale:** Relative positions follow content as the document is edited concurrently. Because comments are created through REST, **commenters can comment over a read-only collaboration connection**.
- **Consequences:**
  - Anchors on deleted content must be handled ("detached" state).
  - Restoring a version replaces content and may detach anchors (D9, U8).
  - The editor must render highlights from comment data via editor decorations (Phase 8).
- **References:** Yjs Relative Positions API.

### D9 – Version restoration as a new transaction

- **Status:** Accepted
- **Decision:** Restoring a version is applied as a **new document transaction on top of existing history**; it does not rewind or delete history. A **pre-restore snapshot** of the current state is always created first. All previous snapshots are preserved. Active collaborators receive the restored state through normal Yjs synchronization and converge.
- **Consequences:** Restore is executed by the collab server (so it is serialized with live editing). Anchor handling is U8.

### D10 – Image storage

- **Status:** Accepted
- **Decision:** Images are stored in **S3-compatible object storage**: MinIO for local development if practical; an S3-compatible provider in production. Image storage sits behind a **storage adapter interface** in `apps/api` so it stays modular. Images are never stored in PostgreSQL.
- **Consequences:** Upload flow, limits and allowed types are U7. MinIO distribution/licensing status must be re-checked in Phase 1.

### D28 – Roadmap structure

- **Status:** Accepted
- **Decision:** Keep Phases 0–11. Phase 1 includes a **small disposable two-instance Hocuspocus + Redis + PostgreSQL proof of concept** that verifies cross-instance sync, awareness propagation, and persistence and recovery, and records the results and architectural implications. The complete collaboration feature is **not** built in Phase 1. **Phases 5 and 6 remain separate.**
- **Consequences:** See IMPLEMENTATION_PLAN.md Phase 1 and Phase 5/6 boundaries.

---

## Requirements-derived decisions

### D11 – pnpm monorepo, no Turborepo

- **Status:** Accepted (requirement)
- **Decision:** One repository using **pnpm workspaces** with this layout: `apps/web`, `apps/api`, `apps/collab`, `packages/db`, `packages/shared`, `packages/editor`. **Turborepo is not used initially**; plain pnpm workspace scripts are used until a measured need appears.
- **Module boundaries:** see ARCHITECTURE.md §5 (dependency rules enforced by lint).

### D12 – TypeScript strict mode

- **Status:** Accepted (requirement)
- **Decision:** All packages use `"strict": true` via a shared `tsconfig.base.json`. Additionally enabled: `noUncheckedIndexedAccess`. No `any` without a documented justification comment.

### D13 – Dependency pinning and Node.js requirements

- **Status:** Accepted (requirement)
- **Decision:**
  - Dependencies are pinned to **exact versions** in `package.json` (no `^` or `~` ranges); `pnpm-lock.yaml` is committed.
  - Node.js requirement is declared in `engines`, `.nvmrc`, Dockerfiles and CI, and documented in README.md.
  - Versions are chosen only after checking engine and peer-dependency metadata and official docs. Verified candidate versions and the verification date are in PROJECT_MASTER.md §6.
  - Version changes go through a decision update when they affect compatibility (e.g. Prisma, Hocuspocus, Tiptap, Yjs).
- **Note:** Version metadata was verified on **2026-11-11** against the npm registry (engines/peer dependencies). Runtime verification happens in Phase 1.

### D14 – PostgreSQL is durable truth; Redis is never permanent storage

- **Status:** Accepted (requirement)
- **Decision:**
  - PostgreSQL is the durable source of truth for **application data and collaborative document recovery**.
  - Redis holds only transient/coordination data (fan-out, locks, rate-limit counters, event pub/sub). Correctness must never depend on Redis data surviving.
  - **The project never claims zero data loss.** Persistence guarantees are defined in ARCHITECTURE.md §8 (G1–G7) and are claimed only after the corresponding tests in TESTING.md pass.

---

## Proposed decisions

### D15 – Yjs persistence model

- **Status:** Proposed
- **Context:** Storing the full document on every keystroke is explicitly rejected. Hocuspocus's Redis extension serializes stores across instances.
- **Decision (baseline design, to be validated by the Phase 1 spike):**
  1. **`DocumentUpdate`** – append-only rows holding *incremental* Yjs update binaries (diffs), ordered by a monotonically increasing sequence.
  2. **`DocumentState`** – one row per page holding the **compacted full state** (`foldedState`), the **persisted state vector** (coverage of the folded state plus all stored updates), and the highest update sequence folded into it (`foldedSeq`). It is also the per-page lock row.
  3. **`DocumentSnapshot`** – immutable full-state versions for version history (manual, automatic and pre-restore).
  4. **Write path:** on the collab server's debounced store hook, compute the diff between the live `Y.Doc` and the **last persisted state vector** and append it as one `DocumentUpdate` row. Never write the whole document per edit.
  5. **Compaction:** merge updates into `DocumentState` and delete the folded rows in one transaction, when a threshold is exceeded or a document unloads.
  6. **Recovery:** load `DocumentState`, apply `DocumentUpdate` rows with a higher sequence, in order.
- **Initial tunables (not performance claims; adjusted using spike and Phase 9 measurements):** store debounce 2000 ms, max debounce 10000 ms (Hocuspocus defaults, to be confirmed), compaction after 200 update rows or on unload.
- **Consequences:** Models and columns in DATABASE_SCHEMA.md; guarantees G2–G4 in ARCHITECTURE.md; open verification items U3. Authorship tracking is through `ActivityLog` (see ARCHITECTURE.md §13).

### D16 – Node.js 24 LTS baseline

- **Status:** Accepted (owner approval, 2026-11-12)
- **Context (as of 2026-11-11, per Node.js release-schedule sources):** Node 22 is in Maintenance LTS until 2027-04-30. Node 24 entered Maintenance on 2026-10-20 with end of life 2028-04-30. Node 26 became Active LTS on 2026-10-28 (end of life 2029-04-30) and is two weeks old. All planned dependencies accept Node 24 (Hocuspocus >= 22; Prisma ^20.19 / ^22.12 / >= 24; Vitest ^22.12 / ^24 / >= 26; Next.js >= 20.9).
- **Decision:** Develop and deploy on **Node.js 24 LTS** (latest 24.x patch, pinned in `.nvmrc`/Docker). Re-evaluate Node 26 later (U1).
- **Rationale:** Mature native-module ecosystem (`argon2`) and support through April 2028, avoiding a runtime that is only weeks into LTS.

### D17 – TypeScript 5.9.x

- **Status:** Accepted (owner approval, 2026-11-12)
- **Context:** The npm `latest` tag for TypeScript is 7.0.2 (2026-11-11). Prisma's requirement is TypeScript >= 5.4. Compatibility of the rest of the toolchain (Next.js type checking, Fastify and Zod types, ESLint tooling) with 7.x was **not verified** in Phase 0.
- **Decision:** Pin **TypeScript 5.9.3** initially. Revisit 6.x/7.x as a controlled upgrade (U2).

### D18 – Prisma 7.10.x

- **Status:** Proposed
- **Context:** On 2026-11-11 the npm `latest` tag for `@prisma/client` is 7.10.1, but the `latest` tag for the `prisma` CLI points to a release candidate (8.0.0-rc.33). CLI and client versions must match.
- **Decision:** Pin **`prisma` 7.10.1 and `@prisma/client` 7.10.1** (and `@prisma/adapter-pg` 7.10.1). Do **not** adopt the 8.x release candidate. PostgreSQL 17 is the target (supported by Prisma; 18 is also listed as supported).
- **Consequences:** Prisma 7 client/generator/driver-adapter/`prisma.config.ts` setup inside a pnpm monorepo is confirmed against official docs in Phase 1 (U5).
- **References:** Prisma system requirements; supported databases.

### D19 – ioredis 5.6.x

- **Status:** Proposed
- **Context:** `@hocuspocus/extension-redis` 4.8.0 depends on `ioredis ~5.6.1`. The newest `ioredis` on npm is 6.0.0.
- **Decision:** Pin **ioredis 5.6.x** everywhere (collab, api) so clients passed into the extension and the extension's own dependency use one major line. Upgrade only with Hocuspocus.

### D20 – Tiptap, Yjs and y-tiptap

- **Status:** Proposed
- **Decision:** Tiptap **3.33.1** packages (all pinned to the same version), Yjs **13.6.33**, `y-protocols` **1.0.7**, and `@tiptap/y-tiptap` as required by the Tiptap Collaboration extension's peer dependencies (`yjs ^13`, `@tiptap/y-tiptap ^3.0.7`).
- **Notes from official docs:** Disable StarterKit's built-in undo/redo when using the Collaboration extension (it has its own history handling). Use `@tiptap/extension-collaboration-caret` (the older `collaboration-cursor` name appears in some third-party guides and must not be used).
- **Consequence:** Tiptap docs still mention `y-prosemirror` in some install snippets; Phase 5 confirms exactly which Yjs binding package the pinned Tiptap version requires.
- **Phase 4 verification (2026-11-15):** the Tiptap 3.33.1 packages listed in D56 install together with consistent peer dependencies and pass the editor tests; the StarterKit `undoRedo: false` option works (AC-4.6). The owner's local run on 2026-11-16 confirmed the same (install, build, typecheck, 692 tests). The Yjs and `@tiptap/y-tiptap` pins were not exercised in Phase 4. *(Phase 5 note: D57 records the pins used; they were exercised and confirmed on the owner's machine on 2026-11-16, HANDOVER §10.9.)*

### D21 – Collab server uses PostgreSQL directly

- **Status:** Proposed
- **Decision:** `apps/collab` reads and writes `DocumentUpdate`, `DocumentState`, `DocumentSnapshot` and looks up effective permissions and session validity through `packages/db`. The API does not proxy Yjs traffic. The REST API reads snapshots but does not write collaborative document content.
- **Rationale:** One fewer network hop and no distributed transaction between services. Permission logic is shared as pure functions in `packages/shared`.

### D22 – Collaboration JWT, revalidation and revocation (refines D7)

- **Status:** Proposed
- **Token:**
  - Signed by the API using **EdDSA (Ed25519)** via `jose`; the collab server holds **public keys only** (so a compromised collab server cannot mint tokens). A `kid` header supports key rotation.
  - Claims: `iss` (`conote-api`), `aud` (`conote-collab`), `sub` (user id), `pid` (page id), `sid` (session id), `jti`, `iat`, `exp`.
  - **TTL: 60 seconds**, used only for the connection handshake. Issued by `POST /api/v1/pages/:pageId/collab-token` for a page the user can read.
  - The role is **not** trusted from the token. The collab server loads the authoritative effective role and session validity from PostgreSQL on connect.
- **Expiry behaviour:** Token expiry does **not** terminate an established connection. Clients obtain a fresh token for every (re)connection.
- **Revocation:** (1) The API publishes access-change events on a Redis channel (session revoked, member removed or role changed, page permission changed); collab instances downgrade (`readOnly`) or close the affected connections. (2) Because Redis pub/sub delivery is at-most-once, collab instances also **revalidate every open connection periodically** (initial default 60 s). The maximum exposure after revocation is therefore bounded by event delivery or the revalidation interval, whichever applies; this is a target to be verified by permission tests, not a proven figure.
- **Alternatives considered:** HS256 shared secret (simpler, but collab could mint tokens).
- **References:** `jose` library docs; Hocuspocus authentication guide.

### D23 – Roles and effective-permission resolution

- **Status:** Proposed
- **Workspace roles:** `OWNER`, `ADMIN`, `EDITOR`, `COMMENTER`, `VIEWER`. Exactly one `OWNER` per workspace (ownership can be transferred).
- **Page access roles (overrides):** `NONE`, `VIEWER`, `COMMENTER`, `EDITOR`, stored per user per page.
- **Resolution for user U on page P (first match wins):**
  1. U is `OWNER` or `ADMIN` of P's workspace → full access (cannot be restricted).
  2. A page override for U on P.
  3. The override for U on the nearest ancestor page (walking `parentId` upwards).
  4. U's workspace role mapped to the same-named page capability (`EDITOR`, `COMMENTER`, `VIEWER`).
  5. Otherwise no access.
  `NONE` denies access. Non-members of the workspace never have access (external guests are out of scope, U9).
- **Capabilities** (capability matrix in PROJECT_MASTER.md §5): `VIEWER` reads; `COMMENTER` reads and comments; `EDITOR` reads, comments, edits, creates child pages, moves and deletes pages; `ADMIN`/`OWNER` additionally manage members, invitations, page permissions and workspace settings (only `OWNER` deletes the workspace or transfers ownership). Only the `OWNER` may grant or revoke `ADMIN`; Admins manage Editor/Commenter/Viewer members and may remove only non-Admin members.
- **Consequence:** The resolution function lives in `packages/shared` as a pure function and is unit-tested exhaustively; API and collab both call it.

### D24 – Soft delete for pages

- **Status:** Proposed
- **Decision:** Deleting a page sets `deletedAt` on the page and its descendants (soft delete) and removes it from normal views. Restore is possible by an `EDITOR` or higher until a purge job permanently deletes it (initial retention 30 days, tunable). Document updates and snapshots are removed on purge via cascade.

### D25 – API security baseline

- **Status:** Proposed
- **Decision:** `@fastify/helmet`, `@fastify/cors` (explicit allow-list of origins), `@fastify/rate-limit` (Redis-backed counters; stricter limits on auth and invitation endpoints), `@fastify/cookie`. State-changing requests require a JSON content type and a validated `Origin` header (CSRF defence in depth on top of `SameSite=Lax`). All inputs validated with Zod. Details in ARCHITECTURE.md §10 and the security sections of API_CONTRACTS.md.

### D26 – Testing toolchain

- **Status:** Proposed
- **Decision:** **Vitest** (unit, integration, API, database, WebSocket tests; Vitest 5.1 requires Node ^22.12 / ^24 / >= 26), **Playwright** (multi-browser and end-to-end), and a custom **Node.js Yjs client harness** for concurrent-editing, reconnection, recovery and load tests. Databases for tests run in Docker. No performance numbers are asserted until measured.

### D27 – Frontend baseline

- **Status:** Proposed
- **Decision:** Next.js **16.4.6** (App Router), React **19.3.1**, Tailwind CSS **4.3.5**. Next.js 16 requires Node >= 20.9 and React ^19 (package metadata).

### D29 – Identifier strategy

- **Status:** Proposed
- **Decision:** Primary keys are UUIDs generated by Prisma (`@default(uuid())`, stored as PostgreSQL `uuid`). `DocumentUpdate` uses a `BigInt` auto-increment sequence for ordering. Public URLs use the page/workspace UUID.

### D30 – Invitation token handling

- **Status:** Proposed
- **Decision:** Invitation tokens are 32 random bytes (base64url), **single use**, **bound to the invited email address**, expire after **7 days** (tunable), and only a **SHA-256 hash** is stored. The raw token appears only in the invitation link. Acceptance requires an authenticated user whose email matches the invitation. Delivery by link first; email delivery is U6.

### D31 – API versioning and response envelope

- **Status:** Proposed
- **Decision:** REST routes are prefixed `/api/v1`. Every response uses one envelope: success `{ "success": true, "data": ..., "meta"?: ... }`; error `{ "success": false, "error": { "code", "message", "details"?, "requestId" } }`. Full specification in API_CONTRACTS.md.

### D32 – Application-level realtime events

- **Status:** Proposed
- **Decision:** Document-scoped application events (e.g. access revoked, version restored, comments changed) travel as **Hocuspocus stateless messages** on the document connection, clearly separated from Yjs sync and awareness traffic. There is **no workspace-level realtime channel in the MVP**; the page tree and member lists refresh by re-fetching (on focus and on user actions). Join/leave notifications are derived from awareness changes on the client.
- **Client-to-server commands:** creating a manual snapshot and restoring a version (`version.create`, `version.restore`) use the same stateless mechanism, authorized by the connection's read-write role, because they must be serialized with live editing by the collab server (D9, D21). Listing and reading versions are REST.
- **Consequence:** The message catalog is in WEBSOCKET_PROTOCOL.md. A workspace-level channel may be added later as a new decision.

---

### D33 – Phase 1 delivered in two parts; collaboration spike deferred (Phase 1b)

`docs/IMPLEMENTATION_PLAN.md` Phase 1 includes a disposable collaboration spike (S1–S11, AC-1.8–1.10) and the resolution/qualification of U3/U4/V1–V6/V11–V14. The owner's original Phase 1 task list covered infrastructure only, so delivery was split into Phase 1a and Phase 1b. **Phase 1a is complete based on the owner-reported evidence in HANDOVER.md; Phase 1b remains outstanding. The owner has explicitly chosen to run Phase 1b before Phase 2.** Phase 2 must not start until the spike is completed, its results reviewed, and the owner separately approves Phase 2.

### D34 – Operational endpoints return plain JSON with a `service` field

`GET /health` returns `{status:"ok",service}` and `GET /ready` returns `{status,service,dependencies:{postgres,redis}}` on both API and collab (and `/health` on web). They are not wrapped in the D31 envelope (API_CONTRACTS §13 says they are not under `/api/v1`). The `service` field is an addition to the contract. API readiness is `not_ready` (503) only when PostgreSQL is not healthy; collab readiness is `degraded` (200) when only Redis is down.

### D35 – Baseline migration is empty; readiness "schema-compatible" definition

`packages/db/prisma/schema.prisma` has no models in Phase 1 (the first models, User and Session, arrive in Phase 2). One baseline migration (`20261111000000_baseline`, SQL `SELECT 1;`) exists so that `prisma migrate deploy` has something to apply and the migration pipeline can be exercised in CI before real schema exists. "Schema-compatible" in readiness currently means: `_prisma_migrations` exists and contains no failed (unfinished, not rolled back) migration. It does **not** compare applied migrations with the migrations the running build expects; that must be added once real models exist (Phase 2). **Completed in Phase 2 by D41.**

### D36 – Internal packages compile to `dist`

`@conote/shared`, `@conote/db` and `@conote/editor` are built with `tsc` to `dist/` and export only `dist` (types and JS). Apps resolve them by package name, so `pnpm run build:packages` must run before app typecheck/tests/dev (the root `typecheck`, `test*` scripts do this). `@conote/db` build runs `prisma generate` first; the generated client lives in `packages/db/src/generated/` (git-ignored) and is compiled into `dist/generated`.

### D37 – Object storage not in Docker Compose in Phase 1

The plan lists S3-compatible storage (MinIO "if practical", U7). The owner's Phase 1 task list did not include it, no Phase 1–3 feature uses it, and MinIO's current official image distribution could not be verified. **U7 stays open**; add the storage service in Phase 4 after verifying distribution/licensing.

### D38 – Collab shell rejects every document connection

Hocuspocus accepts connections unless a hook refuses them. The Phase 1 collab process therefore throws in `onConnect` for every document connection, so an unauthenticated open collaboration endpoint never exists. The WebSocket upgrade handshake itself succeeds (this proves the WebSocket server is running); Phase 6 replaces the hook with real authentication.

### D39 – Tooling versions pinned beyond D11–D13

Exact pins added: ESLint 10.14.0, `@eslint/js` 10.0.1, typescript-eslint 8.72.2 (supports TypeScript `<6.1`), `@next/eslint-plugin-next` 16.4.6, eslint-plugin-react-hooks 7.1.1, globals 17.14.0, Prettier **3.9.10**, `@types/node` 24.19.2 (matches Node 24), tsx 4.23.15, pino 10.4.0, pino-pretty 13.2.0, ioredis 5.6.1, pg 8.23.1, `@prisma/adapter-pg` 7.10.1, yjs 13.6.33, y-protocols 1.0.7, `@tailwindcss/postcss` 4.3.5, zod 4.6.7. Prettier 3.10.0 (released 2026-11-11) was rejected by pnpm 12's release-age supply-chain gate; 3.9.10 (2026-10-10) is used instead rather than excluding the package from the gate. pnpm 12 requires explicit build-script approval: `allowBuilds` in `pnpm-workspace.yaml` allows only `@prisma/engines`, `prisma` and `esbuild`. TypeScript stays 5.9.3 (U2).

### D40 – Environment validation scope and rules

Zod schemas live in `@conote/shared` (`apiEnvSchema`, `collabEnvSchema`, `webEnvSchema`, `dbEnvSchema`); `parseEnv(scope, schema, source)` is pure. Each process validates at startup and exits non-zero on failure. Error messages list variable names and reasons only, never values. Only variables used by the current phase are validated; later phases add theirs with their code. `NODE_ENV` has no default and must be set. Web validates in `instrumentation.ts` at server start.

### D41 – Readiness verifies that every shipped migration is applied (completes D35)

- **Status:** Accepted (owner approval, 2026-11-13; Option A)
D35 deferred this to Phase 2: "schema-compatible" is now the migration history table existing, containing no failed migration, **and containing every migration directory shipped with this build** (`packages/db/prisma/migrations`, read at runtime relative to the package; `prisma` is in the package's `files`, so `pnpm deploy` images include it). Applied migrations that this build does not know (a newer schema during a rolling deploy) are tolerated; rolled-back rows do not count as applied. A missing migrations directory makes readiness `unavailable` rather than silently skipping the check. `checkDatabase` accepts `expectedMigrations` for tests.

### D42 – Session configuration: day-based TTL variables; cookie name derived from `NODE_ENV`

- **Status:** Accepted (owner approval, 2026-11-13; proposed configuration)
The session lifetimes are `SESSION_IDLE_TTL_DAYS` (default 7, 1–365) and `SESSION_ABSOLUTE_TTL_DAYS` (default 30, 1–365), the provisional names listed in DEPLOYMENT.md. The cookie name is not configurable: `__Host-conote_session` when `NODE_ENV=production`, otherwise `conote_session` (the `__Host-` prefix requires `Secure`, which browsers refuse over plain HTTP outside localhost). `SESSION_COOKIE_NAME` from the earlier DEPLOYMENT.md draft is therefore not used. The `Secure` attribute follows `NODE_ENV=production`. Consequence for the optional Compose `apps` profile, which runs production mode over plain `http://localhost:3000`: whether a browser stores a `Secure` / `__Host-` cookie from an `http://localhost` origin differs between browsers (Safari is commonly reported to refuse it). **This was not tested**; if sign-in appears to succeed but the next page shows the login page, check this first, or run the apps profile behind HTTPS.

### D43 – `TRUST_PROXY` is a list of trusted proxy addresses; V7 result and production proxy requirement

- **Status:** Accepted (owner approval, 2026-11-13; Option A)
`TRUST_PROXY` is a comma-separated list of IPs, CIDR ranges or the keywords `loopback`, `linklocal`, `uniquelocal` (empty = trust none, the default). A boolean or a hop count was rejected: Fastify 5.12 deliberately ignores numeric values (it cannot validate the immediate peer), and `true` would trust a client-supplied left-most entry. With an address list the client address is the first untrusted entry from the right, and `X-Forwarded-For` from an untrusted peer is ignored (both tested). **V7 was measured** (ARCHITECTURE §10.3): Next.js 16.4.6 forwards `Origin`, `Cookie`, `Content-Type`, the body and `Set-Cookie` but **does not set `X-Forwarded-For`/`X-Forwarded-Proto` and passes a client-supplied `X-Forwarded-For` through unmodified.** Hence production needs a reverse proxy in front of the web app that sets `X-Forwarded-For`, with the web app reachable only through it. Without it IP-based rate limits are either shared by all clients (nothing trusted) or forgeable (web tier trusted). This is a deployment requirement, not something the application can fix; per-account limits are unaffected.

### D44 – Authentication runs in `preValidation`, after the rate limiter

- **Status:** Accepted (owner approval, 2026-11-13; Option A)
Fastify validates the body before `preHandler`, so a `preHandler` guard returned `400` to unauthenticated callers (found by the Phase 2 tests). The guard is a `preValidation` hook: order is Origin/Content-Type check and rate limiter (`onRequest`) → body parsing → authentication → validation → handler. Unauthenticated callers always get `401`; unauthenticated work is bounded by the rate limiter and the 64 KiB body limit.

### D45 – Rate-limit scopes, initial values and fail-closed behaviour

- **Status:** Accepted (owner approval, 2026-11-13; Option A)
Per-IP limits use `@fastify/rate-limit` per route (`global: false`); account-scoped limits (login per email, password change per user) call the plugin's `createRateLimit` with a non-IP key and the same Redis store. Values are in API_CONTRACTS §3.1 and in `apps/api/src/config.ts` (`DEFAULT_RATE_LIMITS`); they are **untuned starting points**, not measured. All attempts count (including successful logins), so an exceeded per-email limit also refuses the correct password for the window; the cost is that someone who knows an email can block password login for that account for up to 15 minutes. If Redis is unreachable every rate-limited endpoint returns `503` (fail closed; no per-process fallback was approved). A Redis outage therefore also blocks authenticated requests, because the general limit applies to them.

### D46 – Web authentication architecture

- **Status:** Accepted (owner approval, 2026-11-13; Option A)
Protected pages call `requireUser()` (server component, asks the API with the forwarded cookie); the `(app)` layout does too, but layouts are not re-run on client navigation, so each page repeats the check. A failed lookup other than `401` (API down) throws to the error page rather than showing the login page. The root layout seeds a client `AuthProvider` with the user; actions go through `/api/v1/*` same-origin, and any `UNAUTHENTICATED` answer signs the UI out and returns to `/login`. No `next`/return-URL parameter (avoids open-redirect handling) and no Next.js middleware/proxy file. Only the public profile is held in client state; the session token is never readable by scripts. Frontend flows are tested with jsdom component tests plus an HTTP-level test of the real Next.js server; **browser E2E (Playwright, D26) is not yet implemented**.

### D47 – Phase 2 dependencies and the release-age gate

- **Status:** Accepted (owner approval, 2026-11-13; proposed dependency set)
`apps/api`: `argon2` 0.45.2 (native; added to `allowBuilds`), `@fastify/cookie` 11.1.5, `@fastify/cors` 11.4.1, `@fastify/helmet` 13.2.0, `@fastify/rate-limit` 11.2.2, `fastify-type-provider-zod` 7.0.0, `zod` 4.6.7. `apps/web` dev-only: `jsdom` 30.1.3, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.8. `user-event` 14.6.10 (published 2026-11-12) and a first `jsdom` 31.0.0 (2026-11-05, a new major) were not used: pnpm had added a `minimumReleaseAgeExclude` entry for 14.6.10, which was removed in favour of an older version, consistent with D39. No package is excluded from the gate. Engines were checked against Node 24.


### D48 – Invitee can decline an invitation

- **Status:** Accepted (owner approval, 2026-11-15)
- **Context:** The Phase 3 task lists "accept and reject invitations". API_CONTRACTS had only INV-03 (an admin revokes) and INV-06 (accept); the invitee had no way to refuse.
- **Decision:** Add `DECLINED` to `InvitationStatus` and `POST /api/v1/invitations/decline` (INV-07): authenticated, token in the body, same checks as accept (pending, unexpired, signed-in email equals invited email), one generic `INVITATION_INVALID` otherwise. `revokedAt` doubles as the "closed at" timestamp for declined invitations (no new column). Activity action `member.declined`. A declined address can be invited again.
- **Consequences:** One enum value in the migration; the invitee-facing UI is the `/invite` page (token link), not an inbox. There is deliberately no "list invitations addressed to me" endpoint: invitations stay bearer-link based (D30).

### D49 – Per-workspace advisory lock for structural changes

- **Status:** Accepted (owner approval, 2026-11-15). Implements the PAGE-05 design note; extended to membership changes.
- **Decision:** Page create/move/delete/restore/purge, member role changes, member removal, ownership transfer, invitation creation/acceptance and page-permission changes take `pg_advisory_xact_lock(hashtextextended(workspaceId, 0))` at the start of their transaction. Authorization reads that precede the transaction are repeated inside it where a concurrent change could invalidate them (membership, ownership).
- **Consequences:** Structural operations of one workspace are serialized; reads and page-content writes are not affected. Contention is acceptable at the target scale (D12). The deferred owner trigger and the partial unique index remain the last line of defence for the one-owner invariant.

### D50 – Page ordering: code-unit comparison and re-spacing

- **Status:** Accepted (owner approval, 2026-11-15)
- **Decision:** `Page.position` is a base-36 fractional key (`packages/shared/src/page-position.ts`, written in-repo, no new dependency). Siblings are ordered by plain code-unit string comparison in the API and web client, never by a database collation (`ORDER BY` under a locale collation would reorder keys). New keys longer than 48 characters trigger re-spacing of all siblings of that parent to short evenly spaced keys (column limit 64). A restored page is placed last among its siblings, because its old key may collide with siblings added since.
- **Consequences:** Appending repeatedly lengthens keys by about one character per five appends; re-spacing happens roughly every few hundred appends under one parent. Property tests cover ordering, validity and re-spacing.

### D51 – Invitation lifecycle details

- **Status:** Accepted (owner approval, 2026-11-15)
- **Decision:** `EXPIRED` is derived (`PENDING` and past `expiresAt`), never stored. Creating an invitation for an address whose only pending invitation has expired retires that row as `REVOKED` (it would otherwise block the one-pending-per-email index). Preview, accept and decline return one generic `INVITATION_INVALID` for unknown, used, expired, revoked and wrong-account tokens. Accept requires the signed-in email to equal the invited email. Preview and accept/decline share the stricter `invitation` rate-limit rule (20 per 15 minutes per client address). Resend rotates the token and extends the expiry. Invitation links are returned only by INV-01 and INV-04, never by listing.
- **Consequences:** The email in the preview is masked (`j***@example.com`). No email is sent in Phase 3 (D52).

### D52 – Phase 3 scope exclusions and deferrals

- **Status:** Accepted (owner approval, 2026-11-15)
- **Decision:** Not implemented in Phase 3, with reasons: (1) **Page search**: no search requirement exists in PROJECT_MASTER or IMPLEMENTATION_PLAN, so it is outside the approved scope the task refers to; (2) **Invitation email adapter**: U6 (email provider) is undecided and logging a link would put a bearer token in logs; invitations are link-based and shown once to the admin; (3) **Development seed data** and **Playwright E2E**: not required to meet the Phase 3 acceptance criteria; AC-3.11 is covered by API-level flow tests instead; (4) **PAGE-10** (collaboration token) belongs to Phase 6; (5) account deletion must transfer or delete owned workspaces first (the owner trigger rejects an ownerless workspace), to be handled when account deletion is designed; (6) lists are requested with limit 100 and have no paging controls in the UI.
- **Consequences:** Each item is recorded in HANDOVER as a known limitation.

### D53 – Phase 3 web architecture

- **Status:** Accepted (owner approval, 2026-11-15)
- **Decision:** Route pages are thin server components (the `(app)` layout guards with `requireUser()`); data is loaded by client components through the typed API client and `useAuth().guard`, which signs the UI out on `UNAUTHENTICATED`. A workspace layout (`WorkspaceShell`) loads the workspace and the flat page list once and shares them by context; the page tree is built client-side with the same sibling order as the server. The web client uses shared pure functions (`decideRoleChange`, `decideRemoval`, `canInviteWithRole`) only to enable or disable controls; the server remains the sole authority. The invitation token is read from the URL fragment in the browser and, if sign-in is needed first, kept in `sessionStorage` for the tab only.
- **Consequences:** The stale Phase 1 `app/page.tsx` placeholder is removed (it shadowed the `(app)` home page, see HANDOVER §7.9 finding 1). Verification (2026-11-15) added two details: the page and workspace views remount per id (`key`) so local state resets without effects, and `useLoad` derives `loading` from the settled request rather than setting it in an effect, to satisfy `react-hooks/set-state-in-effect`; neither changes the architecture above.

### D54 – Interim editor-content persistence and autosave

- **Status:** Accepted (owner approval, 2026-11-16, after the local verification in HANDOVER §9.11). Made on 2026-11-15 when the owner answered "do what is best for now" to the question whether Phase 4 should persist content, after being told this conflicts with IMPLEMENTATION_PLAN ("persistence of document content … autosave is Phase 6") and with D15 (Yjs-based persistence). **Approved explicitly by the owner on 2026-11-16; it remains an interim, removable stop-gap (see "Reversal / migration" below).** Local verification: autosave, reload persistence, the two-tab conflict (both choices), offline retry and read-only roles were exercised in a browser by the owner on 2026-11-16.
- **Context:** The Phase 4 task requires loading existing pages, saving, autosave and "saved content can be loaded again", while the plan keeps persistence for Phase 6 and forbids Yjs before Phase 5.
- **Decision:** Persist the editor document as validated ProseMirror JSON in a separate table `page_contents` (one row per page: `schemaVersion`, `content` JSONB, `revision`, `updatedById`, `updatedAt`), behind two interim endpoints, `CONTENT-01` (read, `PAGE≥VIEWER`) and `CONTENT-02` (save, `PAGE≥EDITOR`). A save carries the `baseRevision` it is based on and is a compare-and-set (`baseRevision = 0` inserts, otherwise `UPDATE … WHERE revision = baseRevision`); a mismatch is `409 CONFLICT`, so a stale tab can never overwrite newer content. Content is validated (D56) on write, and again when it is read (a stored document that no longer validates is a `500`, never something the editor could overwrite). Limits: 1 MiB serialized, 20 000 nodes, depth 24. The web client autosaves after 1.5 s without typing (at most every 10 s while typing), one request in flight, transient failures retried with growing delays (2/5/10/30 s) while the changes stay in the editor, saves again when the tab is hidden or the editor unmounts, asks the browser to confirm leaving with unsaved changes, and stops on conflict (choose latest or overwrite), permission loss or refused content.
- **Rationale:** Satisfies the task's acceptance criteria without touching the Yjs design: a separate table is a self-contained, removable stop-gap, `Page` is unchanged, and the JSON is what a `Y.Doc` is built from, so Phase 5 can seed Yjs state from it.
- **Consequences / risks:** (1) It is a **second source of truth** for page content until Phase 6; nothing else may depend on it. (2) No collaboration, so concurrent editors get conflicts, not merges. (3) Last-writer-wins on "overwrite" is a deliberate user choice. (4) Retries are lost if the tab is closed while offline (the browser warns before closing). (5) No history or recovery beyond the latest revision.
- **Reversal / migration:** Phase 5/6 imports each `page_contents.content` into the Yjs document store for pages without a document state (`prosemirrorJSONToYDoc`), then drops `page_contents`, `CONTENT-01/02`, `savePageContent` and the autosave hook's HTTP save. The shared validator stays.

### D55 – Image upload flow, limits and storage adapter

- **Status:** Accepted (owner approval, 2026-11-16). **Partly resolves U7;** the production storage backend stays open. Local verification: image insert by button, paste and drag-and-drop, reload persistence and the type/size rejections were exercised in a browser by the owner on 2026-11-16 (local-disk adapter only).
- **Decision:** Three-step flow behind a storage adapter interface (`apps/api/src/storage`): `ASSET-01` authorize (creates a `PENDING` `Asset`, server-generated key `<workspaceId>/<assetId>`, returns an upload target), upload of the bytes, `ASSET-02` confirm (the API checks that the object exists, that its size equals the announced size and that its leading bytes are really the announced image type; otherwise `409` and the object is deleted), `ASSET-03` read (`PAGE≥VIEWER`, `404` otherwise). Allowed types: PNG, JPEG, GIF, WebP; **SVG is refused** (it can carry script and is served from the application origin). Limit: **5 MiB** per image (starting value). Authorization is valid 10 minutes; unconfirmed uploads older than 24 hours and images of purged pages are removed hourly by `asset-cleanup`. Documents reference images only by the stable URL `/api/v1/assets/<id>`.
- **Storage backend now:** a **local-disk adapter** (`ASSET_STORAGE_DIR`, default `.data/assets`), for which the "upload target" is `ASSET-04 PUT /api/v1/assets/:assetId/content` on the API itself (raw bytes, the announced `Content-Type`, uploader only). `ASSET-04` is exempt from the JSON-only content-type rule (D25) for those four image types only; the Origin check still applies. `ASSET-03` streams the bytes; an S3-compatible adapter would redirect to a presigned URL.
- **Not done (deferred, still open after D55 approval; owner decision needed):** the S3-compatible adapter, MinIO (or alternative) in Docker Compose and the check of MinIO's current distribution/licensing (U7, D37), and avatar upload (`AVATAR` exists in the enum only; `USER-02 avatarAssetId` is not implemented). Reason: none of it can be executed or verified in the environment this phase was built in, and unverified storage code would be worse than none.
- **Consequences / risks:** The local adapter works for one API instance with a persistent volume; several instances need shared storage. The Docker `apps` profile has no volume for it yet, so images there live in the container's file system. Responses carry the API-wide `Cache-Control: no-store`, so images are re-fetched on every page load. Images deleted from a document stay on disk (no content scan until Phase 5+). Image `alt` text defaults to the file name and cannot yet be edited in the UI.

### D56 – Editor document schema v1 and Tiptap configuration

- **Status:** Accepted (owner approval, 2026-11-16). Includes the verification that D20's pins work. Local verification: every toolbar control and slash command was exercised in a browser by the owner on 2026-11-16.
- **Decision:** The persisted format is ProseMirror JSON (`editor.getJSON()`), **schema version 1**: `doc`, `paragraph`, `heading` (levels 1–3), `text`, `hardBreak`, `bulletList`, `orderedList`, `listItem`, `taskList`, `taskItem`, `table`, `tableRow`, `tableHeader`, `tableCell` (no nested tables), `image`; marks `bold`, `italic`, `underline`, `link` (`http`, `https`, `mailto` only); `textAlign` on paragraphs and headings. StarterKit's blockquote, code, code block, horizontal rule and strikethrough are **disabled** because FR-ED-01 … FR-ED-08 do not include them. The rules live once, in `packages/shared/src/editor-content.ts` (node/mark/attribute rules, content expressions, limits); the editor's table cells read their content rule from it, and `packages/editor` tests compare the shared model with the real ProseMirror schema node by node and run a corpus through both validators. Extensions are registered through an `ExtensionRegistry` of features (extensions plus slash commands); a feature that adds nodes or marks requires a schema version bump and a validator change. Built-in undo/redo is removed by `createDefaultRegistry({ undoRedo: false })` (AC-4.6). The slash menu uses Tiptap's official `@tiptap/suggestion`; no custom ProseMirror plugins were written.
- **Versions:** all `@tiptap/*` packages 3.33.1 (D20; released 2026-11-10, five days before use), `@floating-ui/dom` 1.8.0 (peer of `@tiptap/suggestion`, used to position the slash menu). The extra packages beyond StarterKit are `extension-image`, `extension-table`, `extension-text-align`, `extension-list` (task list), `extensions` (placeholder), `suggestion`.
- **Findings:** On 2026-11-16 the owner found that the delivered tree lacked the Tiptap dependency declarations (see HANDOVER §9.11); with the versions above declared in `packages/editor` and `apps/web`, `pnpm install` added 55 packages and the build, typecheck and tests passed. StarterKit 3 already includes Link, Underline and a trailing-node extension. Chaining `addRowAfter` and `addColumnAfter` in one command chain duplicated the table in jsdom, so the toolbar issues one table command per click (a test asserts one table remains).
- **Consequences:** Pasted external or `data:` images and unsupported formatting are dropped rather than stored. Image width/height attributes are accepted by the validator but the UI does not set them yet.

### D57 – Phase 5 Yjs integration (binding, store, digest, seeding)

- **Status:** Accepted (owner approval, 2026-11-16). Proposed on 2026-11-16 after the owner accepted Phase 4, asked for Phase 5 and delegated the remaining choices ("do what is best for me"). The implementation was first executed in a preparation environment (HANDOVER §10.8) and then verified on the owner's machine (HANDOVER §10.9); the owner then accepted the decision.
- **Context:** Phase 5 must bind Tiptap to a `Y.Doc` and provide a durable, tested document store without a network server (IMPLEMENTATION_PLAN Phase 5).
- **Decisions:**
  1. **Binding package (resolves V9):** `@tiptap/extension-collaboration` 3.33.1 with `@tiptap/y-tiptap` **3.0.7** (the minimum of the peer range `^3.0.7` recorded in D20; the newest 3.x, 3.3.0, was found and not adopted: 3.0.7 installed without peer warnings and passed every Phase 5 test, so the pin stays until a bump is tested), `yjs` 13.6.33, `y-protocols` 1.0.7 (peer of `y-tiptap`). Rich text lives in the `Y.XmlFragment` named `default` (`YJS_FRAGMENT_NAME`, Tiptap's default field). The binding is exported as `@conote/editor/collaboration`, so the Phase 4 single-user editor does not load it until Phase 6 switches the web app over; `createCollaborativeRegistry(doc)` is `createDefaultRegistry({ undoRedo: false })` plus the Collaboration extension.
  2. **Pure Yjs helpers in `packages/shared`** (`yjs.ts`, `collab.ts`): `DocumentReplica` (local/remote update handling with origins `REMOTE_ORIGIN`/`STORE_ORIGIN`, sync step 1/2), `mergeStateVectors` (per-client maximum), `encodeDocumentCoverage`, document-name helpers. `yjs` is a dependency of `shared` (it is pure computation; `sideEffects: false` was added). Rationale: both the browser and the server need exactly these functions.
  3. **Store (`DocumentStore` in `packages/db`):** `appendDiff`, `load`, `compact`, `seedIfEmpty`, all as designed in D15 and DATABASE_SCHEMA §7, every write under `SELECT … FOR UPDATE` on the `document_states` row; Prisma model API for byte columns and one raw query for the lock.
  4. **`persistedDigest` (new column, extends D15):** a deletion changes a document's delete set but **not** its state vector, so "nothing new to store" cannot be decided from the vector alone (a vector-only skip would silently drop deletions; a diff-only rule would write a row on every store of a document that has ever had a deletion, because every diff carries the whole delete set). `persistedDigest` is the SHA-256 of `Y.encodeSnapshot(Y.snapshot(doc))` (state vector plus delete set) of the document at its last store. A store is skipped when the live digest equals it or when the diff is the empty update. A wrong "changed" only costs a redundant row; the digest is never used by `load`.
  5. **Load reads rows before the state, without a lock** (DATABASE_SCHEMA §7 amended): reading the state first could miss rows that a compaction folds and deletes in between.
  6. **Seeding:** `contentToYDoc` (server-side, from the validated `page_contents` JSON, D54) plus `DocumentStore.seedIfEmpty`, which seeds under the page lock exactly once. Clients never seed (two clients seeding separately would duplicate the text).
  7. **Out of scope and unchanged:** `DocumentSnapshot`/versions (Phase 8), the Hocuspocus server and provider (Phase 6), the web editor wiring and removal of `page_contents` (Phase 6), awareness/presence (Phase 7).
- **Consequences / open items:** (a) Phase 6 needs `contentToYDoc`, which needs the ProseMirror schema from `packages/editor`; ARCHITECTURE §5 does not allow `collab → editor`. Either extend the boundary (and the ESLint rule and its test) or move schema-dependent conversion elsewhere; decide at the start of Phase 6. (b) The `@tiptap/y-tiptap` 3.0.7 pin and the peer dependencies were confirmed by the owner's `pnpm install` on 2026-11-16 (no peer warnings; `pnpm why yjs` reports one version, 13.6.33). Bumping to a newer `y-tiptap` (3.3.0 exists) is a separate, tested change (D13). (c) A compaction threshold trigger is not wired (no server yet); `COMPACTION_UPDATE_THRESHOLD` (200) and `compact({ minPendingRows })` are ready for Phase 6.

### D58 – The collaboration server may import `@conote/editor`

- **Status:** Accepted (owner approval, 2026-11-18). Proposed on 2026-11-17 (Phase 6); approved after the owner's local verification (HANDOVER §11.11). This is the choice D57 left open for the start of Phase 6.
- **Context:** Seeding an existing page into its Yjs document needs `contentToYDoc`, which needs the ProseMirror schema from `packages/editor`. ARCHITECTURE §5 did not allow `collab → editor`. Clients must never seed (D57, WEBSOCKET_PROTOCOL §5a), so the conversion has to run on the server.
- **Options:** (a) allow `collab → editor`; (b) move the schema-dependent conversion into `packages/shared` (shared would then depend on Tiptap); (c) copy the schema into the collab server (two schemas to keep in step).
- **Decision:** (a), through the existing entry point `@conote/editor/collaboration` only. The ESLint rule (`eslint.config.mjs`), `tests/boundaries.test.ts` and ARCHITECTURE §5 were updated: `collab → shared, db, editor`; `editor` still imports nothing from the apps; `api` still must not import `editor`.
- **Consequences:** the collab server loads the Tiptap schema packages (no DOM is needed; verified by the Phase 6 seeding tests). A schema change in the editor now also affects seeding, which is the intended single source of truth. The dependency disappears if the interim seed source is dropped (D59) and seeding is replaced by a one-off migration.

### D59 – Interim page-content endpoints removed; `page_contents` kept only as a seed source

- **Status:** Accepted (owner approval, 2026-11-18). Proposed on 2026-11-17 (Phase 6); approved after the owner's local verification (HANDOVER §11.11), where a Phase 4 page opened for the first time after Phase 6 showed its content exactly once. D54 promised this removal for Phase 6; the open part is what happens to the table.
- **Context:** The task forbids a second synchronization mechanism. The Phase 4 HTTP autosave (`CONTENT-01/02`) would keep writing a copy that nothing reads and that diverges from the Yjs document.
- **Decision:** (1) `CONTENT-01` and `CONTENT-02`, their shared schemas, the `contentSave` rate limit, the web autosave controller and the save/conflict UI are **deleted**. (2) The `page_contents` table and its Prisma model stay, **read-only**: the collab server reads a page's row once, when the page has no Yjs state, and seeds it through `DocumentStore.seedIfEmpty` (exactly once under the page lock). Nothing writes the table any more. (3) Content that cannot be converted (fails validation) makes the page refuse to open instead of opening blank; the row is untouched.
- **Not decided here:** dropping the table. That needs a migration and an owner decision on whether every page has been opened (and so seeded) first, or whether a one-off import should seed all pages. Until then the table is data the owner may still need.
- **Consequences:** a page opened for the first time after Phase 6 shows its Phase 4 content; after that, `page_contents` is never consulted for that page. A page edited in Phase 4 and never opened in Phase 6 keeps its row.

### D60 – Phase 6 collaboration server behaviour

- **Status:** Accepted (owner approval, 2026-11-18). Proposed on 2026-11-17 (Phase 6); approved after the owner's local verification (HANDOVER §11.11). Details in WEBSOCKET_PROTOCOL §17.
- **Decisions:**
  1. **The token carries identity only** (`sub`, `sid`, `pid`, `jti`, `iat`, `exp`). The role is not in it: the server computes it from PostgreSQL on every connection and revalidation, with the same pure function as the API (`resolveEffectivePageRole`, through `resolveCollabAccess` in `packages/db`). `PAGE-10` returns `role`/`readOnly` only as UI hints.
  2. **One WebSocket per document** in the web client, so closing a socket on revocation can never affect another page. The server also supports several documents on one socket (each authenticated on its own token), and closes the socket, not only the document channel, when it revokes a connection (Hocuspocus 4.8's `Connection.close` ends only the document channel).
  3. **Application messages:** the server sends `access.changed`, `access.revoked`, `server.shutting_down` and `error`. It registers no client commands in Phase 6 (version commands come in Phase 8); anything a client sends is answered with `error INVALID_MESSAGE`, five invalid messages close the connection (4400).
  4. **Client rules after access changes:** on `access.revoked` the client stops for good and drops its document; on a downgrade to read-only it starts over on a fresh document (so refused local edits do not remain in its copy); on an upgrade to editable it calls `forceSync()` (updates the server dropped while read-only leave a gap that later updates would wait on; shown by the Phase 6 test).
  5. **Presence is off until Phase 7:** the server discards all client-supplied awareness state; nothing is stored or relayed. Phase 7 replaces this with the identity binding of WEBSOCKET_PROTOCOL §6.
  6. **Origin:** a present `Origin` must be in `COLLAB_ALLOWED_ORIGINS` (default `APP_URL`), otherwise the upgrade is refused with 403. A missing `Origin` (non-browser client) is allowed; such a client still needs a valid token.
  7. **Store retries and shutdown:** a failed store keeps the document in memory and is retried with a growing delay (1, 2, 5, 10, 30 s); a document whose page no longer exists is dropped; shutdown flushes all stores first, tells clients, closes with 1012, and is bounded by `COLLAB_SHUTDOWN_TIMEOUT_MS`.
  8. **Single instance:** the Hocuspocus Redis extension is not used (D28, multi-instance is Phase 9). Redis is used for access events only.
- **Consequences:** items that remain open are listed in HANDOVER §11.5.

### D61 – Phase 7 presence and awareness identity

- **Status:** Accepted (owner approval, 2026-11-19; proposed 2026-11-18, Phase 7). Verified by the owner in real browsers on 2026-11-19 (HANDOVER §12.11). Details in WEBSOCKET_PROTOCOL §18.
- **Decisions:**
  1. **The server builds the relayed identity.** `user = { id, name, color }` comes from the verified connection and PostgreSQL; the client's `user` field is ignored. This refines the §6 design (REST lookup in the browser); the reasons are in WEBSOCKET_PROTOCOL §18.6. The consequence is that a profile change shows after reconnecting.
  2. **One awareness client id per connection**, first use wins; states and removals for other ids are dropped; a reconnection by the same user takes its old id over.
  3. **Only a validated cursor** is taken from the client; everything else is dropped; states over 1024 bytes lose their cursor; 30 awareness messages per second per connection, the excess dropped.
  4. **Read-only roles publish presence** (U4 outcome applied).
  5. **Presence is never stored.** The 30 s expiry is the y-protocols constant (not configurable).
  6. **No new dependency:** carets use the Yjs cursor plugin already installed through TipTap; avatars are initials on the person's colour.
- **Consequences:** `COLLAB_MAX_AWARENESS_PER_SECOND` is a new collab setting; the client must publish its state again after sync (§18.3).

---

## Unresolved decisions

The "Needed by" column states the phase gate for each item. Resolved items remain listed with their evidence so permanent IDs are preserved.

| ID | Question | Options | Recommendation | Needed by |
|---|---|---|---|---|
| **U1 – RESOLVED (Phase 1b, 2026-11-12)** | Node.js baseline: 24 or 26? | Node.js 24 or Node.js 26 | Node.js 24 LTS approved by the project owner on 2026-11-12; used for the Phase 1b spike and root checks. See D16 and HANDOVER. | Phase 1 |
| **U2 – RESOLVED (Phase 1b, 2026-11-12)** | TypeScript version: 5.9.3 or newer (6.x/7.x)? | TypeScript 5.9.3 or newer | TypeScript 5.9.3 approved by the project owner on 2026-11-12; used for the Phase 1b spike and root checks. See D17 and HANDOVER. | Phase 1 |
| **U3 – PARTIALLY EVIDENCED (Phase 1b, 2026-11-12)** | Do Hocuspocus store hooks and Redis behave as the persistence design (D15) assumes? Consider debounce options, store-on-unload, Redis-originated updates, duplicate writes and lock behaviour. | Diff-on-store; per-update append from change hook with origin filtering | S4 and S5 verified persistence, Redis-originated updates and duplicate-write behaviour. Store-on-unload and direct concurrent row-lock behaviour remain unverified. | Phase 1 closure / Phase 9 |
| **U4 – PARTIALLY EVIDENCED (Phase 1b, 2026-11-12)** | Do awareness updates propagate across instances and from read-only connections, and what happens to stale awareness after an instance crash? | Empirical verification | S2, S3 and S10 verified cross-instance awareness, read-only awareness propagation and forged identity rejection. Stale awareness after server crash and name/color tampering remain unverified. *Phase 7 (D61, accepted 2026-11-19) applied the read-only outcome (viewers publish presence); forged name and colour were tested against the real collab server in the preparation environment, and the owner saw a Viewer's cursor in real browsers on 2026-11-19; stale awareness after a server crash is still untested.* | Phase 1 closure |
| **U6** | Invitation email delivery provider | SMTP via Mailpit in dev + provider TBD in prod; transactional email API | Phase 3 ships **link-based** invitations plus an email-adapter interface (console/Mailpit for dev); pick a production provider before Phase 11 | Phase 3 (link only) / Phase 11 (provider) |
| **U7 – PARTIALLY RESOLVED (Phase 4, 2026-11-15; D55 accepted 2026-11-16)** | Image upload flow and limits | Presigned direct upload to object storage; upload through the API | Flow (authorize, upload, confirm with size and magic-byte checks, read with access control), allowed types (PNG, JPEG, GIF, WebP; no SVG) and limit (5 MiB) are decided and implemented behind a storage adapter with a local-disk backend. **Still open after D55 approval:** the S3-compatible adapter, MinIO (or alternative) in Compose, MinIO's current distribution/licensing, avatar upload; the production backend must be chosen before deployment | Phase 4 (flow, limits) / owner decision for the production backend |
| **U8** | Behaviour of comment anchors after version restore (D8 + D9) | Mark affected threads "detached" (kept, unanchored); attempt re-anchoring by quoted text | Mark detached, keep thread and quoted text; re-anchoring is a later enhancement | Phase 8 |
| **U9** | External guests (access to a single page for non-members) | Out of scope for MVP; or add later | Out of scope; revisit after Phase 10 | Phase 3 (confirm out of scope) |
| **U10** | Production hosting target | Single VM with Docker Compose; managed container platform + managed Postgres/Redis | DEPLOYMENT.md is written provider-neutral (container images + reference topology); owner picks a target before Phase 11 | Phase 11 |
| **U11** | Retention policy for AUTO snapshots and activity logs | Keep all; prune AUTO snapshots by age/count while always keeping MANUAL and PRE_RESTORE; time-based activity pruning | Keep MANUAL and PRE_RESTORE indefinitely, prune AUTO snapshots by a policy chosen from Phase 9 growth measurements; activity logs kept until Phase 10 review | Phase 8 (snapshot rules) / Phase 10 (implementation) |
| **U12** | Repository license and visibility (public/private) | Permissive open-source license; all rights reserved/private | Owner decides; until decided the repository states "License: not yet chosen" | Before the repository is made public (no later than Phase 11) |
| **U13** | Which explicit Phase 9 recovery mechanism detects and reconciles documents after Redis Pub/Sub message loss? Options: force clients to reconnect to PostgreSQL-hydrated state, or implement verified server-to-server reconciliation. Redis reconnect alone is insufficient. | Select from Phase 1/9 evidence; forced reconnect is the conservative baseline | Phase 9 |

---

## Resolved questions

| ID | Question | Resolution and evidence |
|---|---|---|
| **U1 – RESOLVED (Phase 1b, 2026-11-12)** | Node.js baseline: 24 or 26? | Project owner explicitly approved Node.js 24 on 2026-11-12. Phase 1b spike and root checks were executed using Node.js 24.18.0. See D16 and HANDOVER. |
| **U2 – RESOLVED (Phase 1b, 2026-11-12)** | TypeScript version: 5.9.3 or newer (6.x/7.x)? | Project owner explicitly approved TypeScript 5.9.3 on 2026-11-12. Phase 1b spike and root checks passed with the pinned TypeScript version. See D17 and HANDOVER. |
| **U5 – RESOLVED (Phase 1a, 2026-11-12)** | Prisma 7 setup in a pnpm monorepo: generator output, driver adapter, `prisma.config.ts` and migration workflow | Prisma 7.10.1 configured with `prisma-client` output under `packages/db/src/generated/prisma`, `@prisma/adapter-pg`, and `prisma.config.ts`. Owner reports successful client generation, a real adapter query, `pnpm db:migrate:deploy`, and `pnpm db:migrate:status` reporting up to date. See D35/D36 and HANDOVER §3. |

## Superseded decisions

None.

## References

Retrieved during Phase 0 research (official or primary sources):

- Hocuspocus Redis extension – https://tiptap.dev/docs/hocuspocus/server/extensions/redis
- Hocuspocus hooks – https://tiptap.dev/docs/hocuspocus/server/hooks
- Hocuspocus authentication guide – https://tiptap.dev/docs/hocuspocus/guides/authentication
- Hocuspocus collaborative editing guide – https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing
- Tiptap Collaboration extension – https://tiptap.dev/docs/editor/api/extensions/collaboration
- `y-websocket` – https://github.com/yjs/y-websocket
- `y-redis` – https://github.com/yjs/y-redis
- Prisma system requirements – https://www.prisma.io/docs/orm/reference/system-requirements
- Prisma supported databases – https://www.prisma.io/docs/orm/reference/supported-databases
- Node.js lifecycle (third-party aggregation of the official schedule) – https://endoflife.date/nodejs

Not fetched during Phase 0 (official documentation locations; confirm when implementing):

- Yjs documentation – https://docs.yjs.dev (relative positions, document updates, awareness)
- Node.js release schedule – https://nodejs.org/en/about/previous-releases
- Next.js rewrites – https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites
- OWASP Password Storage – https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session Management – https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF Prevention – https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Fastify – https://fastify.dev/docs/latest/ ; Zod – https://zod.dev ; `jose` – https://github.com/panva/jose