// Act IV — Dopamine Matching (Mystery Box). A coin-gated pull from the user's
// Dopamine Menu with an upside-only variable bonus. Pure decision logic; the
// route (mystery-box.ts) wires these into the coin economy. See the design spec.

// Fixed pull cost. Deliberately below the smallest Store tier (20) so it reads
// as the light, frequent spend. Tunable — the earn/cost/bonus ratio is the knob.
export const MYSTERY_COST = 15;

// Upside-only variable bonus, rolled per pull. Each tier is [minRoll, bonus):
// the first entry whose minRoll a roll clears (scanning high→low) wins. Expected
// value sits well below MYSTERY_COST, and the top bonus is capped at the cost, so
// a pull can never net a coin gain — the box stays a genuine sink with occasional
// delight, never a gamble with a downside.
export const MYSTERY_BONUS_TIERS: ReadonlyArray<{ minRoll: number; bonus: number }> = [
  { minRoll: 0.99, bonus: 15 }, // "free pull! 🎉" (net zero — the best case)
  { minRoll: 0.9, bonus: 10 }, // "nice — half back"
  { minRoll: 0.6, bonus: 5 }, // "a few coins back"
];

/** Map a [0,1) roll to its coin bonus (0 on the common low band). */
export function mysteryBonus(roll: number): number {
  for (const tier of MYSTERY_BONUS_TIERS) {
    if (roll >= tier.minRoll) return tier.bonus;
  }
  return 0;
}

export type MysteryGateReason = "ok" | "no_rewards" | "insufficient";

export interface MysteryGate {
  canOpen: boolean;
  reason: MysteryGateReason;
  remaining: number; // coins still needed (0 unless insufficient)
}

/**
 * Whether the user can open a box right now. An empty menu is reported before an
 * insufficient balance — there's nothing to pull regardless of coins. Both are
 * gentle, non-error outcomes the route and the card share.
 */
export function canOpenMystery(balance: number, rewardCount: number): MysteryGate {
  if (rewardCount <= 0) return { canOpen: false, reason: "no_rewards", remaining: 0 };
  if (balance < MYSTERY_COST) {
    return { canOpen: false, reason: "insufficient", remaining: MYSTERY_COST - balance };
  }
  return { canOpen: true, reason: "ok", remaining: 0 };
}

export interface MysteryPull {
  rewardIndex: number;
  bonus: number;
}

/**
 * Resolve a pull. Pure given an injected rng: the first draw picks a uniform
 * reward index in [0, rewardCount), the second rolls the bonus. The route passes
 * Math.random; tests pass a deterministic stub.
 */
export function rollMystery(rewardCount: number, rng: () => number): MysteryPull {
  const rewardIndex = Math.floor(rng() * rewardCount);
  const bonus = mysteryBonus(rng());
  return { rewardIndex, bonus };
}
