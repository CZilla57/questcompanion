// Standalone gear-catalog seed, bundled to `dist/seed-gear.mjs` and run by the
// container AFTER migrations and BEFORE the server starts (see Dockerfile CMD).
//
// The catalog is static, validated before merge, and upserted idempotently by
// name — so re-seeding on every boot just keeps the deployed catalog in sync
// with the code with no manual step. Unlike a migration, a failed seed must
// NEVER abort the boot: a stale catalog is harmless (the previous rows stay and
// the next deploy retries), whereas not serving the app is not. So every failure
// here — a transient database blip included — is logged and swallowed with a
// zero exit. `__dirname` is provided by the esbuild banner in build.mjs.
import { db, pool } from "@workspace/db";
import { seedGear } from "@workspace/db/gear-catalog";

const ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { total, inStore } = await seedGear(db);
      console.log(`✓ gear catalog seeded: ${total} items (${inStore} in-store, ${total - inStore} drop-only)`);
      return;
    } catch (err) {
      if (attempt < ATTEMPTS) {
        const wait = 1000 * 2 ** (attempt - 1);
        console.warn(`… gear seed failed (attempt ${attempt}/${ATTEMPTS}), retrying in ${wait}ms`, err);
        await sleep(wait);
        continue;
      }
      // Out of retries. Boot anyway — a stale catalog never justifies blocking the server.
      console.error(`⚠ gear seed failed after ${ATTEMPTS} attempts — booting with the existing catalog.`, err);
    }
  }
}

await main();
await pool.end().catch(() => {});
process.exit(0);
