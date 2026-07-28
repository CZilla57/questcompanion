import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { databaseSsl } from "./ssl";

/**
 * Applies any pending migrations in `migrationsFolder`, then closes its pool.
 *
 * Uses its own short-lived pool rather than the app's shared one so it can run
 * as a standalone step before the server boots.
 *
 * Drizzle records applied migrations in `drizzle.__drizzle_migrations` and
 * decides what to run by comparing each migration's journal timestamp against
 * the newest recorded one — so a migration is skipped iff its timestamp is not
 * newer than the last applied. Re-running is a no-op.
 */
export async function runMigrations(
  migrationsFolder: string,
  connectionString = process.env.DATABASE_URL,
  // Overridable so the pipeline can be exercised against a throwaway schema
  // without touching the real `drizzle.__drizzle_migrations` ledger.
  migrationsSchema = "drizzle",
): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL must be set to run migrations");

  const pool = new pg.Pool({ connectionString, max: 1, ssl: databaseSsl() });
  try {
    await migrate(drizzle(pool), { migrationsFolder, migrationsSchema });
  } finally {
    await pool.end();
  }
}

/**
 * The migrations folder that ships with this package (`lib/db/drizzle`).
 * The production image copies that folder next to the bundled entry instead,
 * so the server passes its own path rather than using this.
 */
export const packageMigrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);
