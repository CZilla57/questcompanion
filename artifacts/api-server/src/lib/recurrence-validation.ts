import type { Frequency } from "./recurrence";
import { MAX_LEAD_DAYS } from "./spawn-window";

export interface RecurrenceInput {
  frequency?: string;
  daysOfWeek?: number[];
  monthlyMode?: string;
  dayOfMonth?: number;
  weekOfMonth?: number;
  monthOfYear?: number;
  leadDays?: number;
}

export type StreakUnit = "day" | "month" | "year";

export function streakUnitFor(frequency: Frequency): StreakUnit {
  if (frequency === "monthly") return "month";
  if (frequency === "yearly") return "year";
  return "day";
}

/** The shape of a recurring-task row as read from storage, in the form
 *  `mergeRecurrenceUpdate` needs it: nullable columns as `null` (never
 *  `undefined`), `daysOfWeek` already parsed into numbers. */
export interface StoredRecurrence {
  frequency: string;
  daysOfWeek: number[];
  monthlyMode: string | null;
  dayOfMonth: number | null;
  weekOfMonth: number | null;
  monthOfYear: number | null;
  leadDays: number;
}

/**
 * Merge a PATCH body over the stored row using PRESENCE semantics, so the
 * rule that gets validated is byte-for-byte the rule that gets written.
 *
 * A key PRESENT in `body` wins even when its value is `null` (mapped to
 * `undefined` here, since `RecurrenceInput` uses `undefined` for "no value").
 * A key ABSENT from `body` falls back to the stored row.
 */
export function mergeRecurrenceUpdate(
  existing: StoredRecurrence,
  body: Record<string, unknown>,
): RecurrenceInput {
  const presentOrExisting = <T,>(key: string, existingValue: T | null): T | undefined => {
    if (key in body) {
      const value = body[key];
      return (value ?? undefined) as T | undefined;
    }
    return existingValue ?? undefined;
  };

  return {
    frequency: (body.frequency as string | undefined) ?? existing.frequency,
    daysOfWeek: (body.daysOfWeek as number[] | undefined) ?? existing.daysOfWeek,
    monthlyMode: presentOrExisting<string>("monthlyMode", existing.monthlyMode),
    dayOfMonth: presentOrExisting<number>("dayOfMonth", existing.dayOfMonth),
    weekOfMonth: presentOrExisting<number>("weekOfMonth", existing.weekOfMonth),
    monthOfYear: presentOrExisting<number>("monthOfYear", existing.monthOfYear),
    leadDays: (body.leadDays as number | undefined) ?? existing.leadDays,
  };
}

/**
 * Check that a submitted rule is coherent. Returns the message to send with a
 * 400, or null when the rule is fine.
 *
 * Messages name what is missing and how to supply it. They never imply the
 * user did something wrong — a form that scolds is a form people avoid.
 */
export function validateRecurrenceInput(input: RecurrenceInput): string | null {
  const frequency = input.frequency ?? "weekly";
  if (frequency !== "weekly" && frequency !== "monthly" && frequency !== "yearly") {
    return "Frequency must be weekly, monthly, or yearly.";
  }

  const lead = input.leadDays;
  if (lead != null && (!Number.isInteger(lead) || lead < 0 || lead > MAX_LEAD_DAYS)) {
    return `Lead time must be between 0 and ${MAX_LEAD_DAYS} days.`;
  }

  const days = input.daysOfWeek ?? [];
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return "Days of the week must be 0 (Sunday) through 6 (Saturday).";
  }

  // Bounds-check every mode-specific field whenever it's supplied, even when
  // the active mode/frequency doesn't currently need it. A dormant
  // out-of-range value written today (e.g. dayOfMonth on an nth_weekday rule)
  // goes live the moment a later PATCH switches modes.
  const d = input.dayOfMonth;
  if (d != null && (!Number.isInteger(d) || d < 1 || d > 31)) {
    return "Day of the month must be between 1 and 31.";
  }

  const n = input.weekOfMonth;
  if (n != null && n !== -1 && (!Number.isInteger(n) || n < 1 || n > 4)) {
    return "Pick the 1st, 2nd, 3rd, 4th, or last week of the month.";
  }

  const m = input.monthOfYear;
  if (m != null && (!Number.isInteger(m) || m < 1 || m > 12)) {
    return "Pick a month for this yearly schedule.";
  }

  if (frequency === "weekly") {
    if (days.length === 0) return "Pick at least one day of the week.";
    return null;
  }

  if (frequency === "yearly") {
    if (m == null) {
      return "Pick a month for this yearly schedule.";
    }
  }

  const mode = input.monthlyMode;
  if (mode !== "day_of_month" && mode !== "nth_weekday") {
    return "Pick how the month is anchored: a day of the month, or a weekday.";
  }

  if (mode === "day_of_month") {
    if (d == null) {
      return "Day of the month must be between 1 and 31.";
    }
    return null;
  }

  if (n == null) {
    return "Pick the 1st, 2nd, 3rd, 4th, or last week of the month.";
  }
  if (days.length === 0) return "Pick a weekday for this monthly schedule.";
  // The engine and describeRule both read daysOfWeek[0] — a second weekday
  // wouldn't be rejected, just silently ignored, and the stored row would
  // lie about itself.
  if (days.length > 1) return "Pick exactly one weekday for this monthly schedule.";
  return null;
}
