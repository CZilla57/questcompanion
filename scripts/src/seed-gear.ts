// Idempotent seed for `gear_items`, upserted by unique `name`. Run via:
//   pnpm --filter @workspace/scripts seed-gear
import { db, pool } from "@workspace/db";
import type { GearSlot, GearRarity } from "@workspace/db";
import { GEAR_CATALOG, gearStatPower, seedGear } from "@workspace/db/gear-catalog";
// Generated catalog lives in the focusquest package; import for the pre-flight resolution check.
import { catalogById } from "../../artifacts/focusquest/src/lib/hero/catalog";

const SLOTS: GearSlot[] = ["weapon", "helmet", "armor", "boots", "accessory"];
const RARITIES: GearRarity[] = ["common", "rare", "epic", "legendary"];

// Pre-flight invariants — fail the seed loudly rather than shipping a broken catalog. (scripts has
// no vitest harness, so these guards are the catalog's test.)
function validate() {
  const errs: string[] = [];

  // 1. Every roster spriteId must resolve for BOTH builds, or gear silently won't render.
  for (const item of GEAR_CATALOG)
    for (const build of ["male", "female"])
      if (!catalogById.has(`gear:${item.spriteId}:${build}`))
        errs.push(`sprite not in catalog: gear:${item.spriteId}:${build} (item "${item.name}")`);

  // 2. Every (slot × rarity) must be obtainable somewhere — so a rolled rarity always has a
  //    candidate to award, and attunement can fill all five slots with epic/legendary.
  for (const slot of SLOTS)
    for (const rarity of RARITIES)
      if (!GEAR_CATALOG.some((i) => i.slot === slot && i.rarity === rarity))
        errs.push(`no item for slot=${slot} rarity=${rarity}`);

  // 3. statPower must equal the formula (no hand-edited off-curve values) and rise with level
  //    within a rarity, so higher-level gear is never weaker than lower-level gear of the same rarity.
  for (const item of GEAR_CATALOG) {
    const expected = gearStatPower(item.levelRequired, item.rarity);
    if (item.statPower !== expected)
      errs.push(`off-curve statPower: "${item.name}" is ${item.statPower}, formula says ${expected}`);
  }
  for (const rarity of RARITIES) {
    const byLevel = GEAR_CATALOG.filter((i) => i.rarity === rarity).sort((a, b) => a.levelRequired - b.levelRequired);
    for (let i = 1; i < byLevel.length; i++)
      if (byLevel[i].statPower < byLevel[i - 1].statPower)
        errs.push(`statPower regresses with level for ${rarity}: "${byLevel[i].name}" < "${byLevel[i - 1].name}"`);
  }

  if (errs.length) throw new Error(`gear catalog validation failed:\n  ${errs.join("\n  ")}`);
}

async function main() {
  validate(); // dev/CI guard — the boot-time seed skips this (data is validated before merge)
  const { total, inStore } = await seedGear(db);
  console.log(`✓ seeded ${total} gear items (${inStore} in-store, ${total - inStore} drop-only)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
