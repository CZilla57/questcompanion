// Standalone migration step, bundled to `dist/migrate.mjs` and run by the
// container before the server starts (see Dockerfile CMD). Exits non-zero on
// failure so a bad migration aborts the deploy instead of booting a server
// against a half-migrated database.
//
// The Dockerfile copies `lib/db/drizzle` to `dist/drizzle`, so the SQL sits
// next to this bundle at runtime. `__dirname` is provided by the esbuild
// banner in build.mjs.
import path from "node:path";
import { runMigrations } from "@workspace/db/migrate";

const folder = process.env.DRIZZLE_MIGRATIONS_DIR
  ?? path.join(__dirname, "drizzle");

try {
  await runMigrations(folder);
  console.log(`✓ migrations up to date (${folder})`);
} catch (err) {
  console.error("✗ migration failed:", err);
  process.exit(1);
}
