// The Campaign — second wave (Loot Tables & Treasure Reveals).
//
// On an encounter fell the player already gets coins (see routes/encounter.ts).
// This adds a SEEDED drop-table roll on top: it may award a gear item whose
// rarity scales with the foe's tier, or — when nothing gear drops — a few bonus
// coins so every fell still feels rewarded.
//
// INVARIANT (anti-shame + upside-only): a roll can only ADD. It never touches
// the base felled coins, never removes owned gear, and a null-rarity result is a
// valid, non-negative "small find" — never "no loot / you failed". `bonusCoins`
// is always ≥ 0. The tests pin this down.
//
// Determinism: the roll is seeded from stable inputs (user + encounter + tier),
// so it resolves identically on every client and in tests and cannot be
// re-rolled by refetching — the server rolls, clients reveal.
import type { GearRarity } from "@workspace/db";
import { seededUnit } from "./roll-engine";

export interface LootResult {
  /** The gear rarity that dropped, or null for a coins-only "small find". */
  rarity: GearRarity | null;
  /** Extra coins granted when no gear drops (0 when gear drops). Always ≥ 0. */
  bonusCoins: number;
}

/** Probability of each rarity being the drop. The remainder (1 − their sum) is
 *  the "nothing-extra → bonus coins" slice. Ordered best → worst. */
interface DropOdds {
  legendary: number;
  epic: number;
  rare: number;
  common: number;
}

/** Coins a coins-only fell adds on top of the base felled coins — a small,
 *  guaranteed find so a no-gear roll never reads as nothing. */
export const LOOT_BONUS_COINS = 3;

/**
 * Drop odds by encounter tier. Higher tiers shift the odds toward better gear;
 * the cumulative odds of "at least rare" are non-decreasing in tier (tested).
 * Each row's rarity odds sum to ≤ 1; the leftover is the bonus-coins slice.
 */
export function oddsForTier(tier: number): DropOdds {
  if (tier >= 7) return { legendary: 0.06, epic: 0.18, rare: 0.36, common: 0.32 };
  if (tier >= 5) return { legendary: 0.03, epic: 0.12, rare: 0.30, common: 0.40 };
  if (tier >= 3) return { legendary: 0.01, epic: 0.06, rare: 0.22, common: 0.46 };
  return /* 1–2 */  { legendary: 0.00, epic: 0.02, rare: 0.12, common: 0.46 };
}

/** Stable seed for a fell's loot roll — user + encounter + tier, so it is fair,
 *  deterministic, and un-rerollable by refetching. */
export function lootSeed(userId: number, encounterId: number, tier: number): string {
  return `loot:${userId}:${encounterId}:${tier}`;
}

/**
 * Resolve a fell's loot. Walks the rarities best → worst against a seeded
 * uniform draw; if none hits, returns a coins-only "small find". Pure.
 */
export function rollLoot(args: { tier: number; seed: string }): LootResult {
  const o = oddsForTier(args.tier);
  const draw = seededUnit(args.seed);
  let cum = o.legendary;
  if (draw < cum) return { rarity: "legendary", bonusCoins: 0 };
  cum += o.epic;
  if (draw < cum) return { rarity: "epic", bonusCoins: 0 };
  cum += o.rare;
  if (draw < cum) return { rarity: "rare", bonusCoins: 0 };
  cum += o.common;
  if (draw < cum) return { rarity: "common", bonusCoins: 0 };
  return { rarity: null, bonusCoins: LOOT_BONUS_COINS };
}
