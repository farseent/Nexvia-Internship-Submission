/* eslint-disable no-console -- a command-line tool that reports to the terminal */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { DocumentStore } from '@conote/db';
import { RoundRobinProxy } from '../test/cluster-helpers.js';
import {
  BenchClient,
  Instance,
  Seed,
  measureLatency,
  percentiles,
  pgCounters,
  redisClient,
  redisCounters,
  sleep,
  takePort,
} from './lib.js';

/**
 * Phase 9 benchmarks: `node --import tsx apps/collab/bench/run.ts <scenario>`.
 * Scenarios: latency, fanout, connections, persistence, recovery-instance, recovery-redis.
 * Results are written to docs/benchmarks/<scenario>.json and printed.
 */

const OUT = new URL('../../../docs/benchmarks/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const machine = () => ({
  node: process.version,
  cpus: Number(execSync('nproc').toString().trim()),
  memoryMb: Math.round(
    Number(execSync("awk '/MemTotal/ {print $2}' /proc/meminfo").toString().trim()) / 1024,
  ),
  postgres: execSync('psql --version').toString().trim(),
  redis: execSync('redis-server --version').toString().trim().split(' ').slice(0, 3).join(' '),
});

function save(name: string, results: unknown): void {
  const document = { scenario: name, at: new Date().toISOString(), machine: machine(), results };
  writeFileSync(`${OUT}${name}.json`, `${JSON.stringify(document, null, 2)}\n`);
  console.log(JSON.stringify(document.results, null, 2));
}

async function startInstances(
  seed: Seed,
  count: number,
  cluster = true,
  env: Record<string, string> = {},
) {
  const prefix = `conote-bench:${randomUUID().slice(0, 6)}`;
  const instances: Instance[] = [];
  for (let i = 0; i < count; i += 1) {
    const { instance } = await Instance.start({
      id: `bench-${i + 1}`,
      port: takePort(),
      keys: seed.keys,
      cluster,
      prefix,
      env,
    });
    instances.push(instance);
  }
  return { instances, prefix };
}

const stopAll = (instances: Instance[]) => Promise.all(instances.map((i) => i.kill('SIGTERM')));

async function connectAll(clients: BenchClient[], concurrency = 25): Promise<number> {
  let failed = 0;
  for (let i = 0; i < clients.length; i += concurrency) {
    const results = await Promise.all(clients.slice(i, i + concurrency).map((c) => c.ready()));
    failed += results.filter((ok) => !ok).length;
  }
  return failed;
}

// ───────────── latency (PERF-01) ─────────────

async function latency(): Promise<void> {
  const seed = await Seed.create();
  const { workspaceId, users } = await seed.users(2);
  const topologies: {
    name: string;
    instances: number;
    cluster: boolean;
    writerOn: number;
    readerOn: number;
  }[] = [
    {
      name: 'one instance, cluster off (baseline)',
      instances: 1,
      cluster: false,
      writerOn: 0,
      readerOn: 0,
    },
    { name: 'one instance, cluster on', instances: 1, cluster: true, writerOn: 0, readerOn: 0 },
    {
      name: 'two instances, both clients on instance 1',
      instances: 2,
      cluster: true,
      writerOn: 0,
      readerOn: 0,
    },
    {
      name: 'two instances, clients on different instances',
      instances: 2,
      cluster: true,
      writerOn: 0,
      readerOn: 1,
    },
    {
      name: 'three instances, clients on instances 1 and 3',
      instances: 3,
      cluster: true,
      writerOn: 0,
      readerOn: 2,
    },
  ];
  const results: unknown[] = [];
  const redis = redisClient();
  for (const topology of topologies) {
    const pageId = await seed.page(workspaceId, users[0]!);
    const { instances } = await startInstances(seed, topology.instances, topology.cluster, {
      COLLAB_CLUSTER_RESYNC_INTERVAL_MS: '0',
    });
    const writer = new BenchClient(instances[topology.writerOn]!.url, seed, users[0]!, pageId);
    const reader = new BenchClient(instances[topology.readerOn]!.url, seed, users[1]!, pageId);
    await connectAll([writer, reader]);
    await sleep(500);
    const before = await redisCounters(redis);
    const samples = await measureLatency(writer, reader, 300, 30);
    const after = await redisCounters(redis);
    results.push({
      topology: topology.name,
      latencyMs: percentiles(samples),
      redisCommandsPerChange: Math.round(((after.commands - before.commands) / 320) * 10) / 10,
      redisBytesPerChange: Math.round(
        (after.inBytes - before.inBytes + (after.outBytes - before.outBytes)) / 320,
      ),
    });
    writer.destroy();
    reader.destroy();
    await stopAll(instances);
  }
  await redis.quit();
  await seed.close();
  save('latency', results);
}

// ───────────── fan-out on one hot document (PERF-03) ─────────────

async function fanout(): Promise<void> {
  const seed = await Seed.create();
  const receiversTotal = 30;
  const { workspaceId, users } = await seed.users(6);
  const redis = redisClient();
  const results: unknown[] = [];
  for (const topology of [
    { name: '1 instance, cluster off', k: 1, cluster: false },
    { name: '1 instance, cluster on', k: 1, cluster: true },
    { name: '2 instances', k: 2, cluster: true },
    { name: '3 instances', k: 3, cluster: true },
  ]) {
    const pageId = await seed.page(workspaceId, users[0]!);
    const { instances } = await startInstances(seed, topology.k, topology.cluster);
    const writer = new BenchClient(instances[0]!.url, seed, users[0]!, pageId);
    const receivers = Array.from(
      { length: receiversTotal },
      (_, i) => new BenchClient(instances[i % topology.k]!.url, seed, users[1 + (i % 5)]!, pageId),
    );
    await connectAll([writer, ...receivers]);
    await sleep(500);

    const sentAt = new Map<number, number>();
    const latencies: number[] = [];
    for (const receiver of receivers) {
      receiver.ping.observe(() => {
        const n = receiver.ping.get('n');
        const at = n === undefined ? undefined : sentAt.get(n);
        if (at !== undefined) latencies.push(performance.now() - at);
      });
    }
    const cpuBefore = instances.map((i) => i.cpuSeconds());
    const redisBefore = await redisCounters(redis);
    const seconds = 15;
    const rate = 20;
    const startedAt = performance.now();
    for (let i = 1; i <= seconds * rate; i += 1) {
      sentAt.set(i, performance.now());
      writer.ping.set('n', i);
      await sleep(1000 / rate);
    }
    await sleep(500);
    const elapsed = (performance.now() - startedAt) / 1000;
    const redisAfter = await redisCounters(redis);
    results.push({
      topology: topology.name,
      receivers: receiversTotal,
      changesPerSecond: rate,
      deliveryLatencyMs: percentiles(latencies),
      deliveriesExpected: receiversTotal * seconds * rate,
      deliveriesObserved: latencies.length,
      cpuPercentOfOneCore: instances.map(
        (instance, i) =>
          Math.round(((instance.cpuSeconds() - cpuBefore[i]!) / elapsed) * 1000) / 10,
      ),
      rssMb: instances.map((instance) => instance.rssMb()),
      redisCommandsPerSecond: Math.round((redisAfter.commands - redisBefore.commands) / elapsed),
      redisKiloBytesPerSecond:
        Math.round(
          (redisAfter.inBytes -
            redisBefore.inBytes +
            (redisAfter.outBytes - redisBefore.outBytes)) /
            elapsed /
            102.4,
        ) / 10,
    });
    for (const client of [writer, ...receivers]) client.destroy();
    await stopAll(instances);
  }
  await redis.quit();
  await seed.close();
  save('fanout', results);
}

// ───────────── connection capacity and memory (PERF-02) ─────────────

async function connections(): Promise<void> {
  const levels = [100, 250, 500, 1000];
  const seed = await Seed.create();
  const { workspaceId, users } = await seed.users(20);
  const pages: string[] = [];
  for (let i = 0; i < 200; i += 1) pages.push(await seed.page(workspaceId, users[0]!));
  const { instances } = await startInstances(seed, 1, true);
  const instance = instances[0]!;
  const idleRss = instance.rssMb();
  const clients: BenchClient[] = [];
  const results: unknown[] = [];
  let probeA!: BenchClient;
  let probeB!: BenchClient;
  for (const level of levels) {
    const startedAt = performance.now();
    const batch: BenchClient[] = [];
    while (clients.length + batch.length < level) {
      const index = clients.length + batch.length;
      batch.push(
        new BenchClient(
          instance.url,
          seed,
          users[index % users.length]!,
          pages[index % pages.length]!,
        ),
      );
    }
    // Connect in groups of 25 and record how long one group takes to be fully synced.
    const groupMs: number[] = [];
    let failed = 0;
    for (let i = 0; i < batch.length; i += 25) {
      const t0 = performance.now();
      const ok = await Promise.all(batch.slice(i, i + 25).map((c) => c.ready()));
      failed += ok.filter((v) => !v).length;
      groupMs.push(performance.now() - t0);
    }
    clients.push(...batch);
    const rampSeconds = (performance.now() - startedAt) / 1000;
    await sleep(3_000);
    const idleCpu0 = instance.cpuSeconds();
    await sleep(5_000);
    const idleCpuPercent = ((instance.cpuSeconds() - idleCpu0) / 5) * 100;

    // Latency of one pair while a quarter of the clients type (each 1 change/s) for 10 s.
    if (!probeA) {
      probeA = new BenchClient(instance.url, seed, users[0]!, pages[0]!);
      probeB = new BenchClient(instance.url, seed, users[1]!, pages[0]!);
      await connectAll([probeA, probeB]);
    }
    const typists = clients.filter((_, i) => i % 4 === 0);
    let stop = false;
    const typing = typists.map(async (client, i) => {
      await sleep((i * 37) % 1000);
      while (!stop) {
        client.doc.getText('t').insert(0, 'x');
        await sleep(1000);
      }
    });
    const cpu0 = instance.cpuSeconds();
    const latencies = await measureLatency(probeA, probeB, 150, 40, 10);
    const busyCpuPercent = ((instance.cpuSeconds() - cpu0) / ((150 * 40 + 1500) / 1000)) * 100;
    stop = true;
    await Promise.all(typing);
    results.push({
      connections: level,
      failedToConnect: failed,
      rampSeconds: Math.round(rampSeconds * 10) / 10,
      connectGroupOf25Ms: percentiles(groupMs),
      rssMb: instance.rssMb(),
      rssMbPerConnection: Math.round(((instance.rssMb() - idleRss) / level) * 1000) / 1000,
      idleCpuPercentOfOneCore: Math.round(idleCpuPercent * 10) / 10,
      loadedCpuPercentOfOneCore: Math.round(busyCpuPercent * 10) / 10,
      typists: typists.length,
      probeLatencyMsUnderLoad: percentiles(latencies),
      registeredConnections: clients.filter((c) => c.synced).length,
    });
    console.log(`level ${level} done`);
  }
  results.unshift({ idleRssMb: idleRss, documentsOpen: pages.length });
  for (const client of [...clients, probeA, probeB]) client.destroy();
  await stopAll(instances);
  await seed.close();
  save('connections', results);
}

// ───────────── persistence: write volume and lag (PERF-05, D65) ─────────────

async function persistence(): Promise<void> {
  const seed = await Seed.create();
  const { workspaceId, users } = await seed.users(3);
  const results: unknown[] = [];
  const prisma = seed.harness.prisma;
  for (const topology of [
    { name: '1 instance', k: 1, replicated: true },
    { name: '2 instances, replicated stores on', k: 2, replicated: true },
    { name: '3 instances, replicated stores on', k: 3, replicated: true },
    { name: '3 instances, replicated stores off', k: 3, replicated: false },
  ]) {
    const pageId = await seed.page(workspaceId, users[0]!);
    const { instances } = await startInstances(seed, topology.k, true, {
      COLLAB_CLUSTER_STORE_REPLICATED: String(topology.replicated),
      COLLAB_CLUSTER_RESYNC_INTERVAL_MS: '0',
    });
    const clients = instances.map(
      (instance, i) => new BenchClient(instance.url, seed, users[i]!, pageId),
    );
    await connectAll(clients);
    await sleep(1_000);
    await sleep(1_500);
    const pg0 = await pgCounters(seed);
    const editTimes: number[] = [];
    const seconds = 30;
    const text = clients[0]!.doc.getText('t');
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      text.insert(text.length, 'k');
      editTimes.push(Date.now());
      await sleep(100); // ten keystrokes per second
    }
    await sleep(14_000); // longer than the maximum debounce, so everything is stored
    await sleep(1_500); // pg_stat counters are flushed about once a second
    const pg1 = await pgCounters(seed);
    const rows = await prisma.documentUpdate.findMany({
      where: { pageId },
      orderBy: { seq: 'asc' },
      select: { createdAt: true, update: true },
    });
    const lags: number[] = [];
    let previous = 0;
    for (const row of rows) {
      const committed = row.createdAt.getTime();
      const first = editTimes.find((time) => time > previous);
      if (first !== undefined) lags.push(committed - first);
      previous = committed;
    }
    const bytes = rows.reduce((sum, row) => sum + row.update.length, 0);
    const finalDoc = new Y.Doc();
    await new DocumentStore(prisma).load(pageId, finalDoc);
    results.push({
      topology: topology.name,
      keystrokes: editTimes.length,
      rowsWritten: rows.length,
      bytesStored: bytes,
      persistenceLagMs: percentiles(lags),
      databaseTransactionsPerMinute: Math.round(
        ((pg1.commits - pg0.commits) / (seconds + 15.5)) * 60,
      ),
      tuplesInsertedPerMinute: Math.round(((pg1.inserted - pg0.inserted) / (seconds + 15.5)) * 60),
      rebuiltTextMatchesEveryKeystroke: finalDoc.getText('t').length === editTimes.length,
      instanceCpuSeconds: instances.map((i) => Math.round(i.cpuSeconds() * 100) / 100),
    });
    for (const client of clients) client.destroy();
    await stopAll(instances);
  }
  await seed.close();
  save('persistence', results);
}

// ───────────── recovery: instance crash and restart (PERF-04) ─────────────

async function recoveryInstance(): Promise<void> {
  const seed = await Seed.create();
  const { workspaceId, users } = await seed.users(4);
  const pageId = await seed.page(workspaceId, users[0]!);
  const { instances, prefix } = await startInstances(seed, 2, true);
  const lb = new RoundRobinProxy();
  await lb.start();
  lb.setTargets(instances.map((i) => i.port));
  const clients = Array.from(
    { length: 8 },
    (_, i) => new BenchClient(lb.url, seed, users[i % 4]!, pageId),
  );
  await connectAll(clients);
  await sleep(500);

  // Everyone types a numbered token every 100 ms for the whole experiment.
  const tokens: string[] = [];
  let typing = true;
  const typist = (async () => {
    let n = 0;
    while (typing) {
      const token = `<${n++}>`;
      tokens.push(token);
      clients[n % clients.length]!.doc.getText('t').insert(0, token);
      await sleep(100);
    }
  })();
  await sleep(2_000);

  const killedAt = performance.now();
  await instances[0]!.kill('SIGKILL');
  lb.setTargets([instances[1]!.port]);
  let backAfterMs = NaN;
  for (;;) {
    if (clients.every((c) => c.synced)) {
      backAfterMs = performance.now() - killedAt;
      break;
    }
    if (performance.now() - killedAt > 20_000) break;
    await sleep(20);
  }
  await sleep(2_000);

  const { instance: restarted, startupMs } = await Instance.start({
    id: 'bench-1b',
    port: takePort(),
    keys: seed.keys,
    cluster: true,
    prefix,
  });
  lb.setTargets([restarted.port, instances[1]!.port]);
  const newcomer = new BenchClient(restarted.url, seed, users[0]!, pageId);
  const t1 = performance.now();
  await newcomer.ready();
  const newcomerMs = performance.now() - t1;
  await sleep(2_000);
  typing = false;
  await typist;
  await sleep(2_500);
  const everyone = [...clients, newcomer];
  const missingOnClients = tokens.filter(
    (token) => !everyone.every((c) => c.doc.getText('t').toString().includes(token)),
  );
  const stored = new Y.Doc();
  await new DocumentStore(seed.harness.prisma).load(pageId, stored);
  const missingInPostgres = tokens.filter(
    (token) => !stored.getText('t').toString().includes(token),
  );
  save('recovery-instance', {
    clientsKilledWith: clients.length,
    allClientsSyncedAgainAfterMs: Math.round(backAfterMs),
    restartedInstanceStartupMs: Math.round(startupMs),
    newClientOnRestartedInstanceSyncedInMs: Math.round(newcomerMs),
    tokensTyped: tokens.length,
    tokensMissingOnAnyClient: missingOnClients.length,
    tokensMissingInPostgres: missingInPostgres.length,
  });
  for (const client of everyone) client.destroy();
  await lb.stop();
  await stopAll([restarted, instances[1]!]);
  await seed.close();
}

// ───────────── recovery: Redis restart (PERF-04, U13) ─────────────

async function recoveryRedis(): Promise<void> {
  const seed = await Seed.create();
  const { workspaceId, users } = await seed.users(2);
  const pageId = await seed.page(workspaceId, users[0]!);
  const { instances } = await startInstances(seed, 2, true, {
    COLLAB_CLUSTER_RESYNC_INTERVAL_MS: '30000',
  });
  const a = new BenchClient(instances[0]!.url, seed, users[0]!, pageId);
  const b = new BenchClient(instances[1]!.url, seed, users[1]!, pageId);
  await connectAll([a, b]);
  await sleep(500);
  const results: unknown[] = [];
  for (const downSeconds of [2, 10]) {
    // Both sides type during the whole outage so that both have something to merge.
    const before = a.doc.getText('t').length + b.doc.getText('t').length;
    execSync('redis-cli shutdown nosave || true', { stdio: 'ignore' });
    const downAt = performance.now();
    a.doc.getText('t').insert(0, `A${downSeconds}:`);
    b.doc.getText('t').insert(0, `B${downSeconds}:`);
    await sleep(downSeconds * 1000);
    execSync('redis-server --daemonize yes --port 6379 --save "" --appendonly no', {
      stdio: 'ignore',
    });
    const upAt = performance.now();
    // Convergence: both documents hold both markers and are identical.
    for (;;) {
      const ta = a.doc.getText('t').toString();
      const tb = b.doc.getText('t').toString();
      if (ta === tb && ta.includes(`A${downSeconds}:`) && ta.includes(`B${downSeconds}:`)) break;
      if (performance.now() - upAt > 60_000) throw new Error('did not converge');
      await sleep(20);
    }
    const convergedMs = performance.now() - upAt;
    // Live propagation resumes: first ping across instances after recovery.
    const latencies = await measureLatency(a, b, 50, 40, 5);
    results.push({
      redisDownSeconds: downSeconds,
      editsTypedDuringOutage: 2,
      textLengthBefore: before,
      convergedAfterRedisIsBackMs: Math.round(convergedMs),
      outageToConvergedMs: Math.round(performance.now() - downAt),
      latencyAfterRecoveryMs: percentiles(latencies),
    });
    await sleep(1_000);
  }
  a.destroy();
  b.destroy();
  await stopAll(instances);
  await seed.close();
  save('recovery-redis', results);
}

// ───────────── sticky routing evaluation (AC-9.9, D2) ─────────────

async function sticky(): Promise<void> {
  const seed = await Seed.create();
  const { workspaceId, users } = await seed.users(6);
  const redis = redisClient();
  const results: unknown[] = [];
  for (const mode of ['spread', 'sticky'] as const) {
    const { instances } = await startInstances(seed, 3, true);
    const docs = 3;
    const receiversPerDoc = 10;
    const pageIds = await Promise.all(
      Array.from({ length: docs }, () => seed.page(workspaceId, users[0]!)),
    );
    const allClients: BenchClient[] = [];
    const writers: BenchClient[] = [];
    const receivers: BenchClient[][] = [];
    for (let d = 0; d < docs; d += 1) {
      // Spread: a document's clients are shared out over all instances. Sticky: all on one.
      const where = (i: number) => (mode === 'sticky' ? instances[d]! : instances[i % 3]!);
      const writer = new BenchClient(where(0).url, seed, users[0]!, pageIds[d]!);
      const list = Array.from(
        { length: receiversPerDoc },
        (_, i) => new BenchClient(where(i).url, seed, users[1 + (i % 5)]!, pageIds[d]!),
      );
      writers.push(writer);
      receivers.push(list);
      allClients.push(writer, ...list);
    }
    await connectAll(allClients);
    await sleep(800);
    const sentAt = new Map<string, number>();
    const latencies: number[] = [];
    receivers.forEach((list, d) =>
      list.forEach((receiver) =>
        receiver.ping.observe(() => {
          const n = receiver.ping.get('n');
          const at = n === undefined ? undefined : sentAt.get(`${d}:${n}`);
          if (at !== undefined) latencies.push(performance.now() - at);
        }),
      ),
    );
    const cpu0 = instances.map((i) => i.cpuSeconds());
    const redis0 = await redisCounters(redis);
    const seconds = 15;
    const rate = 7; // changes per second per document: 21 per second in total
    const t0 = performance.now();
    for (let i = 1; i <= seconds * rate; i += 1) {
      writers.forEach((writer, d) => {
        sentAt.set(`${d}:${i}`, performance.now());
        writer.ping.set('n', i);
      });
      await sleep(1000 / rate);
    }
    await sleep(500);
    const elapsed = (performance.now() - t0) / 1000;
    const redis1 = await redisCounters(redis);
    const cpu = instances.map(
      (instance, i) => Math.round(((instance.cpuSeconds() - cpu0[i]!) / elapsed) * 1000) / 10,
    );
    results.push({
      routing: mode,
      documents: docs,
      clientsPerDocument: receiversPerDoc + 1,
      changesPerSecondInTotal: docs * rate,
      deliveryLatencyMs: percentiles(latencies),
      deliveries: latencies.length,
      cpuPercentOfOneCorePerInstance: cpu,
      cpuPercentTotal: Math.round(cpu.reduce((sum, v) => sum + v, 0) * 10) / 10,
      redisCommandsPerSecond: Math.round((redis1.commands - redis0.commands) / elapsed),
      redisKiloBytesPerSecond:
        Math.round(
          (redis1.inBytes - redis0.inBytes + (redis1.outBytes - redis0.outBytes)) / elapsed / 102.4,
        ) / 10,
    });
    for (const client of allClients) client.destroy();
    await stopAll(instances);
  }
  await redis.quit();
  await seed.close();
  save('sticky', results);
}

// ───────────── reconnection times, repeated (PERF-04 a and b) ─────────────

async function reconnect(): Promise<void> {
  const seed = await Seed.create();
  const { workspaceId, users } = await seed.users(1);
  const pageId = await seed.page(workspaceId, users[0]!);
  const prefix = `conote-bench:${randomUUID().slice(0, 6)}`;
  const port = takePort();
  const startOne = () =>
    Instance.start({ id: 'bench-r', port, keys: seed.keys, cluster: true, prefix });
  let { instance } = await startOne();
  const client = new BenchClient(instance.url, seed, users[0]!, pageId);
  await client.ready();
  client.doc.getText('t').insert(0, 'content that must survive');
  await sleep(500);

  // (b) the network drops: the client's socket is closed; time until synced again. 20 runs.
  const dropMs: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const socket = client.socket as unknown as { webSocket?: { close: () => void } };
    const t0 = performance.now();
    socket.webSocket?.close();
    await sleep(5);
    while (!client.synced && performance.now() - t0 < 10_000) await sleep(5);
    dropMs.push(performance.now() - t0);
    await sleep(300);
  }

  // (a) the instance restarts (SIGKILL, then a new process on the same port): time from the
  // kill until the client is synced again, and the new process's own start-up time. 7 runs.
  const restartMs: number[] = [];
  const startupMs: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const t0 = performance.now();
    await instance.kill('SIGKILL');
    const started = await startOne();
    instance = started.instance;
    startupMs.push(started.startupMs);
    while (!client.synced && performance.now() - t0 < 30_000) await sleep(10);
    restartMs.push(performance.now() - t0);
    await sleep(500);
  }
  const survived = client.doc.getText('t').toString() === 'content that must survive';
  client.destroy();
  await instance.kill('SIGTERM');
  await seed.close();
  save('reconnect', {
    networkDropToSyncedMs: percentiles(dropMs),
    instanceKillToClientSyncedMs: percentiles(restartMs),
    newProcessStartupMs: percentiles(startupMs),
    contentSurvivedEveryRestart: survived,
    note: 'client reconnect delay 50-500 ms in this benchmark client',
  });
}

const scenarios: Record<string, () => Promise<void>> = {
  latency,
  fanout,
  connections,
  persistence,
  'recovery-instance': recoveryInstance,
  'recovery-redis': recoveryRedis,
  sticky,
  reconnect,
};

const name = process.argv[2] ?? '';
const run = scenarios[name];
if (!run) {
  console.error(`usage: run.ts <${Object.keys(scenarios).join('|')}>`);
  process.exit(2);
}
run().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
