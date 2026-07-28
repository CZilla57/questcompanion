import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { databaseSsl } from "./ssl";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSsl(),
});

// A pg Pool emits `error` when an *idle* client dies — the database restarting,
// the pooler dropping the connection, a network blip. EventEmitter throws on an
// unhandled `error`, so without this listener any of those takes the whole
// process down, several seconds after the request that opened the connection
// already succeeded. Logging it lets the pool discard the client and move on.
pool.on("error", (err) => {
  console.error("[db] idle client error (pool will discard it):", err);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
