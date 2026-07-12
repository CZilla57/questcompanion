import { addDays, format, parseISO, startOfToday } from "date-fns";

/**
 * Due dates are stored as plain `yyyy-MM-dd` strings and must be treated in the
 * user's LOCAL time. `parseISO` parses a date-only string to local midnight;
 * `format` writes local calendar days. Going through these avoids the UTC
 * off-by-one that `new Date('yyyy-MM-dd')` produces in negative-offset zones.
 */

/** Parse a `yyyy-MM-dd` due-date string to a local-midnight Date. */
export function parseDueDate(s: string): Date {
  return parseISO(s);
}

/** Format a Date to the `yyyy-MM-dd` string the API stores. */
export function toDueDateString(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Local today as a `yyyy-MM-dd` string. */
export function todayDueDate(): string {
  return toDueDateString(startOfToday());
}

/** Local tomorrow as a `yyyy-MM-dd` string. */
export function tomorrowDueDate(): string {
  return toDueDateString(addDays(startOfToday(), 1));
}

/** One week from local today as a `yyyy-MM-dd` string. */
export function nextWeekDueDate(): string {
  return toDueDateString(addDays(startOfToday(), 7));
}
