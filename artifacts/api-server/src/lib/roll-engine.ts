// The Campaign — Phase 1: the Roll Engine.
//
// A pure, seeded `d20 + ability modifier + proficiency vs DC` resolver. Quest
// completion, encounters (Phase 2), and party actions all resolve through this,
// so it lives in one tested place.
//
// ANTI-SHAME CONTRACT: a roll may only ADD upside or reframe — it can never
// reduce the base reward, XP, level, or streak. There is deliberately no code
// path here that lowers anything: a "glancing" result carries the SAME base
// reward as a success (the quest still completes in full), and only a crit adds
// a bonus. `bandEffect` encodes that, and the tests assert it.
import { kingdomForCategory } from "./kingdoms";
import {
  type AbilityId,
  type AbilityScore,
  abilityForKingdom,
  modifierForAbility,
} from "./character-sheet";

export type CheckBand = "crit" | "success" | "glancing";

/** DC per difficulty rung. The task's existing `difficulty` field drives this;
 *  unknown values fall to the medium DC (the schema's own default). */
export const DC_BY_DIFFICULTY: Record<string, number> = {
  easy: 8,
  medium: 12,
  hard: 16,
};
export const DEFAULT_DC = DC_BY_DIFFICULTY.medium;

export function dcForDifficulty(difficulty: string): number {
  return DC_BY_DIFFICULTY[difficulty] ?? DEFAULT_DC;
}

/** Bonus coins granted on a critical hit. Flat, additive, upside-only. */
export const CRIT_BONUS_COINS = 5;

// ─── Seeded d20 ──────────────────────────────────────────────────────────────
// A string seed → a uniform-enough die. Deterministic so a given completion
// resolves identically on every client and in tests, and CANNOT be re-rolled by
// refetching (the seed is derived from stable inputs, not from `now`).

function hashSeed(seed: string): number {
  // xmur3 string hash → uint32.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic d20 (1–20) from a seed string. */
export function rollD20(seed: string): number {
  return (hashSeed(seed) % 20) + 1;
}

/** Stable seed for a quest-completion check. Uses the completion CALENDAR DAY,
 *  not the exact timestamp, so the same completion always resolves the same and
 *  a client re-render can't reroll it. */
export function taskCheckSeed(userId: number, taskId: number, completionDay: string): string {
  return `task:${userId}:${taskId}:${completionDay}`;
}

export interface SkillCheck {
  d20: number;
  modifier: number;
  proficiency: number;
  total: number;
  dc: number;
  band: CheckBand;
  /** Which ability was rolled (for "Might check" style display). */
  ability: AbilityId;
}

/**
 * Resolve a check. A natural 20 is always a crit (rare, exciting, no DC math);
 * otherwise total ≥ DC is a success and below is a "glancing" hit. There is no
 * "failure" band — the lowest outcome still completes the quest in full; the
 * naming and `bandEffect` keep it upside-only.
 */
export function resolveCheck(args: {
  seed: string;
  modifier: number;
  proficiency: number;
  dc: number;
  ability: AbilityId;
}): SkillCheck {
  const d20 = rollD20(args.seed);
  const total = d20 + args.modifier + args.proficiency;
  const band: CheckBand = d20 === 20 ? "crit" : total >= args.dc ? "success" : "glancing";
  return {
    d20,
    modifier: args.modifier,
    proficiency: args.proficiency,
    total,
    dc: args.dc,
    band,
    ability: args.ability,
  };
}

/**
 * Resolve the check for a completed quest: pick the ability from the task's
 * category (via the kingdom it feeds), read that ability's modifier off the
 * sheet, and roll against the difficulty DC. The reusable seam the completion
 * route calls.
 */
export function resolveTaskCheck(args: {
  seed: string;
  abilities: AbilityScore[];
  proficiency: number;
  category: string;
  difficulty: string;
}): SkillCheck {
  const ability = abilityForKingdom(kingdomForCategory(args.category));
  return resolveCheck({
    seed: args.seed,
    modifier: modifierForAbility(args.abilities, ability),
    proficiency: args.proficiency,
    dc: dcForDifficulty(args.difficulty),
    ability,
  });
}

export interface BandEffect {
  band: CheckBand;
  /** A bonus surprise/loot roll ON TOP of the quest's normal reward. Crit only. */
  bonusLoot: boolean;
  /** Flat bonus coins on top of the normal award. Crit only; never negative. */
  bonusCoins: number;
}

/**
 * The reward delta for a band — always ≥ 0. Note there is no field that can
 * lower the base reward: success and glancing are neutral (the quest's own XP
 * is untouched), and only a crit adds anything. This is the upside-only
 * contract in code.
 */
export function bandEffect(band: CheckBand): BandEffect {
  if (band === "crit") return { band, bonusLoot: true, bonusCoins: CRIT_BONUS_COINS };
  return { band, bonusLoot: false, bonusCoins: 0 };
}

/**
 * Anti-shame narration for a band. Always quotes the quest title; never says
 * "fail"/"failed" and never blames. A glancing hit reframes toward a smaller
 * next step — the difficulty ladder's own language — rather than a penalty.
 */
export function bandNarration(band: CheckBand, questTitle: string): string {
  switch (band) {
    case "crit":
      return `Critical hit — "${questTitle}" done with flair.`;
    case "success":
      return `"${questTitle}" cleared.`;
    case "glancing":
      return `"${questTitle}" is done. A glancing pass — a smaller next step will land clean.`;
  }
}
