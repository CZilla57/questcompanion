// Living Companion: a reactive layer over hero-care. Like hunger, the companion's
// "beat" is derived at read time and never stored. The only persisted state is the
// monotonic bond (users.bondQuestsCompleted) and a streak-push dedup marker.

export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 50, 100, 200, 365];

// Gap (in whole local days since last active) that reads as an honored rest vs a
// return-from-absence. gap 1–2 ⇒ rest_day; gap ≥ ABSENCE_MIN_DAYS ⇒ welcome_back.
export const ABSENCE_MIN_DAYS = 3;

export type BondTierInfo = { tier: number; name: string; minQuests: number };

const BOND_TIERS: BondTierInfo[] = [
  { tier: 4, name: "Legendary Bond", minQuests: 400 },
  { tier: 3, name: "Kindred", minQuests: 150 },
  { tier: 2, name: "Steadfast", minQuests: 50 },
  { tier: 1, name: "Trusted", minQuests: 10 },
  { tier: 0, name: "Newly Met", minQuests: 0 },
];

export function bondTier(bondQuestsCompleted: number): BondTierInfo {
  for (const t of BOND_TIERS) {
    if (bondQuestsCompleted >= t.minQuests) return t;
  }
  return BOND_TIERS[BOND_TIERS.length - 1]!;
}

/**
 * Whole-day difference (toDateKey - fromDateKey) between two YYYY-MM-DD keys, using
 * a UTC anchor of each local date so DST can't shift the count (same technique as
 * date-buckets.buildDayDates). Null when the user has never been active.
 */
export function dayGap(fromDateKey: string | null, toDateKey: string): number | null {
  if (!fromDateKey) return null;
  const from = new Date(fromDateKey + "T00:00:00Z").getTime();
  const to = new Date(toDateKey + "T00:00:00Z").getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

import type { HungerStage } from "./hero-care";

export type CompanionBeatKind = "welcome_back" | "streak_milestone" | "rest_day" | "ambient" | "quiet";

export type CompanionBeat = { kind: CompanionBeatKind; streakDays: number; bondTier: number };

/**
 * The single most-salient relational beat, derived from current state.
 * Precedence: welcome_back → streak_milestone → rest_day → ambient. `ambient`
 * yields to hunger (→ `quiet`, companion says nothing) when the hero is
 * starving/fainted; welcome_back/milestone/rest are never hunger-gated.
 */
export function deriveCompanionBeat(ctx: {
  streakDays: number;
  dayGap: number | null;
  hungerStage: HungerStage;
  bondTier: number;
}): CompanionBeat {
  const carry = { streakDays: ctx.streakDays, bondTier: ctx.bondTier };
  if (ctx.dayGap !== null && ctx.dayGap >= ABSENCE_MIN_DAYS) {
    return { kind: "welcome_back", ...carry };
  }
  if (STREAK_MILESTONES.includes(ctx.streakDays)) {
    return { kind: "streak_milestone", ...carry };
  }
  if (ctx.dayGap !== null && ctx.dayGap >= 1 && ctx.dayGap < ABSENCE_MIN_DAYS) {
    return { kind: "rest_day", ...carry };
  }
  if (ctx.hungerStage === "starving" || ctx.hungerStage === "fainted") {
    return { kind: "quiet", ...carry };
  }
  return { kind: "ambient", ...carry };
}
