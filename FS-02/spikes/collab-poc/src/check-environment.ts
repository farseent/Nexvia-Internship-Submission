import { Pool } from "pg";
import Redis from "ioredis";

const databaseUrl = process.env.DATABASE_URL ??
  "postgres://conote:conote_dev_password@127.0.0.1:5433/conote_collab_poc";
const redisHost = process.env.REDIS_HOST ?? "127.0.0.1";
const redisPort = Number(process.env.REDIS_PORT ?? "6380");
const databaseTarget = new URL(databaseUrl);
const databaseName = databaseTarget.pathname.replace(/^\//, "");

if (
  databaseName !== "conote_collab_poc" ||
  !["127.0.0.1", "localhost"].includes(databaseTarget.hostname) ||
  databaseTarget.port !== "5433" ||
  redisHost !== "127.0.0.1" ||
  redisPort !== 6380
) {
  throw new Error("Unsafe target: use local PostgreSQL 127.0.0.1:5433/conote_collab_poc and isolated Redis 127.0.0.1:6380.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const redis = new Redis(redisPort, redisHost, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

try {
  const db = await pool.query<{ current_database: string; current_user: string }>(
    "SELECT current_database(), current_user",
  );
  if (db.rows[0]?.current_database !== "conote_collab_poc") {
    throw new Error("PostgreSQL connection did not resolve to conote_collab_poc.");
  }
  await redis.connect();
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error(`Unexpected Redis PING response: ${pong}`);
  process.stdout.write(JSON.stringify({
    status: "ready",
    database: db.rows[0].current_database,
    databaseUser: db.rows[0].current_user,
    redisHost,
    redisPort,
    redis: pong,
    node: process.version,
  }, null, 2) + "\n");
} finally {
  await redis.quit().catch(() => undefined);
  await pool.end();
}
