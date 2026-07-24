import { cadencePeriodKey, previousPeriodKey, addDays, type Frequency } from "./recurrence";

export interface ExistingStreak {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: string | null;
  lastPeriodKey: string | null;
}

export interface StreakAdvanceInput {
  frequency: Frequency;
  /** The day the user pressed complete, in their local calendar. */
  completionDate: string;
  /** The scheduled occurrence this completion satisfies (the quest's due date). */
  occurrenceDate: string;
  existing: ExistingStreak | null;
}

export type StreakAdvanceResult =
  | { status: "already_counted" }
  | {
      status: "advanced";
      currentStreak: number;
      longestStreak: number;
      /** NULL for weekly — that path keeps comparing calendar days. */
      periodKey: string | null;
    };

/**
 * Decide what a completion does to a streak.
 *
 * Weekly keeps the original calendar-day rule untouched. Monthly and yearly
 * count *periods*, bucketed on the occurrence date rather than the completion
 * date — so a quest due the 31st and finished on the 2nd still lands in the
 * right beat, and being a little late costs nothing.
 */
export function nextStreakState(input: StreakAdvanceInput): StreakAdvanceResult {
  const { frequency, completionDate, occurrenceDate, existing } = input;
  const weekly = frequency === "weekly";
  const periodKey = weekly ? null : cadencePeriodKey(frequency, occurrenceDate);

  if (!existing) {
    return { status: "advanced", currentStreak: 1, longestStreak: 1, periodKey };
  }

  const alreadyCounted = weekly
    ? existing.lastCompletedDate === completionDate
    : existing.lastPeriodKey === periodKey;
  if (alreadyCounted) return { status: "already_counted" };

  const consecutive = weekly
    ? existing.lastCompletedDate === addDays(completionDate, -1)
    : existing.lastPeriodKey != null &&
      existing.lastPeriodKey === previousPeriodKey(frequency, periodKey!);

  const currentStreak = consecutive ? existing.currentStreak + 1 : 1;
  return {
    status: "advanced",
    currentStreak,
    longestStreak: Math.max(existing.longestStreak, currentStreak),
    periodKey,
  };
}
