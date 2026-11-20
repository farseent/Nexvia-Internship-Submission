# CoNote Phase 1b collaboration proof of concept

This is a **disposable experiment**, not production collaboration code. It is deliberately outside the root pnpm workspace (`packages: []`) and has its own lockfile. Do not import it from `apps/*` or `packages/*`.

## What it exercises

The runner starts two Hocuspocus 4.8.0 processes on ports 4100 and 4101, each connected to the same disposable PostgreSQL database and Redis instance. Both ports must be free; the runner refuses to start if another service is already listening on either port. It then executes S1–S11 from `docs/IMPLEMENTATION_PLAN.md`.

- PostgreSQL objects are named `collab_poc_documents` and `collab_poc_updates`.
- The database must be the throwaway `conote_collab_poc`, never the application database `conote`.
- Redis must be the disposable container `conote-collab-poc-redis` on host port 6380, never the root Compose Redis on 6379.
- Throwaway Ed25519 keys are generated in memory for each runner process.
- The persistence prototype uses append-only Yjs diffs, a row lock, state-vector merge, and compaction. It is evidence for the proposed D15 design only; it is not the production document store.

## Prerequisites

- Node.js `>=24.0.0 <25` (matches the repository engine).
- pnpm 12.18.0.
- Docker CLI and the existing local PostgreSQL container.
- A PostgreSQL database named `conote_collab_poc` created in the existing PostgreSQL container.
- A separate Redis container named `conote-collab-poc-redis`, bound only to `127.0.0.1:6380`.

Do not use `docker compose down -v`, `infra:reset`, or any command that removes the PostgreSQL volume.

## One-time infrastructure checks

From the repository root, confirm the throwaway database exists:

```bash
docker exec conote-postgres-1 psql -U conote -d conote_collab_poc -c "SELECT current_database(), current_user;"
```

Expected database: `conote_collab_poc`.

Confirm the isolated Redis container exists and responds:

```bash
docker exec conote-collab-poc-redis redis-cli PING
```

Expected: `PONG`.

If the isolated Redis container does not exist, create it (do not use port 6379):

```bash
docker run -d --name conote-collab-poc-redis --restart no -p 127.0.0.1:6380:6379 redis:7-alpine redis-server --save "" --appendonly no
```

## Install and run

From the repository root, run this single command in Git Bash:

```bash
bash spikes/collab-poc/run-phase1b.sh
```

The script checks Node 24, pnpm 12.18.0 and the isolated Redis container, then installs dependencies, checks PostgreSQL/Redis connectivity, type-checks, builds and runs S1–S11. It writes the complete terminal output to `spikes/collab-poc/phase1b-run.log`.

The equivalent individual commands, if you prefer to run them manually from `spikes/collab-poc`, are:

```bash
pnpm install --frozen-lockfile
pnpm run spike:check
pnpm run typecheck
pnpm run build
pnpm run spike
```

The runner:
1. Generates throwaway Ed25519 keys.
2. Starts two server child processes.
3. Creates only the two `collab_poc_*` tables in `conote_collab_poc`.
4. Executes S1–S11 and prints one result per scenario.
5. Stops the child processes.

S7 intentionally stops and starts **only** the isolated Redis container named `conote-collab-poc-redis`. Do not change `REDIS_CONTAINER` to the root Compose Redis container.

Optional environment overrides:

```bash
export DATABASE_URL='postgres://conote:conote_dev_password@127.0.0.1:5433/conote_collab_poc'
export REDIS_HOST='127.0.0.1'
export REDIS_PORT='6380'
export STORE_DEBOUNCE_MS='2000'
export STORE_MAX_DEBOUNCE_MS='10000'
export COMPACT_AFTER_UPDATES='3'
```

The low compaction threshold of 3 is only to make S4 practical in the spike. D15's proposed production starting threshold remains 200 and is not validated by this setting.

## Safety and cleanup

- No production app code, production Prisma schema, or migration is changed.
- The runner writes only to the explicitly configured throwaway database.
- The Redis outage experiment operates only on the isolated container at port 6380.
- The runner does not delete the throwaway database or any Docker volume.
- After the experiments, the Redis container is left running. To remove the throwaway database later, first stop the spike servers and use an explicit `DROP DATABASE conote_collab_poc` only after reviewing its contents. That destructive cleanup is intentionally not automated.

## Important limitations

This is a prototype harness, not a permanent Vitest suite or a production-ready store. It does not certify performance, zero data loss, production recovery, abuse enforcement, production token refresh, or production presence identity. The report in `docs/spikes/phase-1-collab-spike.md` must be updated from the actual run output. Do not mark any scenario passed unless its output and supporting database/server evidence are captured.
