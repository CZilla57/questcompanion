// The Campaign — Phase 1: the Roll Engine.
//
// A pure, seeded `d20 + ability modifier + proficiency vs DC` resolver. Quest
// completion, encounters (Phase 2), and party actions all resolve through this,
// so it lives in one tested place.
//
// ANTI-SHAME CONTRACT: a roll may only ADD upside or reframe — it can never
// reduce the base reward, XP, level, or streak. There is deliberately no code
// path here that lowers anything: every band carries the SAME base reward (the
// quest always completes in full), only a crit adds a bonus, and the lowest
// band ("fail") is NOT a penalty — its only consequence is to OFFER the
// supportive rescue pathway (a gentler next step). It never applies a debuff,
// never writes a rescue_events row on its own (that table records interventions
// the user actually took), and never reads as blame. `bandEffect` encodes this,
// and the tests assert it.
//
// The four bands (Act II) split the sub-DC region the old three-band model
// collapsed into "glancing": a check that just missed the DC is a "partial"
// (the same calm reframe), and one that missed badly — or a natural 1 — is a
// "fail" that routes the user toward help. Both still complete the quest in
// full; the difference is narrative and how eagerly we offer a smaller opening.
import { kingdomForCategory } from "./kingdoms";
import {
  type AbilityId,
  type AbilityScore,
  abilityForKingdom,
  modifierForAbility,
} from "./character-sheet";

export type CheckBand = "crit" | "success" | "partial" | "fail";

/** How far below the DC still counts as a "partial" (a near miss) rather than a
 *  "fail". Missed by 1…PARTIAL_MARGIN → partial; by more → fail. */
export const PARTIAL_MARGIN = 4;

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

/** Deterministic uniform in [0, 1) from a seed string — the same PRNG as the
 *  die, for callers that need a probability (e.g. loot drop tables) rather than
 *  a 1–20 roll. Stable and un-rerollable for a fixed seed, like rollD20. */
export function seededUnit(seed: string): number {
  return hashSeed(seed) / 4294967296; // uint32 max + 1
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
  /** Modifier-space contribution from equipped gear's stat mods, ≥ 0. Already
   *  included in `total`; surfaced so a client can label a "+N gear" term. */
  gearBonus: number;
}

/**
 * A consumable's effect on the next roll (Act IV). Every kind is UPSIDE-ONLY —
 * it can only raise the d20 or the total, never lower them, so a boost can only
 * improve the band. Applied deterministically from the seed (see resolveCheck)
 * so the roll stays stable and cannot be re-rolled by refetching.
 */
export type RollBoost =
  | { kind: "bonus"; amount: number }   // flat + to the total
  | { kind: "advantage" }               // roll twice, keep the higher die
  | { kind: "reroll" };                 // if the die is low, reroll and keep the better

/** A roll at or below this face is "low" enough for a Second Wind reroll. */
export const REROLL_THRESHOLD = 10;

/**
 * Resolve a check. A natural 20 is always a crit (rare, exciting, no DC math)
 * and a natural 1 is always the lowest band (classic auto-miss); otherwise
 * total ≥ DC is a success, a near miss (within PARTIAL_MARGIN of the DC) is a
 * "partial", and a wide miss is a "fail". Crucially, EVERY band still completes
 * the quest in full — "fail" is the roadmap's "fail-with-consequence" reframed
 * to the anti-shame law: the consequence is that we offer help, never a loss.
 *
 * An optional `boost` (a spent consumable) only ever helps: advantage/reroll
 * take the HIGHER of two seeded dice, and bonus adds to the total. All seed-
 * derived, so the result is still deterministic and un-rerollable.
 *
 * An optional `restedBonus` (Act IV "Well-Rested", earned by keeping a good
 * run) is a further flat, non-negative addition to the total. It composes with
 * any consumable boost and, like everything here, can only raise the band.
 */
export function resolveCheck(args: {
  seed: string;
  modifier: number;
  proficiency: number;
  dc: number;
  ability: AbilityId;
  boost?: RollBoost;
  restedBonus?: number;
  gearBonus?: number;
}): SkillCheck {
  let d20 = rollD20(args.seed);
  if (args.boost?.kind === "advantage") {
    d20 = Math.max(d20, rollD20(args.seed + ":adv"));
  } else if (args.boost?.kind === "reroll" && d20 <= REROLL_THRESHOLD) {
    d20 = Math.max(d20, rollD20(args.seed + ":rr"));
  }
  // All upside channels are additive and clamped non-negative, so a boost, a
  // Well-Rested bonus, or equipped gear can only ever raise the total.
  const boostBonus = args.boost?.kind === "bonus" ? args.boost.amount : 0;
  const gearBonus = Math.max(0, args.gearBonus ?? 0);
  const bonus = Math.max(0, boostBonus) + Math.max(0, args.restedBonus ?? 0) + gearBonus;
  const total = d20 + args.modifier + args.proficiency + bonus;
  const band: CheckBand =
    d20 === 20 ? "crit"
    : d20 === 1 ? "fail"
    : total >= args.dc ? "success"
    : args.dc - total <= PARTIAL_MARGIN ? "partial"
    : "fail";
  return {
    d20,
    modifier: args.modifier,
    proficiency: args.proficiency,
    total,
    dc: args.dc,
    band,
    ability: args.ability,
    gearBonus,
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
  boost?: RollBoost;
  restedBonus?: number;
  gearBonus?: number;
}): SkillCheck {
  const ability = abilityForKingdom(kingdomForCategory(args.category));
  return resolveCheck({
    seed: args.seed,
    modifier: modifierForAbility(args.abilities, ability),
    proficiency: args.proficiency,
    dc: dcForDifficulty(args.difficulty),
    ability,
    boost: args.boost,
    restedBonus: args.restedBonus,
    gearBonus: args.gearBonus,
  });
}

export interface BandEffect {
  band: CheckBand;
  /** A bonus surprise/loot roll ON TOP of the quest's normal reward. Crit only. */
  bonusLoot: boolean;
  /** Flat bonus coins on top of the normal award. Crit only; never negative. */
  bonusCoins: number;
  /** Fail only: surface the supportive rescue pathway (offer a gentler next
   *  step / breakdown). This is the ONLY consequence of a fail — an offer of
   *  help, never a penalty, debuff, or auto-recorded rescue_events row. */
  offerRescue: boolean;
}

/**
 * The reward delta for a band — always ≥ 0, and no field can lower the base
 * reward: success and partial are neutral (the quest's own XP is untouched),
 * only a crit adds anything, and a fail's `offerRescue` is upside (help), not a
 * cost. This is the anti-shame contract in code.
 */
export function bandEffect(band: CheckBand): BandEffect {
  if (band === "crit") return { band, bonusLoot: true, bonusCoins: CRIT_BONUS_COINS, offerRescue: false };
  if (band === "fail") return { band, bonusLoot: false, bonusCoins: 0, offerRescue: true };
  return { band, bonusLoot: false, bonusCoins: 0, offerRescue: false };
}

/**
 * Anti-shame narration for a band. Always quotes the quest title; never says
 * "fail"/"failed" and never blames. A partial reframes toward a smaller next
 * step; a fail affirms the quest still counts in full and OFFERS a gentler
 * opening — the rescue pathway — rather than reading as a loss.
 */
export function bandNarration(band: CheckBand, questTitle: string): string {
  switch (band) {
    case "crit":
      return `Critical hit — "${questTitle}" done with flair.`;
    case "success":
      return `"${questTitle}" cleared.`;
    case "partial":
      return `"${questTitle}" is done. A glancing pass — a smaller next step will land clean.`;
    case "fail":
      return `"${questTitle}" is done — it counts in full. That one fought back; want to break the next into a smaller opening?`;
  }
}
