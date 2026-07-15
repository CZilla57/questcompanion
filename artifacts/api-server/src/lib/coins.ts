import type { RewardTier } from "@workspace/db";

export type { RewardTier };

// Flat coin earns per meaningful action. Tunable — the earn/price ratio is the
// economy's main knob (Small reachable in ~a day; Treat a genuine save-up).
export const COIN_EARN = {
  questComplete:     5,
  focusSession:      10,
  streakMilestone:   25,
  questlineComplete: 30,
  bossWin:           50,
} as const;

const TIER_COST: Record<RewardTier, number> = {
  small:  20,
  medium: 60,
  large:  150,
  treat:  400,
};

export function tierCost(tier: RewardTier): number {
  return TIER_COST[tier];
}

export function isValidTier(value: string): value is RewardTier {
  return value === "small" || value === "medium" || value === "large" || value === "treat";
}

export interface RedeemDecision {
  affordable: boolean;
  remaining: number;
}

export function redeemDecision(balance: number, cost: number): RedeemDecision {
  return { affordable: balance >= cost, remaining: Math.max(0, cost - balance) };
}

// A streak "milestone" — the same definition the completion flow already uses to
// celebrate streaks (days 3, 7, 14, 30, then every 30). Extracted here so both
// the coin award and the activity/gear grant share one source of truth.
export function isStreakMilestone(newStreak: number, oldStreak: number): boolean {
  return (
    newStreak > oldStreak &&
    (newStreak === 3 || newStreak === 7 || newStreak === 14 || newStreak === 30 || newStreak % 30 === 0)
  );
}

// How many coins to actually remove when reversing an award: never more than the
// user holds, never negative. Keeps the balance non-negative and the ledger consistent.
export function coinsToReverse(requested: number, balance: number): number {
  return Math.max(0, Math.min(requested, balance));
}
