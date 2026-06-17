export interface MultiplierInfo {
  multiplier: number;
  label: string;
  tier: "none" | "warming" | "focused" | "driven" | "elite";
}

const TIERS: { minStreak: number; multiplier: number; label: string; tier: MultiplierInfo["tier"] }[] = [
  { minStreak: 30, multiplier: 1.15, label: "+15% Elite Momentum", tier: "elite" },
  { minStreak: 21, multiplier: 1.10, label: "+10% Driven",         tier: "driven" },
  { minStreak: 14, multiplier: 1.08, label: "+8% Focused",         tier: "focused" },
  { minStreak:  7, multiplier: 1.05, label: "+5% Warming Up",      tier: "warming" },
  { minStreak:  0, multiplier: 1.00, label: "",                     tier: "none" },
];

/** Returns the streak-based XP multiplier for a user's current streak length. */
export function getStreakMultiplier(streakDays: number): MultiplierInfo {
  for (const tier of TIERS) {
    if (streakDays >= tier.minStreak) {
      return { multiplier: tier.multiplier, label: tier.label, tier: tier.tier };
    }
  }
  return { multiplier: 1.0, label: "", tier: "none" };
}

/** Returns the bonus XP earned from the streak multiplier (rounded to nearest integer). */
export function applyMultiplier(basePoints: number, streakDays: number): {
  totalPoints: number;
  streakBonus: number;
  multiplierInfo: MultiplierInfo;
} {
  const info = getStreakMultiplier(streakDays);
  const total = Math.round(basePoints * info.multiplier);
  return {
    totalPoints: total,
    streakBonus: total - basePoints,
    multiplierInfo: info,
  };
}
