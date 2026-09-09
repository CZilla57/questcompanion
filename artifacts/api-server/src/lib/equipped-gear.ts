// One shared read of a user's currently-equipped gear, carrying both the battle
// number (statPower/rarity/attuned) and the roll/sheet mods (statMods). Reused
// by getUserPower, the completion roll, and the character-sheet route so the
// query shape can't drift. DB-bound (not pure); the pure aggregation lives in
// gear-mods.ts.
import { and, eq } from "drizzle-orm";
import { db, gearItemsTable, userGearTable, type GearRarity } from "@workspace/db";
import type { AbilityMods } from "./gear-mods";

export interface EquippedGearRow {
  statPower: number;
  rarity: GearRarity;
  attuned: boolean;
  statMods: AbilityMods;
}

export async function readEquippedGear(userId: number): Promise<EquippedGearRow[]> {
  const rows = await db
    .select({ gear: gearItemsTable, userGear: userGearTable })
    .from(userGearTable)
    .innerJoin(gearItemsTable, eq(userGearTable.gearItemId, gearItemsTable.id))
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.equipped, true)));
  return rows.map((r) => ({
    statPower: r.gear.statPower,
    rarity: r.gear.rarity,
    attuned: r.userGear.attuned,
    statMods: (r.gear.statMods ?? {}) as AbilityMods,
  }));
}
