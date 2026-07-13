/**
 * Milestones are not tracked separately — they are the celebratable subset of
 * the existing `activity` feed. This module names that subset and decides
 * whether an ally has a "fresh" milestone worth cheering.
 */

export const MILESTONE_TYPES = [
  "level_up",
  "badge_earned",
  "streak_milestone",
  "all_day_bonus",
  "questline_complete",
] as const;

export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export function isMilestoneType(t: string): boolean {
  return (MILESTONE_TYPES as readonly string[]).includes(t);
}

export interface ActivityLike {
  type: string;
  createdAt: Date;
}

/**
 * True when any milestone-typed row falls within `windowHours` before `now`.
 */
export function hasFreshMilestone(
  rows: ActivityLike[],
  now: Date,
  windowHours: number,
): boolean {
  const cutoff = now.getTime() - windowHours * 60 * 60 * 1000;
  return rows.some(
    (r) => isMilestoneType(r.type) && r.createdAt.getTime() >= cutoff,
  );
}
