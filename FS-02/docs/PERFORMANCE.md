# CoNote – Performance and load results (Phase 9)

**Status:** measured 2026-11-21 (Phase 9); D67 accepted by the owner on 2026-11-21. The owner's local verification (HANDOVER §14.9) was a functional check and did not repeat any measurement here, so every figure below still comes from the one-core preparation environment. Raw results: `docs/benchmarks/*.json` (one file per scenario, with the machine description and a timestamp). Tool: `apps/collab/bench/run.ts` (see "How to repeat" below).

## 0. Read this first: what these numbers are and are not

- **Environment:** one virtual CPU, 4 GB RAM, Node v22.23.5, PostgreSQL 16.15, Redis 7.0.15, Linux. **Everything shared that one core:** the collab instances, PostgreSQL, Redis and the load-generating clients. The owner's target platform (PostgreSQL 17, Node 24, real network, several cores) was not used.
- **Consequence:** the figures show relative behaviour (what costs what, what scales how) and the absence of failures at the sizes tried. They are **not capacity limits and not production latency promises.** In particular, no run reached a limit: the 1,000-connection ramp had no failures, so the real ceiling of one instance is **not known**.
- **Deviation from the TESTING §7 method rules ("several repetitions per profile"):** most scenarios were run **once**; only the reconnection times in §5 have repetitions (20 and 7). Variation between runs was not measured; treat differences smaller than about 2× as unproven unless a section says otherwise. PERF-02 did **not** reach a limit condition (see §3), so the "last stable level" is only a lower bound.
- Instances ran as separate processes from the compiled build (`node apps/collab/dist/main.js`), so CPU and memory come from `/proc` per instance. Clients ran in the benchmark process with the real Hocuspocus provider.
- API latency (§7) was measured **in process** (Fastify `inject`, no network, no TLS, no HTTP parsing), with the real PostgreSQL and Redis.
- Not measured: real browsers, a network between components, TLS, a real load balancer, more than 1,000 connections, documents larger than 7 KB of updates, more than 3 instances, mixed read/write request profiles at higher concurrency than 8.

## 1. Synchronization latency (PERF-01)

One writer changes a value in the shared document, a second client notes when it sees it (same process clock). 300 samples after 20 warm-up changes, one change every 30 ms, one document.

| Topology | p50 ms | p95 ms | p99 ms | Redis commands per change | Redis bytes per change |
|---|---|---|---|---|---|
| 1 instance, cluster sync off (baseline) | 1.81 | 3.29 | 6.15 | 0 | 4 |
| 1 instance, cluster sync on | 1.89 | 4.92 | 8.86 | 1 | 313 |
| 2 instances, both clients on instance 1 | 1.74 | 3.94 | 6.35 | 1 | 313 |
| 2 instances, clients on different instances | 3.73 | 7.29 | 10.46 | 4 | 1,275 |
| 3 instances, clients on instances 1 and 3 | 3.59 | 6.53 | 8.65 | 4 | 1,275 |

**Reading:** a change that has to cross instances takes roughly 2 ms longer at the median than one that stays on an instance. A third instance did not add latency for a pair of clients. The extension relays a change through a state-vector handshake (announce, answer, answer), which is why one change costs 4 Redis commands and about 1.3 KB even for a one-character edit.

## 2. One hot document, many readers (PERF-03)

One writer, 20 changes per second for 15 s, 30 receivers spread evenly over the instances.

| Topology | Delivery p50 / p95 / p99 ms | Deliveries seen / expected | CPU per instance (% of the one core) | RSS per instance MB | Redis commands/s | Redis KB/s |
|---|---|---|---|---|---|---|
| 1 instance, sync off | 2.68 / 8.11 / 13.52 | 9,000 / 9,000 | 3.3 | 191.8 | 0 | 0.1 |
| 1 instance, sync on | 2.66 / 6.01 / 8.98 | 9,000 / 9,000 | 4.7 | 192.2 | 19 | 6.1 |
| 2 instances | 4.49 / 10.12 / 22.72 | 9,000 / 9,000 | 5.8, 4.4 | 199.0, 193.4 | 76 | 24.6 |
| 3 instances | 6.73 / 17.45 / 43.56 | 8,960 / 9,000 | 6.9, 4.7, 4.6 | 160.5, 199.4, 148.9 | 132 | 43.7 |

**Reading:**
- Adding instances to one hot document **increases** total work and latency; it does not share the work. Every instance handles every change of a document that is open on it (this is the point already stated in D2 and DEPLOYMENT §2). Redis traffic grew roughly with the number of instances (19 → 76 → 132 commands/s for the same 20 changes/s).
- **40 of 9,000 observations (0.4 %) were not seen in the 3-instance run. This is unexplained.** A separate run (3 instances, 600 changes, 4 receivers, 20/s) saw every change on every receiver with identical final state, so the likely cause is several changes arriving as one update under CPU contention on one core, but that was **not proven** for the loaded run. The final state of the 30 receivers was not compared in the fan-out run.
- RSS figures differ between instances of one run by up to 50 MB; one sample each, so no conclusion is drawn from that.

## 3. Connections and memory on one instance (PERF-02)

One instance (sync on) with 200 documents open; connections added in steps; every 4th client types one character per second; one pair of clients measures latency during the typing. Idle process: 129.4 MB RSS.

| Connections | Failed | RSS MB | MB per connection (since idle) | Idle CPU % | CPU % while 1/4 type | Probe latency p50 / p95 / p99 ms |
|---|---|---|---|---|---|---|
| 100 | 0 | 194.8 | 0.65 | 0.2 | 8.3 | 2.50 / 6.40 / 28.5 |
| 250 | 0 | 219.7 | 0.36 | 0.6 | 10.0 | 1.83 / 6.57 / 24.3 |
| 500 | 0 | 238.7 | 0.22 | 1.8 | 11.2 | 1.35 / 4.49 / 24.1 |
| 1,000 | 0 | 259.2 | 0.13 | 2.4 | 17.5 | 1.45 / 10.47 / 67.6 |

**Reading:** no connection failed up to 1,000, and memory grew slowly: about 130 MB from the idle process to 1,000 connections, and 64 MB between 100 and 1,000 connections (the 200 open documents are a fixed part of it). The per-connection column falls because the 200 documents are a fixed cost shared by more connections; the **marginal** cost between 500 and 1,000 connections was about 0.04 MB each. Each step's ramp (100 to 500 new connections) took 1.9–3.1 s; the first group of 25 in each step took 1.2–2.0 s, later groups about 40–280 ms (the cause of the slow first group was not investigated). **This load is light (about 250 changes per second in total at 1,000 connections); it does not show what happens at heavy typing rates.** The 1,000 connections were spread over 20 users (per-user limit raised for the test).

## 4. Persistence: write volume and lag (PERF-05, D65)

One document, one typist (10 keystrokes per second for 30 s, 296–297 keystrokes), default debounce (2 s, maximum 10 s). One client per instance.

| Topology | Rows written | Bytes stored | Lag p50 / max ms | DB transactions per minute (whole database) |
|---|---|---|---|---|
| 1 instance | 3 | 347 | 10,078 / 11,715 | 40 |
| 2 instances, replicated stores on | 3 | 346 | 10,098 / 11,661 | 50 |
| 3 instances, replicated stores on | 3 | 346 | 10,121 / 11,638 | 71 |
| 3 instances, replicated stores off | 3 | 346 | 10,077 / 11,634 | 47 |

**Reading:**
- **Replicated stores wrote no duplicate rows:** 3 rows in every topology. The rebuilt document had exactly one character per keystroke in all four runs.
- **The lag is about 10 s because typing never paused for 2 s, so the maximum debounce (10 s) decided the store time.** That is the window in which a crash can lose what no other instance or client holds (G3); it is a setting (`COLLAB_STORE_MAX_DEBOUNCE_MS`), not a defect.
- Replicated stores cost transactions: 3 instances with replication on show about 24 more transactions per minute than with it off (71 vs 47) for one active document. **There was no idle baseline, and the counter is database-wide, so this is indicative only.** The fast path (section 6) is why the cost is a read, not a locked write.

## 5. Recovery (PERF-04)

**Instance killed (SIGKILL) behind a load balancer.** 2 instances, 8 clients on one document through a round-robin TCP proxy, a numbered token typed every 100 ms by the clients throughout (73 tokens).
- All 8 clients were synchronized again after **230 ms** (client reconnect delay set to 50–500 ms in the benchmark client; real browsers use their own back-off, so this is not a promise).
- Replacement instance: listening **706 ms** after start; a new client on it was synchronized in **378 ms**.
- **0 of 73 tokens missing on any client; 0 missing in PostgreSQL.** (The clients kept their edits while disconnected; this shows the combination of client memory, reconnect and storage loses nothing in this scenario. It does not show a server-only guarantee: see G3 in WEBSOCKET_PROTOCOL §20.)

**Redis stopped and started (data discarded), both sides typing during the outage.**

| Redis down | Converged after Redis was back | Latency after recovery p50 / p95 ms |
|---|---|---|
| 2 s | 1,001 ms | 4.98 / 15.84 |
| 10 s | 1,040 ms | 4.98 / 11.79 |

The second pass ran on documents that already held text. "Converged" means both documents were identical and held both outage-time edits, with no manual action. About 1 s of the time is the Redis client's reconnect back-off (up to 2 s between attempts).

**Repeated runs (PERF-04 a and b), one client, one instance (`reconnect` scenario).**

| Measurement | Runs | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| (b) client's socket closed (network drop) until synchronized again | 20 | 119 | 131 | 131 |
| (a) instance killed (SIGKILL) and a new process started on the same port, until the client is synchronized again | 7 | 1,253 | 1,620 | 1,620 |
| start-up of the new process until it answers `/health` | 7 | 742 | 1,071 | 1,071 |

The document content survived every restart. The client's reconnect delay in this benchmark is 50–500 ms; a browser's will differ, so (b) mostly reflects that delay. With 7 and 20 runs the p95/p99 columns are just the largest few values.

## 6. Database work per operation (query optimization)

Counted from the PostgreSQL statement log (`log_statement=all`), including `BEGIN`/`COMMIT`, one operation at a time, on the code before and after Phase 9:

| Operation | Statements before | After |
|---|---|---|
| First store of a new page | 10 | 10 |
| Store with a change (steady state) | 8 | 7 |
| Store with nothing new | 6 | 5 |
| Store of a replicated change that is already stored | 6 (a locked transaction) | **1** (one indexed read, no transaction, no lock) |
| Load a document | 2 | 2 |

Document load time against unfolded update rows (existing PERF-06 baseline test, re-run, median of 5): 10 rows 5.8 ms, 100 rows 5.7 ms, 400 rows 17.4 ms.

What was **not** optimized, and why: revalidation of open connections still checks each connection (a batched version was not written; at 1,000 connections the idle CPU was 2.4 % of a core, which did not justify the change); `PAGE-02` (the unpaginated page tree) was measured in §7 and left as it is.

## 7. API latency (PERF-07)

Eight endpoint groups, 400 requests each after 30 warm-up requests, 8 requests in flight, one user, a workspace with 200 pages (20 roots, 9 children each). **In process** through Fastify's `inject` against the real PostgreSQL and Redis: this measures handler and database time, not network, TLS or the HTTP server. Zero errors in every group.

| Endpoint group | Requests/s | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|
| `GET /workspaces` | 324 | 20.0 | 59.7 | 100.5 | 115.6 |
| `GET /workspaces/:id/pages` (200-page tree, PAGE-02, unpaginated) | 160 | 44.2 | 100.7 | 124.4 | 167.0 |
| `GET /pages/:id` | 298 | 25.0 | 42.7 | 51.6 | 60.4 |
| `GET /pages/:id/threads` (no threads existed) | 197 | 39.8 | 58.9 | 69.9 | 78.8 |
| `GET /pages/:id/versions` | 255 | 29.4 | 44.8 | 94.6 | 96.7 |
| `POST /pages/:id/collab-token` | 250 | 30.6 | 43.7 | 55.8 | 57.4 |
| `PATCH /pages/:id` (rename) | 138 | 53.7 | 86.8 | 135.2 | 144.7 |
| `POST /workspaces/:id/pages` (create) | 139 | 54.3 | 67.7 | 177.2 | 178.5 |

**Reading:** the 200-page tree (the unpaginated `PAGE-02` noted in HANDOVER) answers in a median 44 ms at 8 concurrent requests, about twice a single-page read; no pagination change is justified by this measurement, and none was made. The request mix is not realistic (each group ran alone, one user, no comments or large documents). **Not measured:** authentication endpoints (they hash passwords by design), asset upload, concurrency above 8.

## 8. Sticky-routing evaluation (AC-9.9, D2)

The question: would routing all clients of one document to one instance be worth building? Same total load both ways: 3 instances, 3 documents, 11 clients per document, 7 changes per second per document (21 in total), 15 s. **Spread:** each document's clients are shared over the three instances. **Sticky:** each document's clients all on one instance (document 1 on instance 1 and so on). One run each.

| Routing | Delivery p50 / p95 / p99 ms | Total CPU (% of the one core) | Redis commands/s | Redis KB/s |
|---|---|---|---|---|
| Spread | 13.4 / 31.7 / 49.1 | 12.1 | 143 | 47.1 |
| Sticky | 5.2 / 16.2 / 26.0 | 6.8 | 20 | 6.6 |

(Deliveries: 3,150 in both runs.)

**Reading:** with the same load, sticky routing roughly halved latency and CPU and cut Redis traffic to about one seventh in this one-core, one-run measurement. Correctness does not depend on it: any instance can serve any document (WEBSOCKET_PROTOCOL §20.6).

**Recommendation (decision D67, accepted by the owner 2026-11-21):** do **not** build sticky routing in Phase 9, because no measured load needed it and it adds a routing component to operate. Build it **when** per-document or per-instance CPU or Redis traffic becomes the measured limit on a multi-core run, since the benefit above is large and grows with the number of instances sharing a document. The work involved, **not verified against the client code**: the balancer must learn the document before the WebSocket is routed, which needs the page id in the connection URL; failover must still work (a client whose instance died goes to any instance). Until then, accept the cost described in §2.

## 9. Bottlenecks identified

1. **Per-document work does not scale out.** All instances with a document open handle all of its changes (section 2). Sticky routing by document is the documented future optimization (D2); with the same load it roughly halved latency and CPU in §8.
2. **Store lag under continuous typing is set by the maximum debounce** (section 4).
3. **Redis cost per change is about 4 commands and 1.3 KB across instances** (section 1); at the sizes tried it was small (132 commands/s for 3 instances on one hot document at 20 changes/s).
4. **The recovery pass reconnects at Redis-client back-off speed** (about 1 s at best, section 5).
5. **The single core hid everything else.** A real answer on the CPU cost per connection needs a multi-core run.

## 10. How to repeat

```
pnpm build:packages
pnpm --filter @conote/collab build
node --env-file=.env --import tsx apps/collab/bench/run.ts <scenario>
```

Scenarios: `latency`, `fanout`, `connections`, `persistence`, `recovery-instance`, `recovery-redis`, `sticky`, `reconnect`. API latency: `node --env-file=.env --import tsx apps/api/bench/api-latency.ts` (writes `docs/benchmarks/api-latency.json`). PostgreSQL and Redis must be running; `recovery-redis` stops and starts a local `redis-server` with `redis-cli shutdown nosave` and must not be run against a shared Redis. Each scenario writes `docs/benchmarks/<scenario>.json`. A scenario can take from 1 to 5 minutes. The statement counts in section 6 were taken with `ALTER SYSTEM SET log_statement='all'` (reset afterwards) and are not scripted.