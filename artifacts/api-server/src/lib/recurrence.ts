/**
 * Pure recurrence math for recurring-quest templates.
 *
 * No DB, no clock, no I/O — a rule plus a `YYYY-MM-DD` date key in, an answer
 * out. Every calendar edge case (short months, leap years, "last Saturday")
 * lives here so the spawner has exactly one predicate to consult.
 *
 * All date arithmetic runs on UTC anchors of the date key, the same trick
 * `buildDayDates` uses in date-buckets.ts: the keys are already local calendar
 * dates for their owner, so a DST transition must not be able to shift one.
 *
 * Malformed rules (nulls where the mode requires values) yield "no occurrence"
 * rather than throwing. One bad template must never break a shared tick for
 * every other user.
 */

export type Frequency = "weekly" | "monthly" | "yearly";
export type MonthlyMode = "day_of_month" | "nth_weekday";

export interface RecurrenceRule {
  frequency: Frequency;
  /** Weekly: the set of weekdays. nth_weekday: the single weekday of the rule. */
  daysOfWeek: number[];
  monthlyMode: MonthlyMode | null;
  dayOfMonth: number | null;
  /** 1–4, or -1 meaning "last". Never 5 — most months don't have a 5th. */
  weekOfMonth: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
}

const DAY_MS = 86_400_000;

function toUtc(dateKey: string): Date {
  return new Date(dateKey + "T00:00:00Z");
}

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shift a `YYYY-MM-DD` key by whole days. */
export function addDays(dateKey: string, days: number): string {
  return toKey(new Date(toUtc(dateKey).getTime() + days * DAY_MS));
}

/** Number of days in `month` (1-based) of `year`. Day 0 of the next month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inRange(rule: RecurrenceRule, dateKey: string): boolean {
  if (dateKey < rule.startDate) return false;
  if (rule.endDate && dateKey > rule.endDate) return false;
  return true;
}

/** The day of the month this rule targets in the given month, or null. */
function targetDay(rule: RecurrenceRule, year: number, month: number): number | null {
  const dim = daysInMonth(year, month);

  if (rule.monthlyMode === "day_of_month") {
    const wanted = rule.dayOfMonth;
    if (wanted == null || wanted < 1 || wanted > 31) return null;
    // Clamp rather than skip: a quest that silently vanishes in February
    // reads as the user's fault (spec D5).
    return Math.min(wanted, dim);
  }

  if (rule.monthlyMode === "nth_weekday") {
    const weekday = rule.daysOfWeek[0];
    const n = rule.weekOfMonth;
    if (weekday == null || weekday < 0 || weekday > 6) return null;
    if (n == null || (n !== -1 && (n < 1 || n > 4))) return null;

    if (n === -1) {
      const lastDow = new Date(Date.UTC(year, month - 1, dim)).getUTCDay();
      return dim - ((lastDow - weekday + 7) % 7);
    }

    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
    // The 4th of any weekday always fits (max 1+6+21 = 28 ≤ 28), but guard
    // anyway so a bad stored ordinal can only mean "no occurrence".
    return day <= dim ? day : null;
  }

  return null;
}

export function occursOn(rule: RecurrenceRule, dateKey: string): boolean {
  if (!inRange(rule, dateKey)) return false;

  const d = toUtc(dateKey);
  if (Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  if (rule.frequency === "weekly") {
    if (rule.daysOfWeek.length === 0) return false;
    return rule.daysOfWeek.includes(d.getUTCDay());
  }

  if (rule.monthlyMode == null) return false;

  if (rule.frequency === "yearly") {
    if (rule.monthOfYear == null || rule.monthOfYear < 1 || rule.monthOfYear > 12) return false;
    if (month !== rule.monthOfYear) return false;
  }

  const target = targetDay(rule, year, month);
  if (target == null) return false;
  return day === target;
}

/**
 * Hard ceiling on window iteration. `lead_days` is validated to 0–60 at the
 * API boundary, so a legitimate window is at most 61 days; this only bounds
 * the damage from a corrupt row.
 */
const MAX_WINDOW_DAYS = 400;

/** Every occurrence in `[from, to]` inclusive, oldest first. */
export function occurrencesInWindow(rule: RecurrenceRule, from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  for (let i = 0; i < MAX_WINDOW_DAYS && cursor <= to; i++) {
    if (occursOn(rule, cursor)) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/**
 * The cadence period a date belongs to. Streaks count consecutive periods, so
 * "completed the monthly quest" means "landed in this month", not "landed on
 * this day" — which is what lets a couple of days late still count.
 */
export function cadencePeriodKey(frequency: Frequency, dateKey: string): string {
  if (frequency === "monthly") return dateKey.slice(0, 7);
  if (frequency === "yearly") return dateKey.slice(0, 4);
  return dateKey;
}

/** The period immediately preceding `periodKey` at the same cadence. */
export function previousPeriodKey(frequency: Frequency, periodKey: string): string {
  if (frequency === "monthly") {
    const year = Number(periodKey.slice(0, 4));
    const month = Number(periodKey.slice(5, 7));
    const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    return `${prev.y}-${String(prev.m).padStart(2, "0")}`;
  }
  if (frequency === "yearly") return String(Number(periodKey) - 1);
  return addDays(periodKey, -1);
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function describeWeekly(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const key = sorted.join(",");
  if (key === "0,1,2,3,4,5,6") return "Every day";
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

/**
 * The one place the schedule is put into words. Served to the client as
 * `scheduleLabel` so server and client can never phrase the same rule
 * differently.
 */
export function describeRule(rule: RecurrenceRule): string {
  const NONE = "No schedule set";

  if (rule.frequency === "weekly") {
    return rule.daysOfWeek.length === 0 ? NONE : describeWeekly(rule.daysOfWeek);
  }

  const yearly = rule.frequency === "yearly";
  if (yearly && (rule.monthOfYear == null || rule.monthOfYear < 1 || rule.monthOfYear > 12)) return NONE;
  const monthName = yearly ? MONTH_LONG[rule.monthOfYear! - 1] : null;

  if (rule.monthlyMode === "day_of_month") {
    const day = rule.dayOfMonth;
    if (day == null || day < 1 || day > 31) return NONE;
    return yearly ? `Every ${monthName} ${day}` : `The ${ordinal(day)} of every month`;
  }

  if (rule.monthlyMode === "nth_weekday") {
    const weekday = rule.daysOfWeek[0];
    const n = rule.weekOfMonth;
    if (weekday == null || weekday < 0 || weekday > 6) return NONE;
    if (n == null || (n !== -1 && (n < 1 || n > 4))) return NONE;
    const which = n === -1 ? "last" : ordinal(n);
    const dayName = WEEKDAY_LONG[weekday];
    return yearly
      ? `The ${which} ${dayName} of every ${monthName}`
      : `The ${which} ${dayName} of every month`;
  }

  return NONE;
}
