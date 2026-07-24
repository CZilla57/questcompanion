export type Frequency = "weekly" | "monthly" | "yearly";
export type MonthlyMode = "day_of_month" | "nth_weekday";

export interface RecurrenceFormFields {
  frequency: Frequency;
  daysOfWeek: number[];
  monthlyMode: MonthlyMode;
  dayOfMonth: number;
  weekOfMonth: number;
  monthOfYear: number;
  leadDays: number;
}

export interface RecurrencePayload {
  frequency: Frequency;
  daysOfWeek: number[];
  monthlyMode: MonthlyMode | null;
  dayOfMonth: number | null;
  weekOfMonth: number | null;
  monthOfYear: number | null;
  leadDays: number;
}

/**
 * A starting suggestion, not a rule: a yearly quest with no runway is nearly
 * useless, but the user owns the field and can set anything 0–60.
 */
export function defaultLeadDays(frequency: Frequency): number {
  if (frequency === "monthly") return 3;
  if (frequency === "yearly") return 14;
  return 0;
}

/**
 * nth_weekday needs exactly one weekday; an empty selection cannot be shown
 * honestly by a single-select, so seed Monday rather than display a lie.
 */
export function ensureWeekdayForMode(daysOfWeek: number[], monthlyMode: MonthlyMode): number[] {
  if (monthlyMode === "nth_weekday" && daysOfWeek.length === 0) return [1];
  return daysOfWeek;
}

/**
 * Send only the fields the chosen rule actually uses. The form keeps every
 * control populated so switching cadence back and forth doesn't lose the
 * user's earlier answers — this is where the unused ones get dropped.
 */
export function toRecurrencePayload(form: RecurrenceFormFields): RecurrencePayload {
  if (form.frequency === "weekly") {
    return {
      frequency: "weekly",
      daysOfWeek: form.daysOfWeek,
      monthlyMode: null,
      dayOfMonth: null,
      weekOfMonth: null,
      monthOfYear: null,
      leadDays: form.leadDays,
    };
  }

  const byWeekday = form.monthlyMode === "nth_weekday";
  return {
    frequency: form.frequency,
    // nth_weekday carries exactly one weekday.
    daysOfWeek: byWeekday ? form.daysOfWeek.slice(0, 1) : [],
    monthlyMode: form.monthlyMode,
    dayOfMonth: byWeekday ? null : form.dayOfMonth,
    weekOfMonth: byWeekday ? form.weekOfMonth : null,
    monthOfYear: form.frequency === "yearly" ? form.monthOfYear : null,
    leadDays: form.leadDays,
  };
}
