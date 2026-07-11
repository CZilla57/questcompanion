// Idempotent seed for `gear_items`, upserted by unique `name`. Run via:
//   pnpm --filter @workspace/scripts seed-gear
import { db, pool, gearItemsTable } from "@workspace/db";
import { GEAR_CATALOG } from "./gear-catalog.js";
// Generated catalog lives in the focusquest package; import for the pre-flight resolution check.
import { catalogById } from "../../artifacts/focusquest/src/lib/hero/catalog";

async function main() {
  // Pre-flight: every roster spriteId must resolve for BOTH builds, or gear silently won't render.
  const missing: string[] = [];
  for (const item of GEAR_CATALOG)
    for (const build of ["male", "female"])
      if (!catalogById.has(`gear:${item.spriteId}:${build}`)) missing.push(`gear:${item.spriteId}:${build} (item "${item.name}")`);
  if (missing.length) throw new Error(`Roster references sprites not in catalog:\n  ${missing.join("\n  ")}`);

  for (const item of GEAR_CATALOG) {
    await db.insert(gearItemsTable).values(item).onConflictDoUpdate({
      target: gearItemsTable.name,
      set: {
        description: item.description, slot: item.slot, rarity: item.rarity,
        statPower: item.statPower, costXp: item.costXp, levelRequired: item.levelRequired,
        icon: item.icon, spriteId: item.spriteId,
      },
    });
  }
  console.log(`✓ seeded ${GEAR_CATALOG.length} gear items (upsert by name)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
