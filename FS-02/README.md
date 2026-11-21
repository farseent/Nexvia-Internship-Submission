# CoNote – Real-Time Collaborative Workspace

> **Project status (2026-11-20): Phases 1–8 are implemented; Phases 2–8 are owner-verified locally.** You can register, manage workspaces, members, invitations and nested pages with permissions, and edit a page in a rich-text editor together with other people in real time: live sync, presence (avatars, carets, selections, online list), anchored comment threads, and version history with restore. **Not implemented yet:** running several collaboration-server instances with live sync between them through Redis (Phase 9), load and security hardening (Phase 10), deployment (Phase 11), avatar upload, email verification and password reset. Real-time collaboration currently runs on a **single collaboration-server instance**. Docker, GitHub Actions for the latest phases and automated browser E2E tests have not been run. Current status and open items: `docs/HANDOVER.md`.

CoNote is a collaborative workspace inspired by Notion and Figma. Multiple people can edit the same rich-text page at the same time, see each other's cursors and presence, discuss content in comment threads, and browse or restore earlier versions, without losing concurrent changes.

## Features

| Area | Capabilities | Status |
|---|---|---|
| Authentication | Registration and login, secure server-side sessions, user profiles, protected routes | Implemented (Phase 2) |
| Workspaces | Create and manage workspaces, invite members by link, roles (Owner, Admin, Editor, Commenter, Viewer) | Implemented (Phase 3) |
| Pages | Nested pages, soft delete and restore, per-page permission overrides, activity log | Implemented (Phase 3) |
| Rich-text editor | Headings, paragraphs, bold/italic/underline, lists, checklists, links, images, tables, alignment, slash commands, toolbar | Implemented (Phase 4); images are stored on local disk |
| Real-time collaboration | Yjs CRDT, simultaneous editing, reconnection and recovery, read-only roles, access revocation, multiple sessions | Implemented (Phases 5–6), single collab instance |
| Presence | Avatars, colored cursors with names, selection highlighting, online list, join/leave notifications; never stored | Implemented (Phase 7) |
| Comments | Anchored comment threads, replies, resolve/reopen, delete, live highlights, detached threads keep their quoted text | Implemented (Phase 8); no editing of comments, no notifications |
| Version history | Manual and automatic snapshots, read-only view of a version, restore as a new change with a "Before a restore" snapshot | Implemented (Phase 8) |
| Scalability | Multiple collaboration-server instances using Redis | Not implemented (Phase 9). Persistent Yjs storage in PostgreSQL and recovery after restarts are implemented |

Not planned for the first version: offline-first editing, external guest access, public page sharing, email verification/password reset. See `docs/PROJECT_MASTER.md` for the full scope.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Editor | Tiptap / ProseMirror |
| Collaboration | Yjs (CRDT), Hocuspocus WebSocket server, Redis |
| API | Node.js, Fastify, Zod |
| Data | PostgreSQL, Prisma ORM |
| Object storage | Local-disk backend for images today; an S3-compatible adapter (MinIO or similar) is not implemented yet (`docs/DECISIONS.md` D55, U7) |
| Tooling | pnpm workspaces, Docker, Vitest; Playwright is planned and not used yet |

Exact pinned versions are listed in `docs/PROJECT_MASTER.md` §6.

## Architecture

```mermaid
flowchart LR
  B["Browser: Next.js, Tiptap, Yjs"] -->|"HTTPS /api via Next.js rewrite"| WEB["web"]
  WEB --> API["api (Fastify)"]
  B -->|"WSS with short-lived JWT"| COLLAB["collab (Hocuspocus), N instances"]
  API --> PG[("PostgreSQL")]
  COLLAB --> PG
  COLLAB <-->|"pub/sub"| RD[("Redis")]
  API --> RD
  B -->|"presigned uploads"| S3[("S3-compatible storage")]
```

The diagram shows the target architecture. Today there is **one** collab instance, Redis carries only application events (access changes, comment and restore notifications), and images go through the API to local disk rather than by presigned upload to S3.

- **PostgreSQL is the durable source of truth**, including collaborative document recovery. **Redis is coordination only** and never permanent storage.
- Documents are persisted as incremental Yjs updates, compacted periodically, with immutable snapshots for version history. A restore is serialized against concurrent editing by a durable barrier in PostgreSQL.
- The project does not claim zero data loss or automatic reconvergence after Redis outages: persistence and recovery guarantees are explicitly defined and will be stated as verified only when their tests pass (`docs/ARCHITECTURE.md` §8).

## Repository layout

```text
conote/
├── apps/
│   ├── web/        # Next.js frontend
│   ├── api/        # REST API and application services
│   └── collab/     # Hocuspocus collaboration server
├── packages/
│   ├── db/         # Prisma schema, migrations, document and snapshot stores
│   ├── shared/     # Zod schemas, types, permission logic, protocol definitions
│   └── editor/     # Tiptap extensions, Yjs binding, presence carets, comment anchors
├── docs/           # Architecture and planning documents
├── infra/          # Docker Compose and Dockerfiles
├── scripts/        # Setup scripts
├── tests/          # Cross-cutting tests (module boundaries, process startup)
├── .github/        # CI workflow
└── CLAUDE.md       # Permanent instructions for AI-assisted development
```

`shared` holds env validation, error codes, the response envelope, the request schemas and the collaboration protocol definitions; `db` holds the Prisma setup, the migrations, the Yjs document store and the snapshot store; `editor` holds the Tiptap extensions, the Yjs binding, the presence carets and the comment anchors; `api` serves authentication, users, workspaces, invitations, pages, permissions, the activity log, image assets, comments and versions under `/api/v1`; `web` has the sign-in, workspace, page and editor screens and proxies `/api/*` to the API; `collab` is the Hocuspocus server for live editing, presence and versions.

## Prerequisites and setup

Prerequisites: Node.js 24 (`.nvmrc`), pnpm 12.18.0 (`corepack enable`), Docker with Compose v2.

```bash
pnpm bootstrap        # creates .env, installs, starts PostgreSQL + Redis, builds packages, runs migrations
pnpm dev:api          # http://localhost:4000   (/health, /ready)
pnpm dev:collab       # http://localhost:4100   (/health, /ready)
pnpm dev:web          # http://localhost:3000   (/health)
```

Run all three apps: the editor connects to the collaboration server, so a page cannot be edited without `pnpm dev:collab`.

Manual equivalent: `cp .env.example .env`, `pnpm install`, `pnpm infra:up`, `pnpm build:packages`, `pnpm db:migrate:deploy` (the db scripts read the repository-root `.env` automatically).

Quality checks: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration` (needs `pnpm infra:up` + migrations), `pnpm build`. Run everything with `pnpm check`. The full test run takes several minutes; `pnpm test --testTimeout=30000` is the form used for verification. See `docs/TESTING.md` §12.

Optionally run the three apps in containers too: `docker compose -f infra/docker-compose.yml --profile apps up --build`. The Docker `apps` profile was last verified in Phase 2; it has not been re-checked with the collaboration settings added since (see `docs/HANDOVER.md`).

Credentials in `.env.example` are local development defaults only. Never commit `.env`.

## Roadmap

| Phase | Name | Status |
|---|---|---|
| 0 | Documentation and Architecture | Documentation written |
| 1 | Project Setup and Infrastructure (including a disposable collaboration spike) | Infrastructure done; spike executed (S1–S11 passed) |
| 2 | Authentication and User Management | Implemented, owner-verified locally |
| 3 | Workspaces, Pages and Permissions | Implemented, owner-verified locally |
| 4 | Rich-Text Editor | Implemented, owner-verified locally (its interim persistence was replaced in Phase 6) |
| 5 | Yjs CRDT Integration | Implemented, owner-verified locally |
| 6 | WebSocket Server and Real-Time Collaboration | Implemented, owner-verified locally |
| 7 | Presence and Collaborative UI | Implemented, owner-verified locally |
| 8 | Comments and Version History | Implemented, owner-verified locally (2026-11-20) |
| 9 | Redis Scaling and Performance | Not started |
| 10 | Testing, Security and Optimization | Not started |
| 11 | Deployment and Final Documentation | Not started |

Final owner acceptance of each phase, and the checks still open (GitHub Actions on the latest phases, the Docker `apps` profile, automated browser E2E), are tracked in `docs/HANDOVER.md`. Details and acceptance criteria: `docs/IMPLEMENTATION_PLAN.md`.

## Documentation

| Document | Contents |
|---|---|
| [`docs/PROJECT_MASTER.md`](docs/PROJECT_MASTER.md) | Overview, requirements, permissions, technology stack |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, flows, persistence guarantees, diagrams |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | Prisma/PostgreSQL design |
| [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) | REST API contracts |
| [`docs/WEBSOCKET_PROTOCOL.md`](docs/WEBSOCKET_PROTOCOL.md) | Collaboration protocol and application messages |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Numbered decisions and unresolved questions |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Phase-by-phase roadmap |
| [`docs/TESTING.md`](docs/TESTING.md) | Test strategy and measurable metrics |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Production infrastructure and operations |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | Current status and next steps |

## Working method

Development proceeds one phase at a time with owner approval between phases. Architectural decisions are recorded with permanent IDs in `docs/DECISIONS.md`, and unresolved questions are listed rather than assumed. See `CLAUDE.md` for the rules that govern AI-assisted work on this repository.

## License

Not yet chosen (see `docs/DECISIONS.md` U12).