# CoNote – Project Master

**Status:** Phase 1 infrastructure and Phase 2 authentication are implemented and owner-verified locally; **Phase 3 (workspaces, pages, permissions) is implemented and owner-verified locally (2026-11-15; final acceptance pending, see HANDOVER.md §8.8)**. Presence is implemented as of Phase 7 (2026-11-18; owner-verified locally on 2026-11-19, D61 accepted, see HANDOVER.md §12.11); comments and version history are not implemented. Current status is always in HANDOVER.md. **Phase 4 (rich-text editor, interim content persistence, image upload) is implemented and owner-verified locally (2026-11-16; D54–D56 accepted; final acceptance pending, see HANDOVER.md §9.11).** **Phase 5 (Yjs integration) was owner-verified locally on 2026-11-16 (D57 accepted). Phase 6 (WebSocket collaboration server and live editing) was implemented on 2026-11-17 and owner-verified locally on 2026-11-18 (D58–D60 accepted; real-time editing was checked in real browsers; final acceptance pending, see HANDOVER.md §10.9 and §11.11).**
**Last updated:** 2026-11-16

This document is the complete project overview: goals, requirements, permissions, technology stack and roadmap summary. Technical decisions are in [DECISIONS.md](DECISIONS.md); decision IDs (`D#`) and unresolved IDs (`U#`) referenced here are defined there.

## Document map

| Document | Purpose |
|---|---|
| [DECISIONS.md](DECISIONS.md) | Numbered decisions, unresolved questions |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System components, data flow, persistence guarantees, diagrams |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Prisma/PostgreSQL design |
| [API_CONTRACTS.md](API_CONTRACTS.md) | REST API contracts |
| [WEBSOCKET_PROTOCOL.md](WEBSOCKET_PROTOCOL.md) | Collaboration protocol and application events |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phase-by-phase roadmap |
| [TESTING.md](TESTING.md) | Test strategy and measurable metrics |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production infrastructure |
| [HANDOVER.md](HANDOVER.md) | Current status and next steps |

## 1. Overview

**CoNote** is a real-time collaborative workspace inspired by Notion and Figma. Users create workspaces, organize nested pages, edit rich-text documents simultaneously with other users, discuss content in comment threads, and browse or restore earlier versions.

Core promises:

- Multiple users edit the same document at the same time and concurrent changes merge without overwriting each other (Yjs CRDT).
- Users see each other's presence, cursors and selections.
- Access is controlled by workspace roles and page-level permissions, enforced on the server for both REST and WebSocket.
- The collaboration layer is designed to run as multiple instances, with durable recovery from PostgreSQL. Redis Pub/Sub is best-effort: recovery from missed cross-instance messages requires an explicit resynchronization procedure; Redis reconnect alone does not guarantee live reconvergence.

### Goals

1. A maintainable, secure, well-documented full-stack reference implementation of real-time collaboration.
2. Clear module boundaries inside one monorepo.
3. Persistence and recovery behaviour that is *defined and tested*, not assumed (D14).

### Non-goals (MVP)

- Offline editing with local persistence (e.g. IndexedDB) and offline-first sync.
- External guests, public page sharing, workspace-level realtime events (U9, D32).
- Email verification and password reset (deferred; not required by the brief; delivery provider is U6).
- Native mobile apps; AI features; import/export formats; billing.
- Per-keystroke authorship (blame). Change tracking is snapshot- and activity-based (FR-VH-06).

## 2. Users and roles

| Role | Scope | Summary |
|---|---|---|
| Owner | Workspace | Everything an Admin can do, plus delete the workspace and transfer ownership. Exactly one per committed workspace; database enforcement covers both at-most-one and at-least-one. |
| Admin | Workspace | Manage members, invitations, page permissions and settings; full access to all pages. |
| Editor | Workspace | Read, comment, edit, create/move/delete pages. |
| Commenter | Workspace | Read and comment. |
| Viewer | Workspace | Read only. |

Page-level overrides (`NONE`, `VIEWER`, `COMMENTER`, `EDITOR`) per user per page, with inheritance from ancestor pages (D23).

## 3. Functional requirements

Requirement IDs are permanent and referenced by IMPLEMENTATION_PLAN.md and TESTING.md. "Phase" is the phase in which the requirement is completed.

### 3.1 Authentication and users (AUTH)

| ID | Requirement | Phase |
|---|---|---|
| FR-AUTH-01 | Register with email and password (Argon2id, D5). | 2 |
| FR-AUTH-02 | Log in; create a database-backed session delivered as an httpOnly cookie. | 2 |
| FR-AUTH-03 | Log out (revokes the session). | 2 |
| FR-AUTH-04 | List and revoke own sessions; sessions expire (7 d idle / 30 d absolute, tunable). | 2 |
| FR-AUTH-05 | View and edit own profile (display name, presence color in Phase 2; avatar upload completes in Phase 4 with the asset endpoints). | 2 (avatar: 4) |
| FR-AUTH-06 | Change password (revokes other sessions). | 2 |
| FR-AUTH-07 | Protected routes: unauthenticated access to protected web routes and API endpoints is rejected. | 2 |

### 3.2 Workspaces (WS)

| ID | Requirement | Phase |
|---|---|---|
| FR-WS-01 | Create a workspace (creator becomes Owner). | 3 |
| FR-WS-02 | List the user's workspaces; view and update workspace settings. | 3 |
| FR-WS-03 | Delete a workspace (Owner only). | 3 |
| FR-WS-04 | List members; change a member's role (Admin/Owner). | 3 |
| FR-WS-05 | Invite by email-bound link (D30); list, revoke and resend invitations. | 3 |
| FR-WS-06 | Accept an invitation (authenticated user with matching email). | 3 |
| FR-WS-07 | Remove a member; a member can leave. | 3 |
| FR-WS-08 | Transfer ownership. | 3 |

### 3.3 Pages and documents (PG)

| ID | Requirement | Phase |
|---|---|---|
| FR-PG-01 | Create a page, including nested child pages. | 3 |
| FR-PG-02 | Rename a page; set an icon. Title and metadata live in PostgreSQL, the body lives in the Yjs document. | 3 |
| FR-PG-03 | Move and reorder pages in the tree; concurrent structural mutations are serialized and cannot create cycles or cross-workspace parent links. | 3 |
| FR-PG-04 | Soft delete, restore and purge pages (D24). | 3 |
| FR-PG-05 | Page tree view per workspace. | 3 |
| FR-PG-06 | Page-level permission overrides with inheritance (D23). | 3 |
| FR-PG-07 | Document autosave: content is persisted by the collaboration server without a manual save action. | 6 |

### 3.4 Rich-text editor (ED)

| ID | Requirement | Phase |
|---|---|---|
| FR-ED-01 | Headings and paragraphs. | 4 |
| FR-ED-02 | Bold, italic, underline. | 4 |
| FR-ED-03 | Ordered and unordered lists. | 4 |
| FR-ED-04 | Checklists (task lists). | 4 |
| FR-ED-05 | Links. | 4 |
| FR-ED-06 | Images (upload to object storage, D10). | 4 |
| FR-ED-07 | Tables. | 4 |
| FR-ED-08 | Slash commands. | 4 |
| FR-ED-09 | Extensible editor architecture (extension registry in `packages/editor`). | 4 |

### 3.5 Real-time collaboration (RT)

| ID | Requirement | Phase |
|---|---|---|
| FR-RT-01 | Yjs CRDT binding between Tiptap and a shared `Y.Doc`. | 5 |
| FR-RT-02 | Simultaneous editing by multiple users in one document. | 6 |
| FR-RT-03 | Conflict resolution through CRDT merge (no lost concurrent edits). | 5, 6 |
| FR-RT-04 | Real-time synchronization over WebSocket. | 6 |
| FR-RT-05 | Reconnection and recovery: clients resync after network loss; documents recover after server restart. | 6 |
| FR-RT-06 | Multiple browser sessions per user. | 6 |

### 3.6 Presence (PR)

| ID | Requirement | Phase |
|---|---|---|
| FR-PR-01 | Live user avatars for current collaborators. | 7 |
| FR-PR-02 | Colored cursors with the user's name beside the cursor. | 7 |
| FR-PR-03 | Selection highlighting. | 7 |
| FR-PR-04 | Online collaborator list. | 7 |
| FR-PR-05 | Join and leave notifications. | 7 |

### 3.7 Comments (CM)

| ID | Requirement | Phase |
|---|---|---|
| FR-CM-01 | Add a comment anchored to document content (Relative Positions, D8). | 8 |
| FR-CM-02 | Reply to a comment (thread). | 8 |
| FR-CM-03 | Resolve a comment thread; reopen it. | 8 |
| FR-CM-04 | Display threads and highlights in the editor. | 8 |
| FR-CM-05 | Delete own comment (soft delete); Admin/Owner may delete any. | 8 |
| FR-CM-06 | Commenters can comment while connected read-only. | 8 |

### 3.8 Version history (VH)

| ID | Requirement | Phase |
|---|---|---|
| FR-VH-01 | Automatic snapshots (rules defined in Phase 8). | 8 |
| FR-VH-02 | Manual snapshot with optional label. | 8 |
| FR-VH-03 | List versions. | 8 |
| FR-VH-04 | View a previous version read-only. | 8 |
| FR-VH-05 | Restore a previous version as a new transaction (D9), with a pre-restore snapshot. | 8 |
| FR-VH-06 | Track document changes: snapshot metadata with contributors and an activity log of edits (not per-keystroke blame). | 8 |

### 3.9 Permissions (PM)

| ID | Requirement | Phase |
|---|---|---|
| FR-PM-01 | Role-based permissions enforced server-side on every REST endpoint. | 3 |
| FR-PM-02 | Viewer read-only, Commenter read and comment, Editor read/comment/edit, Admin/Owner management. | 3, 6 |
| FR-PM-03 | WebSocket authorization: unauthorized users cannot subscribe; Viewers and Commenters connect read-only. | 6 |
| FR-PM-04 | Access changes take effect on open connections (D22). | 6, 9 |

### 3.10 Scalability (SC)

| ID | Requirement | Phase |
|---|---|---|
| FR-SC-01 | Multiple collab instances synchronized through Redis (D2). | 9 |
| FR-SC-02 | Persistent Yjs document storage in PostgreSQL (D15). | 5, 6 |
| FR-SC-03 | Connection management: heartbeats, per-user and per-instance limits, graceful shutdown. | 9 |
| FR-SC-04 | Recovery after collab server restarts. | 6, 9 |

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-SEC-01 | Passwords hashed with Argon2id; sessions stored hashed; cookies httpOnly, host-only, `SameSite=Lax`, `Secure` in production. |
| NFR-SEC-02 | Authorization checked server-side on every REST request and on every WebSocket connection and revalidated while connected. |
| NFR-SEC-03 | Input validated with Zod at every API boundary; WebSocket messages size-limited and type-checked. |
| NFR-SEC-04 | Rate limiting on authentication, invitation and token-issuing endpoints; CORS allow-list; Origin validation for state-changing requests and WebSocket upgrades. |
| NFR-SEC-05 | Invitation and session tokens are random, single-purpose, stored hashed (D30, D5). |
| NFR-REL-01 | Persistence and recovery guarantees G1–G7 (ARCHITECTURE.md §8) are explicit and each is covered by a named test before it is claimed. No zero-data-loss claim (D14). |
| NFR-MNT-01 | TypeScript strict mode, linting with enforced module boundaries, exact dependency pins (D11–D13). |
| NFR-MNT-02 | Every phase has acceptance criteria and tests; documentation is updated in the same change as behaviour. |
| NFR-A11Y-01 | Core flows (login, page tree, editor toolbar and slash menu) are keyboard operable. *(Proposed; basic target, no formal conformance claim.)* |

### Measurable performance metrics (definitions only)

No performance targets or benchmark results are claimed yet. Phase 1a verified infrastructure and test execution but did not measure collaboration performance; baselines are measured in the Phase 1b spike and Phase 9, then targets are set by decision. Measurement methods are in TESTING.md.

| ID | Metric | Definition |
|---|---|---|
| PERF-01 | Synchronization latency | Time from a local edit being applied at client A to the same change being applied at client B (same instance and cross-instance), reported as percentiles. |
| PERF-02 | Concurrent connections | Maximum number of WebSocket connections per collab instance sustained under a defined editing workload without breaching PERF-01 and error-rate limits. |
| PERF-03 | Update propagation | Updates per second a document and an instance can propagate to N subscribed clients (fan-out), and Redis message rate. |
| PERF-04 | Recovery time | Time from collab instance restart to a client regaining a synced, editable document; and client reconnection time after a network drop. |
| PERF-05 | Persistence lag | Time from an update being applied on the server to its `DocumentUpdate` row being committed. |
| PERF-06 | Document load time | Time to reconstruct a document from `DocumentState` plus pending updates, as a function of update count and size. |
| PERF-07 | API latency | p50/p95/p99 latency per REST endpoint group under a defined load. |

## 5. Permissions matrix

`✓` = allowed. "Page" means the effective page role after override and inheritance (D23). Workspace actions use the workspace role.

### Page actions (effective page access)

| Action | Viewer | Commenter | Editor | Admin | Owner |
|---|---|---|---|---|---|
| Read page, versions, comments | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create and reply to comments | | ✓ | ✓ | ✓ | ✓ |
| Delete own comment | | ✓ | ✓ | ✓ | ✓ |
| Delete any comment | | | | ✓ | ✓ |
| Edit content (WebSocket read-write) | | | ✓ | ✓ | ✓ |
| Create manual snapshot | | | ✓ | ✓ | ✓ |
| Restore a version | | | ✓ | ✓ | ✓ |
| Create child page, rename, move | | | ✓ | ✓ | ✓ |
| Delete / restore page | | | ✓ | ✓ | ✓ |
| Change page permission overrides | | | | ✓ | ✓ |

### Workspace actions

| Action | Viewer | Commenter | Editor | Admin | Owner |
|---|---|---|---|---|---|
| View workspace and member list | ✓ | ✓ | ✓ | ✓ | ✓ |
| Leave workspace | ✓ | ✓ | ✓ | ✓ | (must transfer first) |
| Invite, revoke invitations | | | | ✓ | ✓ |
| Change member roles (Admin: Editor/Commenter/Viewer only; Owner: also Admin; never the Owner) | | | | ✓ | ✓ |
| Remove members (Admin: non-Admin members only; Owner: also Admins; never the Owner) | | | | ✓ | ✓ |
| Update workspace settings | | | | ✓ | ✓ |
| Transfer ownership, delete workspace | | | | | ✓ |

An Admin cannot change, remove or restrict the Owner, and cannot grant Owner.

## 6. Technology stack

**Verification note (2026-11-12).** Exact pins used by the Phase 1a monorepo are installed and were exercised by the reported clean install, lint, format, typecheck, tests, build and CI run. Pins for future-phase libraries not yet present in the lockfile (for example Tiptap/Playwright/auth/storage dependencies) remain planned candidates and must be rechecked when introduced. Any compatibility-driven change is recorded under D13.

### Runtime and tooling

| Component | Version | Notes |
|---|---|---|
| Node.js | 24.x LTS (latest patch) | D16, U1. Hocuspocus requires >= 22; Prisma requires ^20.19 / ^22.12 / >= 24. |
| pnpm | 12.18.0 | Workspaces (D11). Installation method (corepack or standalone) confirmed in Phase 1. |
| TypeScript | 5.9.3 | Strict (D12, D17, U2). |
| Vitest | 5.1.0 | D26. |
| Playwright | 1.65.0 | D26. |

### Frontend (`apps/web`, `packages/editor`)

| Component | Version | Notes |
|---|---|---|
| Next.js | 16.4.6 | App Router (D27). Node >= 20.9; React ^19. |
| React / ReactDOM | 19.3.1 | |
| Tailwind CSS | 4.3.5 | With `@tailwindcss/postcss` 4.3.5. |
| Tiptap (`core`, `react`, `pm`, `starter-kit`, `extension-collaboration`, `extension-collaboration-caret`) | 3.33.1 | All the same version (D20). |
| `@tiptap/y-tiptap` | ^3.0.7 range required by peer dependency; exact pin chosen in Phase 1 | D20. |
| Yjs | 13.6.33 | `^13` required by Tiptap and Hocuspocus peers. |
| `y-protocols` | 1.0.7 | Hocuspocus peer `^1.0.6`. |
| `@hocuspocus/provider` | 4.8.0 | D1. |

### API (`apps/api`)

| Component | Version |
|---|---|
| Fastify | 5.12.8 |
| Zod | 4.6.7 |
| `fastify-type-provider-zod` | 7.0.0 (peers: fastify ^5.5, zod >= 4.1.5) |
| `@fastify/cookie` | 11.1.5 |
| `@fastify/cors` | 11.4.1 |
| `@fastify/helmet` | 13.2.0 |
| `@fastify/rate-limit` | 11.2.2 |
| `argon2` | 0.45.2 |
| `jose` | 6.2.17 |
| `@aws-sdk/client-s3` | 3.1166.0 (any presigner package pinned to the same release; confirmed in Phase 4) |
| `pino` | 10.4.0 |
| `ioredis` | 5.6.x (D19) |

### Collaboration server (`apps/collab`)

| Component | Version |
|---|---|
| `@hocuspocus/server` | 4.8.0 (Node >= 22; peers yjs ^13.6.8, y-protocols ^1.0.6) |
| `@hocuspocus/extension-redis` | 4.8.0 (depends on ioredis ~5.6.1) |
| Yjs / y-protocols | 13.6.33 / 1.0.7 |
| `jose` | 6.2.17 (verification only) |
| `ioredis` | 5.6.x |

### Data and infrastructure

| Component | Version | Notes |
|---|---|---|
| PostgreSQL | 17 | Supported by Prisma (17 and 18 listed). |
| Prisma (`prisma`, `@prisma/client`, `@prisma/adapter-pg`) | 7.10.1 | D18, U5. The 8.x release candidate is not used. |
| `pg` | 8.23.1 | Driver used by the Prisma PostgreSQL adapter; confirmed in Phase 1. |
| Redis | 7.x (exact image tag chosen in Phase 1) | Not permanent storage (D14). |
| S3-compatible storage | MinIO (dev, if practical), provider TBD (prod) | D10, U7. |
| Docker / Docker Compose | Current stable | Local infrastructure and production images. |

### Additional libraries beyond the required list, and why

| Library | Why it is needed |
|---|---|
| Fastify and Zod | API service and validation (D4). |
| `argon2`, `jose` | Password hashing (D5); signing and verifying collaboration JWTs (D22). |
| `@fastify/*` plugins | Security baseline (D25). |
| `@hocuspocus/*` | Collaboration server and client provider (D1, D2). |
| `ioredis` | Redis client for rate limiting, events and the Hocuspocus extension. |
| `@aws-sdk/client-s3` | S3-compatible object storage client (D10). |
| `pino` | Structured logging. |
| Vitest, Playwright | Testing (D26). |

## 7. Roadmap summary

Full detail is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

| Phase | Name | Main outcome |
|---|---|---|
| 0 | Documentation and Architecture | This documentation set (in progress). |
| 1 | Project Setup and Infrastructure | Monorepo, tooling, Docker services, CI, **disposable two-instance collaboration spike with recorded results** (D28). |
| 2 | Authentication and User Management | FR-AUTH-01..07. |
| 3 | Workspaces, Pages and Permissions | FR-WS, FR-PG-01..06, FR-PM-01..02. |
| 4 | Rich-Text Editor | FR-ED-01..09. |
| 5 | Yjs CRDT Integration | FR-RT-01, FR-RT-03 (client side), document persistence store (FR-SC-02). |
| 6 | WebSocket Server and Real-Time Collaboration | FR-RT-02..06, FR-PG-07, FR-PM-03..04. |
| 7 | Presence and Collaborative UI | FR-PR-01..05. |
| 8 | Comments and Version History | FR-CM-01..06, FR-VH-01..06. |
| 9 | Redis Scaling and Performance | FR-SC-01, FR-SC-03, FR-SC-04, FR-PM-04, performance baselines. |
| 10 | Testing, Security and Optimization | Full test suite, security review, optimization. |
| 11 | Deployment and Final Documentation | Production deployment and final docs. |

**Adjustments to the proposed roadmap (D28):** the Phase 1 spike is added; Phases 5 and 6 stay separate, with Phase 5 covering the client-side Yjs binding and the persistence store as a tested library, and Phase 6 adding the Hocuspocus server on top of it.

## 8. Glossary

| Term | Meaning |
|---|---|
| CRDT | Conflict-free replicated data type; replicas that receive the same updates converge to the same state. |
| Yjs | The CRDT library used for shared documents. |
| Y.Doc | A Yjs shared document. |
| Update | A binary-encoded change to a `Y.Doc`. |
| State vector | A compact summary of which updates a replica has; used to compute missing updates. |
| Awareness | Ephemeral per-client state (cursor, user info) that is broadcast but not persisted. |
| Relative Position | A Yjs position that stays attached to content as the document changes (D8). |
| Snapshot | An immutable stored full state of a document at a point in time. |
| Compaction | Merging many stored updates into a single full state. |
| Collab server | The Hocuspocus-based `apps/collab` service. |
| Stateless message | A Hocuspocus application message that is not part of Yjs sync (D32). |

## 9. Assumptions and constraints

- One repository; services are separately deployable (D3, D11).
- PostgreSQL is authoritative for durable data; Redis is not (D14).
- External guests, offline editing, workspace-level realtime events are out of scope for the MVP.
- Unverified collaboration behaviours (ARCHITECTURE.md §18 and DECISIONS.md U3/U4) are investigated in Phase 1b before Phases 5–9 rely on them. Prisma monorepo setup (U5/V8) has been exercised through client generation, database connectivity and the successful baseline migration workflow; see HANDOVER.md.