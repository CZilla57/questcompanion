// Standalone migration step, bundled to `dist/migrate.mjs` and run by the
// container before the server starts (see Dockerfile CMD).
//
// A migration whose SQL is wrong still exits non-zero and aborts the boot, so
// the server never serves against a half-migrated database. A database that is
// merely unreachable or refusing service no longer does: it is retried, and if
// it stays down the server boots anyway and degrades per-request instead of
// crash-looping the whole container. See ./lib/migration-failure.
//
// The Dockerfile copies `lib/db/drizzle` to `dist/drizzle`, so the SQL sits
// next to this bundle at runtime. `__dirname` is provided by the esbuild
// banner in build.mjs.
import path from "node:path";
import { runMigrations } from "@workspace/db/migrate";
import { classifyMigrationFailure } from "./lib/migration-failure";

const folder = process.env.DRIZZLE_MIGRATIONS_DIR ?? path.join(__dirname, "drizzle");

// Four retries over ~15s. Long enough to ride out a restart or a brief network
// blip, short enough that a genuinely dead database doesn't stall every deploy.
const ATTEMPTS = 5;
const backoffMs = (attempt: number) => 1000 * 2 ** (attempt - 1);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    await runMigrations(folder);
    console.log(`✓ migrations up to date (${folder})`);
    process.exit(0);
  } catch (err) {
    if (classifyMigrationFailure(err) === "fatal") {
      console.error("✗ migration failed — bad migration, aborting boot:", err);
      process.exit(1);
    }

    if (attempt < ATTEMPTS) {
      const wait = backoffMs(attempt);
      console.warn(
        `… database unavailable (attempt ${attempt}/${ATTEMPTS}), retrying in ${wait}ms`,
      );
      await sleep(wait);
      continue;
    }

    // Out of retries on a transient fault. Booting beats crash-looping: the
    // server can still serve the app shell and health checks, and recovers on
    // its own once the database returns.
    console.error(
      `⚠ database unreachable after ${ATTEMPTS} attempts — starting server WITHOUT ` +
        `applying migrations. Pending migrations will run on the next restart.`,
      err,
    );
    process.exit(0);
  }
}
