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
