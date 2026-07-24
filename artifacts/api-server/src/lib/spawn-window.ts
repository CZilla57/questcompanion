import { addDays, type Frequency, type MonthlyMode, type RecurrenceRule } from "./recurrence";
import { resolveTimeZone, localDateKey } from "./date-buckets";

/** Upper bound on lead time, mirroring the API validation in routes. */
export const MAX_LEAD_DAYS = 60;

/** The columns of a recurring_tasks row that describe its schedule. */
export interface RecurringTaskRow {
  daysOfWeek: string;
  frequency: string;
  monthlyMode: string | null;
  dayOfMonth: number | null;
  weekOfMonth: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
}

/**
 * The date range the spawner should evaluate for one template, in the owner's
 * own calendar. `leadDays: 0` gives a single day — which is exactly the
 * pre-cadence behavior, now local rather than UTC.
 */
export function spawnWindow(
  now: Date,
  timezone: string | null,
  leadDays: number,
): { from: string; to: string } {
  const from = localDateKey(now, resolveTimeZone(timezone));
  const lead = Math.min(Math.max(Number.isFinite(leadDays) ? leadDays : 0, 0), MAX_LEAD_DAYS);
  return { from, to: addDays(from, lead) };
}

const FREQUENCIES = new Set<Frequency>(["weekly", "monthly", "yearly"]);
const MODES = new Set<MonthlyMode>(["day_of_month", "nth_weekday"]);

function parseDays(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 0 && n <= 6);
}

/** Turn a stored template row into a rule the pure engine can evaluate. */
export function ruleFromTemplate(t: RecurringTaskRow): RecurrenceRule {
  const frequency = FREQUENCIES.has(t.frequency as Frequency)
    ? (t.frequency as Frequency)
    : "weekly";
  const monthlyMode = t.monthlyMode && MODES.has(t.monthlyMode as MonthlyMode)
    ? (t.monthlyMode as MonthlyMode)
    : null;

  return {
    frequency,
    daysOfWeek: parseDays(t.daysOfWeek),
    monthlyMode,
    dayOfMonth: t.dayOfMonth,
    weekOfMonth: t.weekOfMonth,
    monthOfYear: t.monthOfYear,
    startDate: t.startDate,
    endDate: t.endDate,
  };
}
