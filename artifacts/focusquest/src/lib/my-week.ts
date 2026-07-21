import type { MyWeekComparison, MyWeekMetric } from "@workspace/api-client-react";

/** Celebration-only pace framing (anti-shame law): a delta exists only when
 * the user is AHEAD of their own last-week pace. Behind or level returns
 * null — the numbers stand without judgment, no red, no down-arrows. */
export function paceDelta(metric: MyWeekMetric): number | null {
  const delta = metric.current - metric.samePointLastWeek;
  return delta > 0 ? delta : null;
}

/** True when both weeks are all-zero: render the gentle fresh-start line
 * instead of three zero-vs-zero comparisons. */
export function isFreshStart(c: MyWeekComparison): boolean {
  const metrics = [c.quests, c.xp, c.focusMinutes];
  return metrics.every(
    (m) => m.current === 0 && m.samePointLastWeek === 0 && m.lastWeekTotal === 0,
  );
}
