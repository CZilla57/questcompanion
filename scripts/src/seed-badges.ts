// Idempotent seed for `badges`, upserted by unique `name`. Run via:
//   pnpm --filter @workspace/scripts seed-badges
//
// Safe to re-run: existing rows are updated in place, so badge IDs — and the
// user_badges rows pointing at them — survive a re-seed.
import { db, pool, badgesTable } from "@workspace/db";
import { BADGE_CATALOG } from "./badge-catalog.js";

async function main() {
  // Pre-flight: duplicate names would silently collapse under the upsert.
  const names = BADGE_CATALOG.map((b) => b.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) throw new Error(`Duplicate badge names: ${[...new Set(dupes)].join(", ")}`);

  for (const badge of BADGE_CATALOG) {
    await db.insert(badgesTable).values(badge).onConflictDoUpdate({
      target: badgesTable.name,
      set: {
        description: badge.description, icon: badge.icon,
        category: badge.category, metric: badge.metric,
        requirement: badge.requirement,
      },
    });
  }

  const byCategory = BADGE_CATALOG.reduce<Record<string, number>>((acc, b) => {
    acc[b.category] = (acc[b.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`✓ seeded ${BADGE_CATALOG.length} badges (upsert by name)`);
  for (const [cat, n] of Object.entries(byCategory).sort()) console.log(`    ${cat}: ${n}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
