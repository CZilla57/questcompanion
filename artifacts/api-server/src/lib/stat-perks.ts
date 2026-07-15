import type { CoinReason } from "@workspace/db";

// ─── Tunable economy knobs ──────────────────────────────────────────────────
// Coin-priced Stat Perks (Act IV). All costs/effects/durations live here — the
// earn/price ratio is the only knob. Perks are upside-only: a boost can only add
// XP, a shield can only protect a streak. Nothing here can reduce XP/level/streak.

export const XP_BOOST_COST = 40;
export const XP_BOOST_BONUS = 0.5; // +50% XP on quest completions while active
export const XP_BOOST_HOURS = 12;

export const FOCUS_BOOST_COST = 40;
export const FOCUS_BOOST_BONUS = 0.5; // +50% XP on focus-session earns while active
export const FOCUS_BOOST_HOURS = 12;

export const STREAK_SHIELD_COST = 30;
export const MAX_STREAK_FREEZES = 3; // most freezes a user may hold via coins

export type PerkKind = "xp_boost" | "focus_boost" | "streak_shield";
export type PerkId = PerkKind; // id == kind for v1

export interface PerkDef {
  id: PerkId;
  kind: PerkKind;
  label: string;
  emoji: string;
  description: string;
  coinCost: number;
  reason: CoinReason; // ledger reason recorded on purchase
  durationHours?: number; // boosts only
  bonus?: number; // boosts only
}

export const PERKS: readonly PerkDef[] = [
  {
    id: "xp_boost",
    kind: "xp_boost",
    label: "XP Boost",
    emoji: "⚡",
    description: `+${Math.round(XP_BOOST_BONUS * 100)}% XP from quests for ${XP_BOOST_HOURS}h`,
    coinCost: XP_BOOST_COST,
    reason: "perk_xp_boost",
    durationHours: XP_BOOST_HOURS,
    bonus: XP_BOOST_BONUS,
  },
  {
    id: "focus_boost",
    kind: "focus_boost",
    label: "Focus Boost",
    emoji: "🎯",
    description: `+${Math.round(FOCUS_BOOST_BONUS * 100)}% XP from focus sessions for ${FOCUS_BOOST_HOURS}h`,
    coinCost: FOCUS_BOOST_COST,
    reason: "perk_focus_boost",
    durationHours: FOCUS_BOOST_HOURS,
    bonus: FOCUS_BOOST_BONUS,
  },
  {
    id: "streak_shield",
    kind: "streak_shield",
    label: "Streak Shield",
    emoji: "🛡️",
    description: `Protect your streak on a missed day (hold up to ${MAX_STREAK_FREEZES})`,
    coinCost: STREAK_SHIELD_COST,
    reason: "perk_streak_shield",
  },
] as const;

export function getPerk(id: string): PerkDef | undefined {
  return PERKS.find((p) => p.id === id);
}

export function isValidPerkId(id: string): id is PerkId {
  return PERKS.some((p) => p.id === id);
}

/** A timed boost is active iff its expiry is set and strictly in the future. */
export function isBoostActive(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() > now.getTime();
}

/**
 * Extra XP a boost adds on top of the base reward — purely additive, so it can
 * never lower a payout. `round(base * bonus)` when active, 0 otherwise.
 */
export function boostBonusPoints(basePoints: number, active: boolean, bonus: number): number {
  return active ? Math.round(basePoints * bonus) : 0;
}

/**
 * The new expiry after buying a boost. Stacks from the later of now / the current
 * expiry, so topping up an already-active boost EXTENDS the window and never
 * shortens it (no penalty for buying early).
 */
export function nextBoostExpiry(current: Date | null, now: Date, durationHours: number): Date {
  const base = current !== null && current.getTime() > now.getTime() ? current.getTime() : now.getTime();
  return new Date(base + durationHours * 60 * 60 * 1000);
}

/** Whether the user has room to buy another Streak Shield (holds < the cap). */
export function canBuyStreakShield(currentFreezes: number): boolean {
  return currentFreezes < MAX_STREAK_FREEZES;
}
