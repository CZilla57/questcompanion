/**
 * Pure badge qualification rules.  Deliberately free of database imports so it
 * can be unit-tested in isolation (mirrors `ally-milestones.ts`).
 */

/**
 * The counters a badge's `requirement` can be measured against.  Most map 1:1
 * to a category; `social` fans out across allies / nudges_sent / boss_attacks,
 * which is why awarding keys off the metric rather than the category.
 */
export type BadgeMetric =
  | "tasks_completed" | "total_points" | "streak_days" | "level"
  | "habit_streak" | "allies" | "nudges_sent" | "boss_attacks";

/** A partial snapshot of the user's counters. Absent metrics are not evaluated. */
export type BadgeStats = Partial<Record<BadgeMetric, number>>;

/** The subset of a badge row the evaluator needs. */
export interface BadgeRule {
  id: number;
  metric: string;
  requirement: number;
}

/**
 * Returns the badges the user has newly qualified for.
 *
 * Metrics missing from `stats` are skipped entirely so a caller can pass a
 * narrow snapshot (e.g. only the social counters) without having to load, or
 * risk mis-evaluating, every other counter.
 */
export function qualifyingBadges<T extends BadgeRule>(
  badges: T[],
  stats: BadgeStats,
  ownedIds: Set<number>,
): T[] {
  return badges.filter((badge) => {
    if (ownedIds.has(badge.id)) return false;
    const value = stats[badge.metric as BadgeMetric];
    if (value === undefined) return false;
    return value >= badge.requirement;
  });
}
