import { createPublicKey, verify } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { Redis as RedisExtension } from "@hocuspocus/extension-redis";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";

interface SpikeContext {
  userId: string;
  readOnly: boolean;
}

interface TokenClaims {
  iss: string;
  aud: string;
  exp: number;
  pid: string;
  sub: string;
  readOnly?: boolean;
  jti: string;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const port = Number(process.env.PORT ?? "4100");
const instanceId = required("INSTANCE_ID");
const databaseUrl = required("DATABASE_URL");
const redisHost = process.env.REDIS_HOST ?? "127.0.0.1";
const redisPort = Number(process.env.REDIS_PORT ?? "6380");
const publicKeyPem = required("SPIKE_PUBLIC_KEY");
const publicKey = createPublicKey(publicKeyPem);
const compactAfter = Number(process.env.COMPACT_AFTER_UPDATES ?? "200");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${port}`);
}
if (!Number.isInteger(compactAfter) || compactAfter < 1) {
  throw new Error(`Invalid COMPACT_AFTER_UPDATES: ${compactAfter}`);
}

const databaseTarget = new URL(databaseUrl);
const databaseName = databaseTarget.pathname.replace(/^\//, "");
if (
  databaseName !== "conote_collab_poc" ||
  !["127.0.0.1", "localhost"].includes(databaseTarget.hostname) ||
  databaseTarget.port !== "5433"
) {
  throw new Error("Refusing unsafe PostgreSQL target; use local host port 5433 and database conote_collab_poc");
}
if (redisHost !== "127.0.0.1" || redisPort !== 6380) {
  throw new Error("Refusing unsafe Redis target; use 127.0.0.1:6380 (the disposable Redis container)");
}
const pool = new Pool({ connectionString: databaseUrl, max: 8 });

const log = (event: string, details: Record<string, unknown> = {}): void => {
  process.stdout.write(`${JSON.stringify({
    time: new Date().toISOString(),
    instance: instanceId,
    event,
    ...details,
  })}\n`);
};

const schemaSql = `
CREATE TABLE IF NOT EXISTS collab_poc_documents (
  document_name text PRIMARY KEY,
  state bytea NOT NULL,
  state_vector bytea NOT NULL,
  folded_seq bigint NOT NULL DEFAULT 0,
  last_seq bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collab_poc_updates (
  document_name text NOT NULL REFERENCES collab_poc_documents(document_name) ON DELETE CASCADE,
  seq bigint NOT NULL,
  update_bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_name, seq)
);
`;

const emptyState = (): { state: Uint8Array; vector: Uint8Array } => {
  const doc = new Y.Doc();
  const result = {
    state: Y.encodeStateAsUpdate(doc),
    vector: Y.encodeStateVector(doc),
  };
  doc.destroy();
  return result;
};

async function ensureDocument(client: PoolClient, documentName: string): Promise<void> {
  const empty = emptyState();
  await client.query(
    `INSERT INTO collab_poc_documents (document_name, state, state_vector)
     VALUES ($1, $2, $3) ON CONFLICT (document_name) DO NOTHING`,
    [documentName, Buffer.from(empty.state), Buffer.from(empty.vector)],
  );
}

async function loadDocumentUpdate(documentName: string): Promise<Uint8Array> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await ensureDocument(client, documentName);
    const result = await client.query<{
      state: Buffer;
      state_vector: Buffer;
      folded_seq: string;
    }>(
      `SELECT state, state_vector, folded_seq FROM collab_poc_documents WHERE document_name = $1`,
      [documentName],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Document row missing: ${documentName}`);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(row.state));
    const updates = await client.query<{ update: Buffer }>(
      `SELECT update_bytes FROM collab_poc_updates
       WHERE document_name = $1 AND seq > $2 ORDER BY seq`,
      [documentName, row.folded_seq],
    );
    for (const update of updates.rows) {
      Y.applyUpdate(doc, new Uint8Array(update.update_bytes));
    }
    const reconstructedVector = Y.encodeStateVector(doc);
    if (!Buffer.from(reconstructedVector).equals(row.state_vector)) {
      doc.destroy();
      throw new Error(`Persisted state vector mismatch while loading ${documentName}`);
    }
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    await client.query("COMMIT");
    return state;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function storeDocument(
  documentName: string,
  liveDocument: Y.Doc,
  clientsCount: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureDocument(client, documentName);
    const selected = await client.query<{
      state: Buffer;
      state_vector: Buffer;
      folded_seq: string;
      last_seq: string;
    }>(
      `SELECT state, state_vector, folded_seq, last_seq
       FROM collab_poc_documents WHERE document_name = $1 FOR UPDATE`,
      [documentName],
    );
    const row = selected.rows[0];
    if (!row) throw new Error(`Document row missing: ${documentName}`);

    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, new Uint8Array(row.state));
    const pending = await client.query<{ seq: string; update: Buffer }>(
      `SELECT seq, update_bytes FROM collab_poc_updates
       WHERE document_name = $1 AND seq > $2 ORDER BY seq`,
      [documentName, row.folded_seq],
    );
    for (const entry of pending.rows) {
      Y.applyUpdate(persisted, new Uint8Array(entry.update_bytes));
    }

    const persistedVector = Y.encodeStateVector(persisted);
    if (!Buffer.from(persistedVector).equals(row.state_vector)) {
      persisted.destroy();
      throw new Error(`Persisted state vector mismatch while storing ${documentName}`);
    }
    const diff = Y.encodeStateAsUpdate(liveDocument, new Uint8Array(row.state_vector));
    let lastSeq = Number(row.last_seq);
    if (diff.byteLength > 2) {
      Y.applyUpdate(persisted, diff);
      lastSeq += 1;
      await client.query(
        `INSERT INTO collab_poc_updates (document_name, seq, update_bytes)
         VALUES ($1, $2, $3)`,
        [documentName, lastSeq, Buffer.from(diff)],
      );
    }

    const countResult = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM collab_poc_updates
       WHERE document_name = $1 AND seq > $2`,
      [documentName, row.folded_seq],
    );
    const pendingCount = Number(countResult.rows[0]?.count ?? "0");
    const shouldCompact = pendingCount >= compactAfter || clientsCount === 0;

    if (shouldCompact) {
      const compactedState = Y.encodeStateAsUpdate(persisted);
      const compactedVector = Y.encodeStateVector(persisted);
      await client.query(
        `UPDATE collab_poc_documents
         SET state = $2, state_vector = $3, folded_seq = $4,
             last_seq = $4, updated_at = now()
         WHERE document_name = $1`,
        [documentName, Buffer.from(compactedState), Buffer.from(compactedVector), lastSeq],
      );
      await client.query(
        `DELETE FROM collab_poc_updates WHERE document_name = $1 AND seq <= $2`,
        [documentName, lastSeq],
      );
    } else {
      await client.query(
        `UPDATE collab_poc_documents
         SET state_vector = $2, last_seq = $3, updated_at = now()
         WHERE document_name = $1`,
        [documentName, Buffer.from(Y.encodeStateVector(persisted)), lastSeq],
      );
    }

    persisted.destroy();
    await client.query("COMMIT");
    log("store", {
      documentName,
      clientsCount,
      appended: diff.byteLength > 2,
      pendingCount,
      compacted: shouldCompact,
      lastSeq,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    log("store_error", { documentName, message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    client.release();
  }
}

function verifyToken(token: string, documentName: string): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed throwaway token");
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) throw new Error("Malformed throwaway token");

  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as { alg?: string };
  if (header.alg !== "EdDSA") throw new Error("Unexpected token algorithm");
  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = Buffer.from(signaturePart, "base64url");
  if (!verify(null, signingInput, publicKey, signature)) throw new Error("Invalid token signature");

  const claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as TokenClaims;
  if (claims.iss !== "conote-spike" || claims.aud !== "conote-collab-poc") {
    throw new Error("Invalid token issuer or audience");
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  const match = /^page:([0-9a-f-]{36})$/i.exec(documentName);
  if (!match || claims.pid !== match[1]) throw new Error("Token document mismatch");
  if (!claims.sub || !claims.jti) throw new Error("Missing token subject or jti");
  return claims;
}

const redis = new RedisExtension({
  host: redisHost,
  port: redisPort,
  identifier: instanceId,
  prefix: "conote-collab-poc",
  // PostgreSQL row locks serialize persistence; Redis must not be a prerequisite for stores.
  // Hocuspocus 4.8.0 supports lockTimeout=0 to store without its Redis lock.
  lockTimeout: 0,
  disconnectDelay: 1000,
  awaitInitialSyncTimeout: 1000,
});

const server = new Server<SpikeContext>({
  name: `conote-collab-poc-${instanceId}`,
  port,
  address: "127.0.0.1",
  quiet: true,
  debounce: Number(process.env.STORE_DEBOUNCE_MS ?? "2000"),
  maxDebounce: Number(process.env.STORE_MAX_DEBOUNCE_MS ?? "10000"),
  unloadImmediately: false,
  websocketOptions: { maxPayload: 1024 * 1024 },
  extensions: [redis],
  async onAuthenticate({ token, documentName, connection, requestParameters }) {
    try {
      const claims = verifyToken(token, documentName);
      connection.readOnly = claims.readOnly === true;
      log("authenticated", {
        documentName,
        userId: claims.sub,
        readOnly: connection.readOnly,
        tokenInQuery: requestParameters.has("token"),
      });
      return { userId: claims.sub, readOnly: connection.readOnly };
    } catch (error) {
      log("auth_rejected", {
        documentName,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  async onLoadDocument({ documentName }) {
    return loadDocumentUpdate(documentName);
  },
  async onStoreDocument({ documentName, document, clientsCount, lastTransactionOrigin }) {
    const origin = typeof lastTransactionOrigin === "object" && lastTransactionOrigin !== null
      && "source" in lastTransactionOrigin
      ? String(lastTransactionOrigin.source)
      : "unknown";
    log("store_hook", { documentName, clientsCount, origin });
    await storeDocument(documentName, document, clientsCount);
  },
  async beforeHandleAwareness({ states, context }) {
    for (const [clientId, state] of states) {
      const user = state.user;
      if (!context?.userId || typeof user !== "object" || user === null || user.id !== context.userId) {
        states.delete(clientId);
        log("awareness_rejected", {
          clientId,
          authenticatedUserId: context?.userId ?? null,
          claimedUserId: typeof user === "object" && user !== null && "id" in user
            ? String(user.id)
            : null,
        });
      } else {
        state.user = { id: context.userId };
      }
    }
  },
  async onStateless({ connection, documentName, payload }) {
    log("stateless_received", { documentName, payload });
    connection.sendStateless(JSON.stringify({ type: "ack", payload }));
  },
  async onListen({ port: listeningPort }) {
    log("listening", { port: listeningPort, redisHost, redisPort });
    log("capabilities", {
      connectionCountApi: typeof server.getConnectionsCount === "function",
      maxPayloadBytes: 1024 * 1024,
      storeDebounceMs: Number(process.env.STORE_DEBOUNCE_MS ?? "2000"),
      storeMaxDebounceMs: Number(process.env.STORE_MAX_DEBOUNCE_MS ?? "10000"),
    });
  },
  async onDestroy() {
    log("destroying");
  },
});

await pool.query(schemaSql);
await server.listen();

const shutdown = async (signal: string): Promise<void> => {
  log("shutdown", { signal });
  await server.destroy();
  await pool.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
