# CLAUDE.md – Permanent instructions for CoNote

These instructions apply to **every** Claude chat or session working on CoNote. Follow them before anything else. If an instruction here conflicts with a request, say so and ask the project owner; do not silently pick one.

## 1. What this project is

**CoNote – Real-Time Collaborative Workspace**: a Notion/Figma-inspired full-stack app where multiple users edit rich-text pages simultaneously (Yjs CRDT), see each other's presence, comment on content, and restore earlier versions. One pnpm monorepo: `apps/web` (Next.js), `apps/api` (Fastify REST), `apps/collab` (Hocuspocus), `packages/db` (Prisma), `packages/shared`, `packages/editor`.

The project is built in **phases (0–11)**. Current status is in `docs/HANDOVER.md`, never in this file.

## 2. Start of every chat (mandatory)

1. Read this file.
2. Read `docs/HANDOVER.md` to learn the current phase, status, outstanding decisions and next steps.
3. Read the documents relevant to the task (see §10). Do not rely on memory or assumptions about earlier chats.
4. State the current phase and the task's scope back to the owner in a few lines before starting work.
5. If something needed is missing, contradictory or unresolved, **say so and ask**; do not fill the gap with a hidden assumption.

## 3. Phase discipline

- Work on **one phase at a time**, only when the owner says to start it.
- At the start of a phase: restate its objectives, scope, acceptance criteria (`docs/IMPLEMENTATION_PLAN.md`) and any unresolved decisions (`U#`) that affect it.
- Do **not** start the next phase, and do not pull work forward from later phases, without explicit owner approval.
- At the end of a phase: report against **every acceptance criterion** (pass/fail with evidence), update `docs/HANDOVER.md`, and **stop and wait for approval**.
- Phase 0 documentation was approved when the owner proceeded with Phase 1. Do not describe Phase 1 implementation as Phase 0 work; keep current status in HANDOVER.md.

## 4. Non-negotiable technical rules

1. **Required stack, no silent replacement:** Next.js, TypeScript, Tailwind CSS, Tiptap/ProseMirror, Yjs, a Yjs-compatible WebSocket server (Hocuspocus, D1), Node.js, PostgreSQL, Prisma, Redis, Docker. Additional libraries only when genuinely necessary, with the reason stated and recorded.
2. **PostgreSQL is the durable source of truth** for application data and collaborative document recovery. **Redis is never permanent storage** and correctness must never depend on it (D14).
3. **Never claim "zero data loss".** Persistence guarantees are exactly G1–G7 in `docs/ARCHITECTURE.md` §8 and may be described as verified only after their tests pass (D14).
4. **Never invent numbers:** no performance results, latency figures, capacity limits or test outcomes. Measure first, record with environment details, then propose targets (`docs/TESTING.md` §7).
5. **Do not assume Redis makes y-websocket/Hocuspocus horizontally scalable.** Follow D2 and its documented limitations. Redis Pub/Sub does not replay missed messages; Redis reconnection alone does not prove live-document reconvergence. Use the explicit recovery design and tests in ARCHITECTURE.md/WEBSOCKET_PROTOCOL.md.
6. **Authorization is enforced on the server**, for REST and WebSocket. The UI only reflects permissions. The role inside a collaboration token is never trusted (D22).
7. **Yjs sync, awareness and application messages are separate layers.** Never mix them (`docs/WEBSOCKET_PROTOCOL.md`).
8. **Comments are not editor content.** Anchors are Yjs Relative Positions; threads live in PostgreSQL (D8). **Restore is a new transaction**, never a history rewrite, and always creates a pre-restore snapshot first (D9). Serialize it against live edits with the durable cross-instance restore barrier; a client banner or Redis Pub/Sub notification alone is not sufficient.
9. **Secrets and tokens:** passwords are Argon2id hashes; session and invitation tokens are stored only as SHA-256 hashes (D5, D30); never log tokens, passwords, cookies or document content; never commit secrets.
10. **Exact dependency pins** and documented Node.js requirements. Check engine and peer-dependency compatibility and official docs **before** choosing or changing versions; record the verification (D13). Use official documentation as the primary reference and link it for important decisions.
11. **TypeScript strict** everywhere; no `any` without a justification comment; validate every boundary input with Zod (D12, D4).
12. **Module boundaries** (`docs/ARCHITECTURE.md` §5) are enforced: apps never import other apps; `web` never imports `db`; `shared` is pure.
13. **Do not mark unimplemented features as complete** anywhere (README, HANDOVER, UI copy, docs).
14. **Avoid unnecessary complexity.** No new service, library or abstraction without a stated need.
15. **Database invariants must be real invariants.** A partial unique index enforces at most one workspace owner, not at least one; use the documented deferred owner-count trigger and test both. Page-tree mutations must serialize on the workspace-tree transaction lock and be backed by the same-workspace composite foreign key.

## 5. Decisions

- `docs/DECISIONS.md` is the permanent register. Decision IDs (`D#`) and unresolved IDs (`U#`) are **never renumbered or reused**.
- Approved by the owner: **D1–D10** (Hocuspocus; Redis fan-out; separate API; Fastify + Zod; custom auth; same-origin proxy; short-lived collab JWTs; Relative-Position comment anchors; restore as a new transaction; S3-compatible image storage). Requirement-derived: D11–D14. D28 (roadmap structure) is approved. Other decisions are marked Proposed until the owner signs off.
- **Do not contradict an Accepted decision.** To change one, propose a new decision that supersedes it, get owner approval, then update every affected document.
- Resolve an unresolved item (`U#`) only with the owner's decision or the evidence the plan says will resolve it (e.g. the Phase 1 spike). Record the outcome in `DECISIONS.md`.
- Unverified assumptions are tracked as `V#` in `docs/ARCHITECTURE.md` §18. Do not treat a `V#` item as fact until it is verified and updated.

## 6. Working method for implementation

- Prefer small, reviewable changes. Explain what you will create or change (files, tables, endpoints) before doing it when the scope is not trivial.
- Implement exactly what the current phase scopes. If a needed change falls outside the phase, report it instead of doing it.
- **Write tests with the code** (categories in `docs/TESTING.md`). A phase is not complete without them.
- Keep contracts consistent: REST changes update `docs/API_CONTRACTS.md` and the shared Zod schemas; schema changes update `docs/DATABASE_SCHEMA.md` and migrations; protocol changes update `docs/WEBSOCKET_PROTOCOL.md`.
- When code reveals that a document is wrong, **fix the document in the same change** and note it in HANDOVER.md; never leave code and docs disagreeing.
- Default commit style: small commits with conventional-commit-style messages (e.g. `feat(api): add session revocation`). The owner may change this.

## 7. Code standards

- Strict TypeScript, ESLint and Prettier clean; no unused code or commented-out blocks.
- API responses use the standard envelope and error codes (`docs/API_CONTRACTS.md` §1, D31). Errors never leak internals.
- All database access for collaborative documents goes through the document store in `packages/db` (row-locked, diff-based; `docs/DATABASE_SCHEMA.md` §7).
- Permission checks call the single shared pure function (`packages/shared`, D23); do not re-implement role logic.
- Names: clear and consistent with the docs (e.g. `documentName = page:<pageId>`, endpoint ids like `AUTH-02`).
- Logging: structured, with request/connection ids, no sensitive content.

## 8. Delivering output

- When working in a repository, create files directly. When there is no repository access, provide **complete file contents organized by filename**, never abbreviated examples, and never "rest unchanged" placeholders.
- Generate large sets of files in **manageable batches**, then run a consistency check across them.
- Reports must be honest: say what was verified, what was not, and what remains unresolved.

## 9. Security reminders

- Treat all client input as untrusted, including awareness states and WebSocket messages (WEBSOCKET_PROTOCOL §6, §11).
- Existence hiding: no access → `404`, insufficient role → `403` (API_CONTRACTS §1).
- Rate limits, Origin checks and CSRF defences are part of the baseline (D25), not optional extras.
- Any request involving credentials, keys or production data: do not store or echo secrets; use placeholders.

## 10. Document map

| Need | Read |
|---|---|
| Current status and next steps | `docs/HANDOVER.md` |
| Requirements, roles, permission matrix, stack versions | `docs/PROJECT_MASTER.md` |
| Components, flows, persistence guarantees, unverified items | `docs/ARCHITECTURE.md` |
| Tables, constraints, persistence detail | `docs/DATABASE_SCHEMA.md` |
| REST endpoints and error codes | `docs/API_CONTRACTS.md` |
| WebSocket and Yjs protocol, application messages | `docs/WEBSOCKET_PROTOCOL.md` |
| Decisions and unresolved questions | `docs/DECISIONS.md` |
| Phases and acceptance criteria | `docs/IMPLEMENTATION_PLAN.md` |
| Test strategy, metrics, traceability | `docs/TESTING.md` |
| Production setup and operations | `docs/DEPLOYMENT.md` |
| Public project description | `README.md` |

## 11. End of every chat

Update `docs/HANDOVER.md` with: what was done, what changed in decisions/docs, test evidence, open issues, and the exact next step. If the chat ends mid-task, record precisely where it stopped.
