import { previousLocalWeek } from "./weekly-recap";
import { localDayStartUtc } from "./date-buckets";

export interface Window { start: Date; end: Date } // [start, end)

export interface ComparisonWindows {
  weekStartDateKey: string; // this local Monday, YYYY-MM-DD
  current: Window;   // this local Mon 00:00 → now
  samePoint: Window; // prev Mon 00:00 → prev Mon + elapsed-so-far
  lastWeek: Window;  // prev Mon 00:00 → this Mon 00:00 (the closed week)
}

/** The three honest windows for "You vs. last week": like-for-like pace
 * (same elapsed time into each week) plus the closed week's total. Elapsed
 * time mirrors in real milliseconds, so across a DST shift the same-point
 * cutoff can skew by ≤1h — the recap system's accepted grade of tz tradeoff.
 * previousLocalWeek's endDateKeyExclusive IS this week's Monday. */
export function comparisonWindows(now: Date, tz: string): ComparisonWindows {
  const week = previousLocalWeek(now, tz);
  const prevStart = localDayStartUtc(week.startDateKey, tz);
  const thisStart = localDayStartUtc(week.endDateKeyExclusive, tz);
  const elapsed = Math.max(0, now.getTime() - thisStart.getTime());
  const samePointEnd = new Date(Math.min(prevStart.getTime() + elapsed, thisStart.getTime()));
  return {
    weekStartDateKey: week.endDateKeyExclusive,
    current: { start: thisStart, end: now },
    samePoint: { start: prevStart, end: samePointEnd },
    lastWeek: { start: prevStart, end: thisStart },
  };
}
