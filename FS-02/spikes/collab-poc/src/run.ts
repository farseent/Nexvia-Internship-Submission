import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { connect as connectTcp, createServer as createTcpServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const ROOT = process.cwd();
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://conote:conote_dev_password@127.0.0.1:5433/conote_collab_poc";
const REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? "6380");
const REDIS_CONTAINER = "conote-collab-poc-redis";
const SERVER_A_PORT = Number(process.env.SERVER_A_PORT ?? "4100");
const SERVER_B_PORT = Number(process.env.SERVER_B_PORT ?? "4101");
const databaseTarget = new URL(DATABASE_URL);
const databaseName = databaseTarget.pathname.replace(/^\//, "");
if (
  databaseName !== "conote_collab_poc" ||
  !["127.0.0.1", "localhost"].includes(databaseTarget.hostname) ||
  databaseTarget.port !== "5433"
) {
  throw new Error("Refusing unsafe PostgreSQL target; use local host port 5433 and database conote_collab_poc");
}
if (REDIS_HOST !== "127.0.0.1" || REDIS_PORT !== 6380) {
  throw new Error("Refusing unsafe Redis target; use 127.0.0.1:6380");
}
const pool = new Pool({ connectionString: DATABASE_URL });
const results: Array<{ id: string; status: "PASS" | "FAIL" | "PARTIAL"; detail: string }> = [];
const logs = new Map<string, string[]>();
const children = new Map<string, ChildProcess>();
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${message}`);
}

async function assertPortAvailable(port: number): Promise<void> {
  const probe = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => error ? reject(error) : resolve());
    });
  }).catch((error: unknown) => {
    throw new Error(`Required spike port ${port} is already in use: ${String(error)}`);
  });
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  await waitFor(() => new Promise<boolean>((resolve) => {
    const socket = connectTcp({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  }), `port ${port} did not open`, timeoutMs);
}

function tokenFor(documentName: string, userId: string, readOnly = false): string {
  const pageId = documentName.slice("page:".length);
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "conote-spike",
    aud: "conote-collab-poc",
    sub: userId,
    pid: pageId,
    readOnly,
    jti: randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 120,
  })).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString("base64url")}`;
}

function newDocumentName(): string {
  return `page:${randomUUID()}`;
}

function startServer(id: string, port: number): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      INSTANCE_ID: id,
      PORT: String(port),
      DATABASE_URL,
      REDIS_HOST,
      REDIS_PORT: String(REDIS_PORT),
      SPIKE_PUBLIC_KEY: publicKeyPem,
      COMPACT_AFTER_UPDATES: process.env.COMPACT_AFTER_UPDATES ?? "3",
      STORE_DEBOUNCE_MS: process.env.STORE_DEBOUNCE_MS ?? "2000",
      STORE_MAX_DEBOUNCE_MS: process.env.STORE_MAX_DEBOUNCE_MS ?? "10000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverLogs: string[] = [];
  logs.set(id, serverLogs);
  child.stdout?.on("data", (chunk: Buffer) => serverLogs.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => serverLogs.push(chunk.toString("utf8")));
  child.once("exit", (code, signal) => {
    serverLogs.push(`PROCESS_EXIT code=${String(code)} signal=${String(signal)}\n`);
  });
  children.set(id, child);
  return child;
}

async function stopServer(id: string, hard = false): Promise<void> {
  const child = children.get(id);
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill(hard ? "SIGKILL" : "SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(5_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  children.delete(id);
}

interface TestClient {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  synced: Promise<void>;
  userId: string;
  receivedStateless: string[];
  closeEvents: Array<{ code: number; reason: string }>;
}

function createClient(
  port: number,
  documentName: string,
  userId: string,
  readOnly = false,
  tokenOverride?: string | (() => string | Promise<string>),
  existingDoc?: Y.Doc,
): TestClient {
  const doc = existingDoc ?? new Y.Doc();
  let resolveSynced: (() => void) | undefined;
  const synced = new Promise<void>((resolve) => { resolveSynced = resolve; });
  const receivedStateless: string[] = [];
  const closeEvents: Array<{ code: number; reason: string }> = [];
  const token = tokenOverride ?? tokenFor(documentName, userId, readOnly);
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name: documentName,
    document: doc,
    token,
    broadcast: false,
    onSynced: () => resolveSynced?.(),
    onStateless: ({ payload }) => receivedStateless.push(payload),
    onClose: ({ event }) => closeEvents.push({ code: event.code, reason: event.reason }),
  });
  return { provider, doc, synced, userId, receivedStateless, closeEvents };
}

async function connectClient(client: TestClient): Promise<void> {
  await Promise.race([
    client.synced,
    delay(15_000).then(() => { throw new Error("Provider did not sync within 15 seconds"); }),
  ]);
}

async function closeClient(client: TestClient): Promise<void> {
  client.provider.destroy();
  client.doc.destroy();
}

function record(id: string, status: "PASS" | "FAIL" | "PARTIAL", detail: string): void {
  results.push({ id, status, detail });
  process.stdout.write(`${status} ${id}: ${detail}\n`);
}

async function runScenario(id: string, fn: () => Promise<string>): Promise<void> {
  try {
    record(id, "PASS", await fn());
  } catch (error) {
    record(id, "FAIL", error instanceof Error ? error.message : String(error));
  }
}

async function queryCounts(documentName: string): Promise<{ base: number; updates: number; lastSeq: string }> {
  const base = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM collab_poc_documents WHERE document_name = $1",
    [documentName],
  );
  const updates = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM collab_poc_updates WHERE document_name = $1",
    [documentName],
  );
  const last = await pool.query<{ last_seq: string }>(
    "SELECT last_seq FROM collab_poc_documents WHERE document_name = $1",
    [documentName],
  );
  return {
    base: Number(base.rows[0]?.count ?? "0"),
    updates: Number(updates.rows[0]?.count ?? "0"),
    lastSeq: last.rows[0]?.last_seq ?? "0",
  };
}

async function main(): Promise<void> {
  await Promise.all([assertPortAvailable(SERVER_A_PORT), assertPortAvailable(SERVER_B_PORT)]);
  const a = startServer("instance-a", SERVER_A_PORT);
  const b = startServer("instance-b", SERVER_B_PORT);
  await Promise.all([waitForPort(SERVER_A_PORT), waitForPort(SERVER_B_PORT)]);
  assert(a.exitCode === null && b.exitCode === null, "A server exited during startup");

  await runScenario("S1", async () => {
    const name = newDocumentName();
    const left = createClient(SERVER_A_PORT, name, "user-a");
    const right = createClient(SERVER_B_PORT, name, "user-b");
    try {
      await Promise.all([connectClient(left), connectClient(right)]);
      left.doc.getText("body").insert(0, "cross-instance-sync");
      await waitFor(() => right.doc.getText("body").toString() === "cross-instance-sync", "cross-instance update");
      return "Two providers on ports 4100/4101 converged on the same Y.Text update.";
    } finally {
      await Promise.all([closeClient(left), closeClient(right)]);
    }
  });

  await runScenario("S2", async () => {
    const name = newDocumentName();
    const observer = createClient(SERVER_B_PORT, name, "presence-observer");
    await connectClient(observer);
    const child = spawn(process.execPath, ["--import", "tsx", "src/kill-client.ts"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(SERVER_A_PORT),
        DOCUMENT_NAME: name,
        USER_ID: "hard-killed-client",
        SPIKE_TOKEN: tokenFor(name, "hard-killed-client"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childOutput = "";
    child.stdout?.on("data", (chunk: Buffer) => { childOutput += chunk.toString("utf8"); });
    try {
      await waitFor(() => childOutput.includes("READY"), "hard-kill client to become synced");
      await waitFor(
        () => [...(observer.provider.awareness?.getStates().values() ?? [])].some((state) =>
          typeof state.user === "object" && state.user?.id === "hard-killed-client"),
        "awareness propagation from child process",
      );
      child.kill("SIGKILL");
      await waitFor(
        () => ![...(observer.provider.awareness?.getStates().values() ?? [])].some((state) =>
          typeof state.user === "object" && state.user?.id === "hard-killed-client"),
        "awareness removal after client process kill",
        50_000,
      );
      return "Awareness propagated across instances and was removed after a separate client process was SIGKILLed.";
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await closeClient(observer);
    }
  });

  await runScenario("S3", async () => {
    const name = newDocumentName();
    const writer = createClient(SERVER_A_PORT, name, "writer");
    const reader = createClient(SERVER_B_PORT, name, "reader", true);
    try {
      await Promise.all([connectClient(writer), connectClient(reader)]);
      reader.doc.getText("body").insert(0, "must-not-persist");
      await delay(1_000);
      assert(writer.doc.getText("body").toString() === "", "Read-only update reached the writer");
      const writerAwareness = writer.provider.awareness;
      const readerAwareness = reader.provider.awareness;
      assert(writerAwareness && readerAwareness, "Provider awareness was unavailable");
      writerAwareness.setLocalStateField("user", { id: "writer", name: "Writer" });
      readerAwareness.setLocalStateField("user", { id: "reader", name: "Reader" });
      await waitFor(
        () => [...writerAwareness.getStates().values()].some((state) =>
          typeof state.user === "object" && state.user?.id === "reader"),
        "read-only awareness propagation",
      );
      return "Read-only document update was not applied remotely; read-only awareness was accepted and propagated.";
    } finally {
      await Promise.all([closeClient(writer), closeClient(reader)]);
    }
  });

  await runScenario("S4", async () => {
    const name = newDocumentName();
    const client = createClient(SERVER_A_PORT, name, "persist-user");
    try {
      await connectClient(client);
      const text = client.doc.getText("body");
      for (const part of ["one", "two", "three"]) {
        text.insert(text.length, part);
        await delay(2_300);
      }
      await waitFor(async () => {
        const counts = await queryCounts(name);
        return counts.base === 1 && Number(counts.lastSeq) >= 1;
      }, "PostgreSQL persistence");
      const counts = await queryCounts(name);
      assert(counts.updates === 0, "Expected compaction at the configured three-update threshold");
      const loaded = await pool.query<{ state: Buffer }>(
        "SELECT state FROM collab_poc_documents WHERE document_name = $1",
        [name],
      );
      const restored = new Y.Doc();
      Y.applyUpdate(restored, new Uint8Array(loaded.rows[0]!.state));
      const persistedText = restored.getText("body").toString();
      restored.destroy();
      assert(persistedText === "onetwothree", `Unexpected persisted text: ${persistedText}`);
      return `Three incremental writes were compacted; PostgreSQL state reloaded as "${persistedText}".`;
    } finally {
      await closeClient(client);
    }
  });

  await runScenario("S5", async () => {
    const name = newDocumentName();
    const left = createClient(SERVER_A_PORT, name, "origin-a");
    const right = createClient(SERVER_B_PORT, name, "origin-b");
    try {
      await Promise.all([connectClient(left), connectClient(right)]);
      left.doc.getText("body").insert(0, "redis-origin-store");
      await waitFor(() => right.doc.getText("body").toString() === "redis-origin-store", "Redis update");
      await waitFor(() => {
        const log = (logs.get("instance-b") ?? []).join("");
        return log.includes('"event":"store_hook"') && log.includes(name);
      }, "store hook on Redis-receiving instance", 8_000);
      const hookA = (logs.get("instance-a") ?? []).join("").split("\\n")
        .filter((line) => line.includes('"event":"store_hook"') && line.includes(name)).length;
      const hookB = (logs.get("instance-b") ?? []).join("").split("\\n")
        .filter((line) => line.includes('"event":"store_hook"') && line.includes(name)).length;
      return `Hocuspocus store-hook events observed: instance A=${hookA}, instance B=${hookB}. Debounce is configured at 2000/10000 ms; per-document timestamps are in server logs.`;
    } finally {
      await Promise.all([closeClient(left), closeClient(right)]);
    }
  });

  await runScenario("S6", async () => {
    const survivingName = newDocumentName();
    const survivingDoc = new Y.Doc();
    const firstConnection = createClient(SERVER_A_PORT, survivingName, "survivor", false, undefined, survivingDoc);
    await connectClient(firstConnection);
    survivingDoc.getText("body").insert(0, "committed-before-crash");
    await waitFor(async () => {
      const counts = await queryCounts(survivingName);
      return Number(counts.lastSeq) > 0;
    }, "pre-crash commit", 12_000);

    await stopServer("instance-a", true);
    firstConnection.provider.destroy();
    survivingDoc.getText("body").insert(survivingDoc.getText("body").length, "-offline-survivor-edit");
    startServer("instance-a", SERVER_A_PORT);
    await waitForPort(SERVER_A_PORT);

    const survivorReconnect = createClient(
      SERVER_A_PORT,
      survivingName,
      "survivor",
      false,
      undefined,
      survivingDoc,
    );
    const observer = createClient(SERVER_B_PORT, survivingName, "recovery-observer");
    try {
      await Promise.all([connectClient(survivorReconnect), connectClient(observer)]);
      await waitFor(
        () => observer.doc.getText("body").toString() === "committed-before-crash-offline-survivor-edit",
        "surviving client's offline edit to be re-sent",
      );
    } finally {
      await Promise.all([closeClient(survivorReconnect), closeClient(observer)]);
    }

    const noSurvivorName = newDocumentName();
    const noSurvivor = createClient(SERVER_B_PORT, noSurvivorName, "no-survivor");
    await connectClient(noSurvivor);
    noSurvivor.doc.getText("body").insert(0, "only-committed-content");
    await waitFor(async () => {
      const counts = await queryCounts(noSurvivorName);
      return Number(counts.lastSeq) > 0;
    }, "second document commit", 12_000);
    await closeClient(noSurvivor);
    await stopServer("instance-b", true);
    startServer("instance-b", SERVER_B_PORT);
    await waitForPort(SERVER_B_PORT);
    const recoveredWithoutClient = createClient(SERVER_B_PORT, noSurvivorName, "fresh-reader");
    try {
      await connectClient(recoveredWithoutClient);
      assert(
        recoveredWithoutClient.doc.getText("body").toString() === "only-committed-content",
        "Committed content was not recovered without a surviving client",
      );
    } finally {
      await closeClient(recoveredWithoutClient);
    }
    return "Committed content recovered without a surviving client; a surviving client's retained Y.Doc re-sent an offline edit after reconnect.";
  });

  await runScenario("S7", async () => {
    const name = newDocumentName();
    const left = createClient(SERVER_A_PORT, name, "outage-a");
    const right = createClient(SERVER_B_PORT, name, "outage-b");
    try {
      await Promise.all([connectClient(left), connectClient(right)]);
      const stop = spawn("docker", ["stop", REDIS_CONTAINER], { stdio: "ignore" });
      const stopCode = await new Promise<number>((resolve) => stop.once("exit", (code) => resolve(code ?? 1)));
      assert(stopCode === 0, `Could not stop isolated Redis container ${REDIS_CONTAINER}`);
      left.doc.getText("body").insert(0, "from-a");
      right.doc.getText("body").insert(0, "from-b");
      await delay(3_000);
      await waitFor(async () => {
        const counts = await queryCounts(name);
        return Number(counts.lastSeq) >= 2;
      }, "both outage-side commits in PostgreSQL", 12_000);
      const splitObserved = left.doc.getText("body").toString() !== right.doc.getText("body").toString();
      const start = spawn("docker", ["start", REDIS_CONTAINER], { stdio: "ignore" });
      const startCode = await new Promise<number>((resolve) => start.once("exit", (code) => resolve(code ?? 1)));
      assert(startCode === 0, `Could not restart isolated Redis container ${REDIS_CONTAINER}`);
      await delay(2_000);
      const autoConverged = left.doc.getText("body").toString() === right.doc.getText("body").toString();
      assert(splitObserved, "Redis outage did not produce an observable split; scenario inconclusive");
      await Promise.all([closeClient(left), closeClient(right)]);
      await Promise.all([stopServer("instance-a"), stopServer("instance-b")]);
      startServer("instance-a", SERVER_A_PORT);
      startServer("instance-b", SERVER_B_PORT);
      await Promise.all([waitForPort(SERVER_A_PORT), waitForPort(SERVER_B_PORT)]);
      const reloadedA = createClient(SERVER_A_PORT, name, "outage-a");
      const reloadedB = createClient(SERVER_B_PORT, name, "outage-b");
      try {
        await Promise.all([connectClient(reloadedA), connectClient(reloadedB)]);
        await waitFor(
          () => reloadedA.doc.getText("body").toString() === reloadedB.doc.getText("body").toString(),
          "explicit restart/re-hydration convergence",
        );
        const recovered = reloadedA.doc.getText("body").toString();
        assert(recovered.includes("from-a") && recovered.includes("from-b"), "Recovered state omitted a committed side");
        return `Redis outage produced a split. After Redis restart alone, already-open documents autoConverged=${autoConverged}; this is recorded as an observation, not proof of Pub/Sub replay. After both servers restarted and re-hydrated from PostgreSQL, they converged to "${recovered}".`;
      } finally {
        await Promise.all([closeClient(reloadedA), closeClient(reloadedB)]);
      }
    } finally {
      await Promise.all([closeClient(left), closeClient(right)]);
      // Ensure the disposable Redis container is running even if an assertion fails.
      const start = spawn("docker", ["start", REDIS_CONTAINER], { stdio: "ignore" });
      await new Promise<void>((resolve) => start.once("exit", () => resolve()));
    }
  });

  await runScenario("S8", async () => {
    const name = newDocumentName();
    let tokenCallbackCalls = 0;
    const client = createClient(
      SERVER_A_PORT,
      name,
      "token-user",
      false,
      async () => {
        tokenCallbackCalls += 1;
        return tokenFor(name, "token-user");
      },
    );
    try {
      await connectClient(client);
      const matchingLog = (logs.get("instance-a") ?? []).join("");
      assert(matchingLog.includes('"tokenInQuery":false'), "Token appeared in the query string");
      assert(tokenCallbackCalls >= 1, "Provider did not call token callback");
      const invalidName = newDocumentName();
      const invalid = tokenFor(invalidName, "invalid-user");
      const [invalidHeader, invalidPayload, invalidSignature] = invalid.split(".");
      assert(invalidHeader && invalidPayload && invalidSignature, "Could not create throwaway token");
      const badSignature = `${invalidHeader}.${invalidPayload}.${invalidSignature[0] === "A" ? "B" : "A"}${invalidSignature.slice(1)}`;
      const rejectedClient = createClient(SERVER_A_PORT, invalidName, "invalid-user", false, badSignature);
      try {
        await waitFor(
          () => (logs.get("instance-a") ?? []).join("").includes(`"event":"auth_rejected"`) &&
            (logs.get("instance-a") ?? []).join("").includes(invalidName),
          "invalid EdDSA token rejection",
        );
        await waitFor(() => rejectedClient.closeEvents.length > 0, "provider auth-failure close event", 8_000);
      } finally {
        await closeClient(rejectedClient);
      }
      const closeEvent = rejectedClient.closeEvents[0];
      return `Valid EdDSA token accepted; invalid signature rejected by onAuthenticate; provider token callback invoked ${tokenCallbackCalls} time(s); server observed tokenInQuery=false; invalid-token close event: code=${closeEvent?.code ?? "unavailable"}, reason=${closeEvent?.reason ?? "unavailable"}.`;
    } finally {
      await closeClient(client);
    }
  });

  await runScenario("S9", async () => {
    const name = newDocumentName();
    const client = createClient(SERVER_A_PORT, name, "stateless-user");
    try {
      await connectClient(client);
      const payload = JSON.stringify({ v: 1, type: "spike.ping", id: "ping-1" });
      client.provider.sendStateless(payload);
      await waitFor(
        () => client.receivedStateless.some((entry) => entry.includes('"type":"ack"')),
        "stateless echo acknowledgement",
      );
      return "Client-to-server stateless message was received and echoed to the originating connection.";
    } finally {
      await closeClient(client);
    }
  });

  await runScenario("S10", async () => {
    const name = newDocumentName();
    const attacker = createClient(SERVER_A_PORT, name, "authenticated-user");
    const observer = createClient(SERVER_B_PORT, name, "observer");
    try {
      await Promise.all([connectClient(attacker), connectClient(observer)]);
      const attackerAwareness = attacker.provider.awareness;
      const observerAwareness = observer.provider.awareness;
      assert(attackerAwareness && observerAwareness, "Provider awareness was unavailable");
      attackerAwareness.setLocalStateField("user", { id: "forged-user", name: "Forged" });
      await delay(1_000);
      const forgedVisible = [...observerAwareness.getStates().values()].some((state) =>
        typeof state.user === "object" && state.user?.id === "forged-user");
      assert(!forgedVisible, "Forged awareness identity reached another client");
      const serverLog = (logs.get("instance-a") ?? []).join("");
      assert(serverLog.includes('"event":"awareness_rejected"'), "Server did not record awareness rejection");
      return "beforeHandleAwareness removed the forged identity before it was applied/broadcast.";
    } finally {
      await Promise.all([closeClient(attacker), closeClient(observer)]);
    }
  });

  await runScenario("S11", async () => {
    const fs = await import("node:fs/promises");
    const serverSource = await fs.readFile(new URL("./server.ts", import.meta.url), "utf8");
    const declarations = await fs.readFile(
      new URL("../node_modules/@hocuspocus/server/dist/index.d.ts", import.meta.url),
      "utf8",
    );
    assert(serverSource.includes("websocketOptions: { maxPayload: 1024 * 1024 }"), "maxPayload config missing");
    assert(serverSource.includes("getConnectionsCount"), "Connection-count capability not referenced");
    assert(declarations.includes("maxUnauthenticatedQueueSize"), "Pre-auth byte queue limit not declared");
    assert(declarations.includes("maxUnauthenticatedQueueMessages"), "Pre-auth message queue limit not declared");
    assert(declarations.includes("maxPendingDocuments"), "Pending-document limit not declared");
    assert(declarations.includes("getConnectionsCount"), "Connection-count API not declared");
    return "Confirmed websocketOptions/maxPayload, getConnectionsCount(), maxUnauthenticatedQueueSize, maxUnauthenticatedQueueMessages and maxPendingDocuments in the pinned 4.8.0 declarations. Runtime defaults are documented as 5 MiB, 1000 messages and 100 pending documents; this is capability inspection, not abuse enforcement.";
  });

  await pool.end();
  const failed = results.filter((result) => result.status === "FAIL");
  process.stdout.write(`\nRESULTS ${JSON.stringify(results, null, 2)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`FATAL: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
} finally {
  for (const id of [...children.keys()]) await stopServer(id);
  await pool.end().catch(() => undefined);
}
