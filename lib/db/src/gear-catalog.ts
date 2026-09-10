import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { gearItemsTable, type GearSlot, type GearRarity, type GearAbilityId } from "./schema";

export interface GearRosterItem {
  name: string; description: string; slot: GearSlot; rarity: GearRarity;
  statPower: number; costXp: number; levelRequired: number; icon: string; spriteId: string;
  inStore: boolean; statMods: Partial<Record<GearAbilityId, number>>;
}

// Power formula (single source of truth). Level dominates the power tier; rarity is a modest
// multiplier. This decouples rarity from level: a low-level item can be any rarity, so a hero can
// luck into a legendary lvl-3 drop (low absolute power, but rare + attunable + uniquely named).
// The drop engine already filters by `levelRequired <= userLevel` and takes the rolled rarity
// independently — the catalog just has to contain the off-diagonal items.
const RARITY_MULT: Record<GearRarity, number> = { common: 1.0, rare: 1.15, epic: 1.3, legendary: 1.5 };
export function gearStatPower(levelRequired: number, rarity: GearRarity): number {
  return Math.round((3 + 1.05 * levelRequired) * RARITY_MULT[rarity]);
}

// A roster row minus the derived numbers (statPower/costXp come from the formula).
interface Row {
  name: string; description: string; slot: GearSlot; rarity: GearRarity;
  levelRequired: number; icon: string; spriteId: string; inStore: boolean;
  ability?: GearAbilityId; // optional per-item override; default derived by rosterAbility()
}

// The ability each item boosts. Default is by slot, with weapon spriteId
// overrides so the weapon slot spans might/intellect/finesse — making the
// weapon choice a real decision, not a fixed spread. helmet carries attunement
// (a circlet of clarity) so all six abilities are covered across the catalog.
// A row may set `ability` to override for marquee flavor.
const DEFAULT_ABILITY_BY_SLOT: Record<GearSlot, GearAbilityId> = {
  weapon: "might",
  helmet: "attunement",
  armor: "vigor",
  boots: "finesse",
  accessory: "presence",
};
const WEAPON_SPRITE_ABILITY: Record<string, GearAbilityId> = {
  staff: "intellect",
  "archmage-staff": "intellect",
  bow: "finesse",
  slingshot: "finesse",
  crossbow: "finesse",
};
export function rosterAbility(row: Row): GearAbilityId {
  if (row.ability) return row.ability;
  if (row.slot === "weapon" && WEAPON_SPRITE_ABILITY[row.spriteId]) {
    return WEAPON_SPRITE_ABILITY[row.spriteId]!;
  }
  return DEFAULT_ABILITY_BY_SLOT[row.slot];
}

// Mirrors BONUS_BY_RARITY in api-server/src/lib/gear-mods.ts — keep in sync.
const ABILITY_BONUS_BY_RARITY: Record<GearRarity, number> = {
  common: 0, rare: 2, epic: 2, legendary: 4,
};

// `inStore: true`  → the curated buy-your-way-up ladder (rarity roughly tracks level; priced by the
//                    Honest-Coin rarity ladder 20/60/150/400).
// `inStore: false` → drop-only treasures: high rarity at low/mid level, and flavorful uniques.
//                    Found via loot/streak rewards, never sold — that's what makes a drop exciting.
// Sprites are reused from the baked archetypes (art variety is bounded until more are baked);
// names/levels/rarity/flavor are free. Every existing item name is preserved so re-seeding upserts
// in place and never orphans owned gear.
const ROSTER: Row[] = [
  // ── WEAPON ─────────────────────────────────────────────────────────────────
  // store ladder
  { name: "Rusty Sword",        description: "A pitted blade, but it cuts.",          slot: "weapon", rarity: "common",    levelRequired: 1,  icon: "Sword", spriteId: "sword",          inStore: true },
  { name: "Knight's Blade",     description: "Balanced steel for a true fighter.",    slot: "weapon", rarity: "rare",      levelRequired: 5,  icon: "Sword", spriteId: "sword",          inStore: true },
  { name: "Gnarled Staff",      description: "Channels arcane focus.",                slot: "weapon", rarity: "rare",      levelRequired: 5,  icon: "Gem",   spriteId: "staff",          inStore: true },
  { name: "Hunter's Sling",     description: "A swift ranged sidearm.",               slot: "weapon", rarity: "rare",      levelRequired: 5,  icon: "Sword", spriteId: "slingshot",      inStore: true },
  { name: "Windrunner Bow",     description: "Loosed arrows sing on the wind.",       slot: "weapon", rarity: "rare",      levelRequired: 6,  icon: "Sword", spriteId: "bow",            inStore: true },
  { name: "Zweihänder",         description: "A massive two-handed greatsword.",      slot: "weapon", rarity: "epic",      levelRequired: 12, icon: "Sword", spriteId: "greatsword",     inStore: true },
  { name: "Repeating Crossbow", description: "Bolt after bolt, no time to breathe.",  slot: "weapon", rarity: "epic",      levelRequired: 14, icon: "Sword", spriteId: "crossbow",       inStore: true },
  { name: "Excalibur",          description: "The legendary blade of kings.",         slot: "weapon", rarity: "legendary", levelRequired: 25, icon: "Sword", spriteId: "excalibur",      inStore: true },
  { name: "Staff of the Archmage", description: "Raw magic given form.",              slot: "weapon", rarity: "legendary", levelRequired: 25, icon: "Gem",   spriteId: "archmage-staff", inStore: true },
  // drop-only exotics
  { name: "Gutter Shiv",        description: "Crude, but it found you early.",        slot: "weapon", rarity: "rare",      levelRequired: 2,  icon: "Sword", spriteId: "sword",          inStore: false },
  { name: "Emberkiss Shortbow", description: "Its arrows smoke where they strike.",   slot: "weapon", rarity: "epic",      levelRequired: 4,  icon: "Sword", spriteId: "bow",            inStore: false },
  { name: "Feywood Wand",       description: "A sapling's whisper, impossibly old.",  slot: "weapon", rarity: "legendary", levelRequired: 6,  icon: "Gem",   spriteId: "staff",          inStore: false },
  { name: "Duskfang Dagger",    description: "A relic that chose an unready hand.",   slot: "weapon", rarity: "legendary", levelRequired: 3,  icon: "Sword", spriteId: "sword",          inStore: false },
  // mid-band (store epic + drop legendary — the L15–21 gap)
  { name: "Runed Warblade",     description: "Etched with a battle-hymn only it can hear.", slot: "weapon", rarity: "epic",  levelRequired: 17, icon: "Sword", spriteId: "sword",          inStore: true },
  { name: "Stormpike Glaive",   description: "Thunder answers each swing.",           slot: "weapon", rarity: "legendary", levelRequired: 15, icon: "Sword", spriteId: "greatsword",     inStore: false },

  // ── HELMET ─────────────────────────────────────────────────────────────────
  { name: "Leather Cap",        description: "Simple head protection.",               slot: "helmet", rarity: "common",    levelRequired: 1,  icon: "HardHat", spriteId: "cap",       inStore: true },
  { name: "Iron Helm",          description: "Sturdy forged headgear.",               slot: "helmet", rarity: "rare",      levelRequired: 4,  icon: "HardHat", spriteId: "helm",      inStore: true },
  { name: "Great Helm",         description: "Full-face knightly protection.",        slot: "helmet", rarity: "epic",      levelRequired: 11, icon: "HardHat", spriteId: "greathelm", inStore: true },
  { name: "Crown of Valor",     description: "Worn only by champions.",               slot: "helmet", rarity: "legendary", levelRequired: 22, icon: "Crown",   spriteId: "crown",     inStore: true },
  // drop-only exotics
  { name: "Dented Barbute",     description: "Someone braver wore it first.",         slot: "helmet", rarity: "rare",      levelRequired: 2,  icon: "HardHat", spriteId: "helm",      inStore: false },
  { name: "Hexward Hood",       description: "Stitched with wards you can't read.",   slot: "helmet", rarity: "epic",      levelRequired: 5,  icon: "HardHat", spriteId: "cap",       inStore: false },
  { name: "Circlet of the Prodigy", description: "It hums for those who start young.",slot: "helmet", rarity: "legendary", levelRequired: 4,  icon: "Crown",   spriteId: "crown",     inStore: false },
  // mid-band
  { name: "Warden's Greathelm", description: "Standard issue for those who hold the line.", slot: "helmet", rarity: "epic",  levelRequired: 16, icon: "HardHat", spriteId: "greathelm", inStore: true },
  { name: "Helm of the Fallen King", description: "It remembers a crown it can no longer wear.", slot: "helmet", rarity: "legendary", levelRequired: 18, icon: "Crown", spriteId: "crown",   inStore: false },

  // ── ARMOR ──────────────────────────────────────────────────────────────────
  { name: "Leather Vest",       description: "Light, flexible protection.",           slot: "armor",  rarity: "common",    levelRequired: 1,  icon: "ShieldHalf", spriteId: "leather-armor", inStore: true },
  { name: "Chainmail",          description: "Interlocking steel rings.",             slot: "armor",  rarity: "rare",      levelRequired: 5,  icon: "ShieldHalf", spriteId: "mail",          inStore: true },
  { name: "Plate Armor",        description: "Heavy forged protection.",              slot: "armor",  rarity: "epic",      levelRequired: 13, icon: "ShieldHalf", spriteId: "plate",         inStore: true },
  { name: "Dragonscale Plate",  description: "Forged from dragon hide.",              slot: "armor",  rarity: "legendary", levelRequired: 26, icon: "ShieldHalf", spriteId: "dragon-plate",  inStore: true },
  // drop-only exotics
  { name: "Patched Gambeson",   description: "Well-loved, and luckier than it looks.", slot: "armor", rarity: "rare",      levelRequired: 2,  icon: "ShieldHalf", spriteId: "leather-armor", inStore: false },
  { name: "Enchanted Brigandine", description: "The rivets glow when danger nears.",  slot: "armor",  rarity: "epic",      levelRequired: 6,  icon: "ShieldHalf", spriteId: "mail",          inStore: false },
  { name: "Scales of the Wyrmling", description: "Shed by a dragon barely hatched.",  slot: "armor",  rarity: "legendary", levelRequired: 5,  icon: "ShieldHalf", spriteId: "dragon-plate",  inStore: false },
  // mid-band
  { name: "Runesteel Plate",    description: "Forge-runes drink the force of a blow.", slot: "armor",  rarity: "epic",      levelRequired: 18, icon: "ShieldHalf", spriteId: "plate",         inStore: true },
  { name: "Aegis of the Bulwark", description: "Nothing has ever gotten through.",     slot: "armor",  rarity: "legendary", levelRequired: 16, icon: "ShieldHalf", spriteId: "dragon-plate",  inStore: false },

  // ── BOOTS ──────────────────────────────────────────────────────────────────
  { name: "Worn Shoes",         description: "Better than bare feet.",                slot: "boots",  rarity: "common",    levelRequired: 1,  icon: "Footprints", spriteId: "shoes",   inStore: true },
  { name: "Traveler's Boots",   description: "Made for the long road.",               slot: "boots",  rarity: "rare",      levelRequired: 4,  icon: "Footprints", spriteId: "boots",   inStore: true },
  { name: "Steel Greaves",      description: "Armored leg guards.",                   slot: "boots",  rarity: "epic",      levelRequired: 11, icon: "Footprints", spriteId: "greaves", inStore: true },
  { name: "Sabatons of the Vanguard", description: "The first boots over the wall.",  slot: "boots",  rarity: "legendary", levelRequired: 22, icon: "Footprints", spriteId: "greaves", inStore: true },
  // drop-only exotics
  { name: "Squeaky Sandals",    description: "Absurd. Also, somehow, blessed.",       slot: "boots",  rarity: "rare",      levelRequired: 2,  icon: "Footprints", spriteId: "shoes",   inStore: false },
  { name: "Seven-League Boots", description: "Each step is longer than the last.",    slot: "boots",  rarity: "epic",      levelRequired: 5,  icon: "Footprints", spriteId: "boots",   inStore: false },
  { name: "Featherfall Slippers", description: "You have never once tripped in them.",slot: "boots",  rarity: "legendary", levelRequired: 4,  icon: "Footprints", spriteId: "shoes",   inStore: false },
  // mid-band
  { name: "Greaves of the Bastion", description: "Rooted as a fortress wall.",         slot: "boots",  rarity: "epic",      levelRequired: 17, icon: "Footprints", spriteId: "greaves", inStore: true },
  { name: "Striders of the Tempest", description: "You arrive with the storm, or just before it.", slot: "boots", rarity: "legendary", levelRequired: 19, icon: "Footprints", spriteId: "boots", inStore: false },

  // ── ACCESSORY ──────────────────────────────────────────────────────────────
  { name: "Traveler's Cloak",   description: "A warm, sturdy cape.",                  slot: "accessory", rarity: "common",    levelRequired: 1,  icon: "Gem", spriteId: "cape",   inStore: true },
  { name: "Amulet of Focus",    description: "Sharpens the mind.",                    slot: "accessory", rarity: "rare",      levelRequired: 5,  icon: "Gem", spriteId: "amulet", inStore: true },
  { name: "Stormcaller Amulet", description: "Distant thunder answers its wearer.",   slot: "accessory", rarity: "epic",      levelRequired: 13, icon: "Gem", spriteId: "amulet", inStore: true },
  { name: "Mantle of the Archon", description: "Woven from a fallen star's light.",   slot: "accessory", rarity: "legendary", levelRequired: 23, icon: "Gem", spriteId: "cape",   inStore: true },
  // drop-only exotics
  { name: "Threadbare Shawl",   description: "Frayed, warm, and quietly enchanted.",  slot: "accessory", rarity: "rare",      levelRequired: 2,  icon: "Gem", spriteId: "cape",   inStore: false },
  { name: "Gambler's Charm",    description: "Fortune favors the newly bold.",        slot: "accessory", rarity: "epic",      levelRequired: 3,  icon: "Gem", spriteId: "amulet", inStore: false },
  { name: "Locket of Second Wind", description: "It opens for those who keep going.", slot: "accessory", rarity: "legendary", levelRequired: 4,  icon: "Gem", spriteId: "amulet", inStore: false },
  // mid-band
  { name: "Sigil of Warding",   description: "Turns aside what wishes you ill.",      slot: "accessory", rarity: "epic",      levelRequired: 16, icon: "Gem", spriteId: "amulet", inStore: true },
  { name: "Aetherweave Mantle", description: "Spun from the space between moments.",   slot: "accessory", rarity: "legendary", levelRequired: 20, icon: "Gem", spriteId: "cape",   inStore: false },
];

export const GEAR_CATALOG: GearRosterItem[] = ROSTER.map((r) => {
  const statPower = gearStatPower(r.levelRequired, r.rarity);
  const bonus = ABILITY_BONUS_BY_RARITY[r.rarity];
  const statMods: Partial<Record<GearAbilityId, number>> =
    bonus > 0 ? { [rosterAbility(r)]: bonus } : {};
  return { ...r, statPower, costXp: statPower * 50, statMods };
});

/**
 * Idempotently upsert the whole gear catalog (by unique `name`). Safe to run
 * repeatedly — it updates existing rows in place (re-statting, setting in_store)
 * and never deletes, so owned gear is never orphaned. Requires the `in_store`
 * column (migration 0014). Shared by the scripts CLI and the boot-time seed.
 */
export async function seedGear(
  dbi: NodePgDatabase<typeof schema>,
): Promise<{ total: number; inStore: number }> {
  for (const item of GEAR_CATALOG) {
    await dbi.insert(gearItemsTable).values(item).onConflictDoUpdate({
      target: gearItemsTable.name,
      set: {
        description: item.description, slot: item.slot, rarity: item.rarity,
        statPower: item.statPower, costXp: item.costXp, levelRequired: item.levelRequired,
        icon: item.icon, spriteId: item.spriteId, inStore: item.inStore,
        statMods: item.statMods,
      },
    });
  }
  return { total: GEAR_CATALOG.length, inStore: GEAR_CATALOG.filter((i) => i.inStore).length };
}
