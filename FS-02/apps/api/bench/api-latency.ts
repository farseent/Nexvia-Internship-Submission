/* eslint-disable no-console -- a command-line tool that reports to the terminal */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createHarness } from '../test/auth-harness.js';
import { newPage, newUser, newWorkspace } from '../test/workspace-harness.js';

/**
 * PERF-07: API latency per endpoint group (docs/PERFORMANCE.md §6).
 * `node --env-file=.env --import tsx apps/api/bench/api-latency.ts`
 * Requests go through Fastify's `inject` (no network, no TLS) against the real PostgreSQL and Redis.
 */
const pct = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    n: sorted.length,
    p50: r(at(50)),
    p95: r(at(95)),
    p99: r(at(99)),
    max: r(sorted[sorted.length - 1]!),
  };
};

const priv = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
const h = await createHarness({
  config: {
    collab: {
      privateKey: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: priv.x as string,
        d: priv.d as string,
        kid: 'bench-key',
      },
      url: 'ws://collab.test:4100',
    },
  },
});
const owner = await newUser(h, 'bench');
const workspaceId = await newWorkspace(h, owner, 'Bench');
// A tree of 200 pages: 20 roots with 9 children each.
const pageIds: string[] = [];
for (let i = 0; i < 20; i += 1) {
  const root = (await newPage(h, owner, workspaceId, { title: `Root ${i}` })).id as string;
  pageIds.push(root);
  for (let j = 0; j < 9; j += 1)
    pageIds.push(
      (await newPage(h, owner, workspaceId, { title: `Child ${i}.${j}`, parentId: root }))
        .id as string,
    );
}
const pageId = pageIds[0]!;
type Group = { name: string; call: (i: number) => Promise<{ status: number }> };
const get = (url: string) => () => h.call('GET', url, { token: owner.token });
const groups: Group[] = [
  { name: 'GET /workspaces (list)', call: get('/api/v1/workspaces') },
  {
    name: 'GET /workspaces/:id/pages (tree of 200 pages, PAGE-02)',
    call: get(`/api/v1/workspaces/${workspaceId}/pages`),
  },
  { name: 'GET /pages/:id', call: get(`/api/v1/pages/${pageId}`) },
  { name: 'GET /pages/:id/threads (none yet)', call: get(`/api/v1/pages/${pageId}/threads`) },
  { name: 'GET /pages/:id/versions', call: get(`/api/v1/pages/${pageId}/versions`) },
  {
    name: 'POST /pages/:id/collab-token',
    call: () => h.call('POST', `/api/v1/pages/${pageId}/collab-token`, { token: owner.token }),
  },
  {
    name: 'PATCH /pages/:id (rename)',
    call: (i) =>
      h.call('PATCH', `/api/v1/pages/${pageIds[i % pageIds.length]}`, {
        token: owner.token,
        body: { title: `Renamed ${i}` },
      }),
  },
  {
    name: 'POST /workspaces/:id/pages (create)',
    call: (i) =>
      h.call('POST', `/api/v1/workspaces/${workspaceId}/pages`, {
        token: owner.token,
        body: { title: `New ${i}` },
      }),
  },
];
const CONCURRENCY = 8;
const REQUESTS = 400;
const results: unknown[] = [];
for (const group of groups) {
  for (let i = 0; i < 30; i += 1) await group.call(i); // warm-up, not recorded
  const latencies: number[] = [];
  let errors = 0;
  let next = 0;
  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < REQUESTS) {
        const i = next++;
        const t0 = performance.now();
        const res = await group.call(i);
        latencies.push(performance.now() - t0);
        if (res.status >= 400) errors += 1;
      }
    }),
  );
  const seconds = (performance.now() - startedAt) / 1000;
  results.push({
    endpoint: group.name,
    concurrency: CONCURRENCY,
    requests: REQUESTS,
    errors,
    requestsPerSecond: Math.round(REQUESTS / seconds),
    latencyMs: pct(latencies),
  });
  console.log(group.name, JSON.stringify(results.at(-1)));
}
const out = new URL('../../../docs/benchmarks/api-latency.json', import.meta.url).pathname;
mkdirSync(new URL('../../../docs/benchmarks/', import.meta.url).pathname, { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ scenario: 'api-latency', at: new Date().toISOString(), machine: { node: process.version, cpus: Number(execSync('nproc').toString().trim()) }, results }, null, 2)}\n`,
);
await h.close();
process.exit(0);
