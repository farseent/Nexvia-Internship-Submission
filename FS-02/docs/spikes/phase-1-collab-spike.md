# Phase 1b collaboration spike – execution report

**Status: HARNESS EXECUTED; S1–S11 PASS (SPIKE-LEVEL EVIDENCE).**

The isolated Hocuspocus 4.8.0 collaboration spike was executed locally on 2026-11-12. All eleven scenarios reported `PASS`. This establishes experimental evidence for the tested setup only; it does not constitute production verification or close all Phase 1b acceptance criteria.

**Last updated:** 2026-11-12

## 1. Scope and safety boundary

This is a disposable Phase 1b experiment for the Hocuspocus 4.8.0 behaviour described by `docs/IMPLEMENTATION_PLAN.md` S1–S11. It is not production collaboration code.

- Two standalone Hocuspocus processes: `127.0.0.1:4201` and `127.0.0.1:4202`.
- Shared throwaway PostgreSQL database: `conote_collab_poc`.
- Isolated Redis container: `conote-collab-poc-redis`, host port `6380`.
- Existing production collaboration and Redis services were left running on their separate ports.
- The runner refuses any database name other than `conote_collab_poc` and any Redis port other than `6380`.
- Persistence tables are `collab_poc_documents` and `collab_poc_updates`; no Prisma model or production migration is added.
- Throwaway Ed25519 keys are generated in memory per run.
- The spike is outside the root pnpm workspace and is excluded from root lint/format traversal. Its own package has its own lockfile and typecheck/build scripts.
- Redis is not the durable store. The prototype uses PostgreSQL row locks; the Redis extension is configured with `lockTimeout: 0` (supported in Hocuspocus 4.8.0) so its distributed lock is not a prerequisite for a PostgreSQL store.

## 2. Dependency pins

| Dependency | Pin |
|---|---:|
| `@hocuspocus/server` | 4.8.0 |
| `@hocuspocus/extension-redis` | 4.8.0 |
| `@hocuspocus/provider` | 4.8.0 |
| `yjs` | 13.6.33 |
| `y-protocols` | 1.0.7 |
| `ioredis` | 5.6.1 |
| `pg` | 8.23.1 |
| `typescript` | 5.9.3 |
| `tsx` | 4.23.15 |
| `@types/node` | 24.19.2 |

## 3. Execution environment

The following environment checks and spike commands were run locally.

| Check | Observed result |
|---|---|
| Node.js | v24.18.0 |
| pnpm | 12.18.0 |
| Docker CLI | 29.9.2 |
| Docker Compose | v5.6.1 |
| Isolated PostgreSQL database | `conote_collab_poc`, user `conote` |
| Isolated Redis | `127.0.0.1:6380`, `PING` returned `PONG` |
| Existing production services | Left running on their separate ports |
| Shell script syntax | `bash -n spikes/collab-poc/run-phase1b.sh` passed |
| Spike dependency installation | Frozen-lockfile installation succeeded |
| Environment preflight | Passed; database and Redis isolation checks succeeded |
| TypeScript typecheck | Passed using the spike package's `pnpm run typecheck` |
| Build | Passed using the spike package's build script |
| Experiment runner | S1–S11 all reported `PASS` |

The experiment runner was also run directly from `spikes/collab-poc` with:

```bash
SERVER_A_PORT=4201 SERVER_B_PORT=4202 pnpm exec tsx src/run.ts
```

The complete terminal output was captured on 2026-11-12. The runner's S1 human-readable detail still says ports `4100/4101`; the actual server startup logs confirm that the experiment used ports `4201/4202`. The runner detail should be corrected to avoid misleading future readers.

## 4. Scenario results

All eleven scenarios reported **PASS** in the 2026-11-12 execution.

| ID | Evidence observed | Result |
|---|---|---|
| S1 | Two providers connected to separate Hocuspocus instances and converged on the same Y.Text update. Actual ports were 4201 and 4202. | **PASS** |
| S2 | Awareness propagated across instances. Awareness was removed after a separate client process was terminated with SIGKILL. | **PASS** |
| S3 | A read-only document update was not applied remotely. Awareness from the read-only client was accepted and propagated. | **PASS** |
| S4 | Three incremental writes were persisted; the configured spike compaction threshold of 3 triggered compaction. PostgreSQL reload returned `"onetwothree"`. | **PASS** |
| S5 | A Redis-propagated update reached the other instance. The originating instance recorded one local store hook; the receiving instance recorded zero Redis-originated store hooks. | **PASS** |
| S6 | Committed content was recovered without a surviving client. A surviving client's retained Y.Doc re-sent an offline edit after reconnect. | **PASS** |
| S7 | Redis outage produced a temporary split. After Redis restarted, already-open documents did not automatically converge (`autoConverged=false`). After both Hocuspocus servers restarted and rehydrated from PostgreSQL, they converged on the combined content. | **PASS** |
| S8 | A valid EdDSA token was accepted. An invalid token signature was rejected by `onAuthenticate`. The provider token callback was invoked once, `tokenInQuery=false` was observed, and the invalid client did not connect/synchronize. | **PASS** |
| S9 | A client-to-server stateless message was received and echoed to the originating connection. | **PASS** |
| S10 | `beforeHandleAwareness` removed a forged awareness identity before it was applied/broadcast. | **PASS** |
| S11 | The pinned Hocuspocus 4.8.0 declarations were inspected for WebSocket payload, pre-authentication queue, pending-document and connection-count capabilities. | **PASS** |

### Important interpretation and limitations

#### S2 – Awareness expiry

The tested separate client process was killed with SIGKILL, and the awareness state was observed to be removed. This is evidence for the tested process-kill case, not a guarantee covering every network partition, browser suspension or abrupt client-disconnection condition.

#### S4 – Compaction

The harness uses a compaction threshold of 3 to make the experiment short. This is not a proposed production compaction threshold.

#### S5 – Redis-originated store hooks

The experiment observed one store hook on the originating instance and zero on the receiving instance for the Redis-originated update. This supports the tested configuration's avoidance of duplicate persistence through the receiving instance's store hook.

#### S7 – Redis outage and recovery

During the Redis outage, the logs contained repeated ioredis connection-refused warnings for `127.0.0.1:6380`. Both instances continued to produce PostgreSQL store events during the split.

After Redis restarted, the already-open documents did not automatically converge (`autoConverged=false`). This confirms that Redis reconnection alone is not a recovery mechanism for missed Pub/Sub messages.

The separate, stronger recovery check restarted both Hocuspocus instances and rehydrated their documents from PostgreSQL. The two instances then converged on the combined content. PostgreSQL remains the durable recovery source in this prototype.

#### S8 – Authentication

The invalid-signature case was rejected by `onAuthenticate`, and the invalid client did not connect/synchronize. The current successful experiment does not establish an exact provider close-code/reason mapping. Production close-code interpretation remains separate protocol work.

#### S11 – Capability inspection

This scenario inspected library declarations and configuration capabilities. The runtime capability log reported `maxPayloadBytes: 1048576` (1 MiB) for the running spike configuration and `connectionCountApi: false` for the runtime check. Declaration-level capability inspection must not be interpreted as proof that every capability is exposed or enforced by the running server. This experiment did not perform abuse/load enforcement testing.

## 5. Source/API inspection (not empirical evidence)

The following are source/documentation-level findings for Hocuspocus 4.x and the pinned 4.8.0 line. They guide the experiments but do not independently establish production readiness.

- Server configuration uses `debounce` (default 2000 ms) and `maxDebounce` (default 10000 ms); `unloadImmediately` controls whether unload respects the debounce.
- Since v4, `onStoreDocument` can be triggered by document changes that are not WebSocket-originated, including Redis replication. S5 experimentally observed no receiving-instance store hook for the tested Redis-originated update.
- `onAuthenticate` receives the provider token and a connection configuration with `readOnly`; the provider accepts a static token or a sync/async token callback. This is a library capability only; production refresh remains Phase 6.
- The provider's v4 `onClose` callback exposes the close event's `code` and `reason`; exact invalid-token close mapping was not established by the successful S8 experiment.
- `beforeHandleAwareness` receives mutable decoded awareness states, allowing a mismatched identity to be dropped or rewritten before application/broadcast.
- `onStateless` receives client messages and the connection can send a stateless response.
- WebSocket `maxPayload` is configured through `websocketOptions`; Hocuspocus also exposes pre-authentication queue and pending-document limits. These are capability knobs, not a complete rate-limit/abuse policy.
- Hocuspocus 4.8.0 added `lockTimeout: 0` support to store without its Redis lock. The prototype uses this because PostgreSQL row locks are the persistence serialization mechanism and Redis must not become a prerequisite for durability.

References:

- Hocuspocus hooks: https://tiptap.dev/docs/hocuspocus/server/hooks
- Hocuspocus authentication: https://tiptap.dev/docs/hocuspocus/guides/authentication
- Hocuspocus configuration: https://tiptap.dev/docs/hocuspocus/server/configuration
- Hocuspocus Redis extension: https://tiptap.dev/docs/hocuspocus/server/extensions/redis
- Hocuspocus 4.8.0 changelog: https://github.com/ueberdosis/hocuspocus/blob/main/CHANGELOG.md

## 6. Unresolved decisions and verification items

- **U1:** Owner sign-off on Node.js 24 remains pending. The local experiment ran on Node v24.18.0; this does not itself record owner approval.
- **U2:** Owner sign-off on TypeScript 5.9.3 remains pending. The spike typecheck passed with the pinned package setup; this does not itself record owner approval.
- **U3:** S4 and S5 now provide empirical evidence for the tested persistence, compaction, debounce/store-hook and Redis-originated hook behaviour. Review the logs and database evidence against the exact U3 wording before closing it.
- **U4:** S2 and S3 now provide empirical evidence for the tested awareness propagation/removal and read-only behaviour. Review the client-death limitation against the exact U4 wording before closing it.
- **V1–V5:** The experiments provide evidence for the specific scenarios above. Any capability not directly exercised remains pending runtime verification.
- **V6:** Provider token-function capability was exercised in S8. Production fresh-token acquisition remains Phase 6.
- **V11:** Capability inspection only. Production size/rate/connection enforcement and tuning remain Phases 6/9.
- **V12–V14:** Hook APIs and selected runtime behaviours were inspected or prototyped. Review each item's exact acceptance wording before closure. Production presence identity integration remains Phase 7.
- **U13:** Production Redis outage detection/recovery remains Phase 9. This spike evaluates candidate restart/rehydration feasibility only.

## 7. How to reproduce

Follow `spikes/collab-poc/README.md`.

From the repository root in Git Bash, run:

```bash
bash spikes/collab-poc/run-phase1b.sh
```

The script performs the isolated package install, preflight, typecheck, build and S1–S11 runner, and saves terminal output to:

`spikes/collab-poc/phase1b-run.log`

The direct runner command used for the recorded experiment was:

```bash
cd spikes/collab-poc
SERVER_A_PORT=4201 SERVER_B_PORT=4202 pnpm exec tsx src/run.ts
```

The runner's output and the JSON server logs should be retained with the spike evidence. A future run must be recorded separately; do not overwrite the historical result without documenting the new execution date and outcome.

## 8. Acceptance criteria snapshot

| Criterion | Status |
|---|---|
| AC-1.8 – S1–S11 executed and recorded | **Met at spike level** – all eleven scenarios reported PASS on 2026-11-12. |
| AC-1.9 – U3/U4 and V1–V5/V12–V14 evidence | **Partially met** – empirical evidence is now available for the executed scenarios; review each exact requirement and remaining limitations before closure. |
| AC-1.10 – architectural implications and U1/U2 owner decisions | **Not met** – owner decisions remain pending; architectural review/sign-off is still required. |
| AC-1.11 – spike isolated and excluded from root builds | **Prepared; local verification required** – separate workspace, own lockfile and no production imports/migrations were prepared. Record the root checks that verify exclusion. |

**Phase 2 remains blocked until the remaining Phase 1b acceptance criteria and required owner decisions are reviewed and explicitly closed.** Do not close Phase 1 or begin Phase 2 solely because S1–S11 passed in the disposable spike.