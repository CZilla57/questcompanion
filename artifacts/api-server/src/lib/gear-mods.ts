// Gear stat mods (RPG-depth Act I(b)). Pure + DB-free — the derived overlay for
// equipped gear's typed ability bonuses, shared by the roll (roll-engine) and
// the character sheet so they can never disagree. Every value is upside-only:
// the aggregate is clamped ≥ 0 and capped, so gear can only ever raise a score.
import type { AbilityId } from "./character-sheet";
import type { GearRarity } from "@workspace/db";

export type AbilityMods = Partial<Record<AbilityId, number>>;

/** Max total gear bonus to any single ability: +4 score = +2 modifier. Keeps a
 *  fully-geared hero tilting the odds without erasing the dice bands. */
export const PER_ABILITY_CAP = 4;

/** Even score bonus by rarity (rarity-only — level already drives statPower).
 *  Common carries no mod, giving rarity an identity beyond raw power. */
const BONUS_BY_RARITY: Record<GearRarity, number> = {
  common: 0,
  rare: 2,
  epic: 2,
  legendary: 4,
};

export function gearAbilityBonus(rarity: GearRarity): number {
  return BONUS_BY_RARITY[rarity];
}

/** Sum equipped items' stat_mods per ability, clamp each to the cap, and drop
 *  any non-positive entry so the result reads as "only what gear adds". */
export function equippedAbilityMods(equipped: { statMods: AbilityMods }[]): AbilityMods {
  const summed: AbilityMods = {};
  for (const item of equipped) {
    for (const [ability, bonus] of Object.entries(item.statMods) as [AbilityId, number][]) {
      if (!Number.isFinite(bonus) || bonus <= 0) continue;
      summed[ability] = (summed[ability] ?? 0) + bonus;
    }
  }
  const capped: AbilityMods = {};
  for (const [ability, bonus] of Object.entries(summed) as [AbilityId, number][]) {
    const c = Math.min(PER_ABILITY_CAP, bonus);
    if (c > 0) capped[ability] = c;
  }
  return capped;
}

/** The roll's modifier-space term for one ability: half the (even) score bonus. */
export function gearModifierFor(mods: AbilityMods, ability: AbilityId): number {
  return Math.floor((mods[ability] ?? 0) / 2);
}
