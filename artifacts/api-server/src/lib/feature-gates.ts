// Act VII Gentle Door (q5): progressive unlock by level. Pure — no I/O.
// Locked features are INVISIBLE client-side (anti-shame law); these keys ride
// GET /users/me/stats as `unlockedFeatures`. Keys mostly equal the client's
// NavGroupKey values (home/quests are always-on and never listed). EXCEPTION
// since Act VI Quest Campaigns: `campaigns` gates a TAB inside the always-on
// quests group, not a nav group of its own — the client maps it explicitly
// rather than by key equality.
import { getLevelInfo } from "./gamification";

export const FEATURE_KEYS = ["focus", "hero", "progress", "allies", "rewards", "campaigns"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_GATES: Record<FeatureKey, number> = {
  focus: 2, hero: 3, progress: 4, allies: 5, rewards: 6, campaigns: 4,
};

export interface GateUser {
  totalPoints: number;
  highestLevel: number;
  unlockAll: boolean;
}

/** Gate level: derived level, floored by the pre-reversal high-water mark so an
 * uncomplete can never close a door the user has seen. */
export function effectiveLevel(u: Pick<GateUser, "totalPoints" | "highestLevel">): number {
  return Math.max(getLevelInfo(u.totalPoints).level, u.highestLevel);
}

export function unlockedFeatures(u: GateUser): FeatureKey[] {
  if (u.unlockAll) return [...FEATURE_KEYS];
  const level = effectiveLevel(u);
  return FEATURE_KEYS.filter((k) => level >= FEATURE_GATES[k]);
}

export function isFeatureUnlocked(u: GateUser, key: FeatureKey): boolean {
  return u.unlockAll || effectiveLevel(u) >= FEATURE_GATES[key];
}

/** Gates crossed by one award, for the level-up dialog's "Unlocked" line.
 * Takes DERIVED levels before/after; the floor is applied here so re-crossing
 * a floored gate is never re-celebrated. Always [] for grandfathered users —
 * congratulating them for "unlocking" a thing they've used for weeks is a lie. */
export function newlyUnlocked(
  u: Pick<GateUser, "unlockAll" | "highestLevel">,
  beforeDerivedLevel: number,
  afterDerivedLevel: number,
): FeatureKey[] {
  if (u.unlockAll) return [];
  const before = Math.max(beforeDerivedLevel, u.highestLevel);
  const after = Math.max(afterDerivedLevel, u.highestLevel);
  return FEATURE_KEYS.filter((k) => FEATURE_GATES[k] > before && FEATURE_GATES[k] <= after);
}
