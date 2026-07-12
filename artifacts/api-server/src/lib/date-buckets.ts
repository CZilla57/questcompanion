/**
 * Timezone-aware calendar-day helpers for charting endpoints.
 *
 * The server clock runs in UTC (Render), but users think in their own local
 * calendar days — as does the rest of the app, which derives "today" on the
 * client (e.g. `format(new Date(), "yyyy-MM-dd")`). Bucketing activity by the
 * UTC day therefore shifts XP onto the wrong day and, for users west of UTC in
 * the evening, produces a newest bucket that is their *tomorrow* (future data).
 *
 * These helpers bucket by the caller-supplied IANA timezone instead.
 */

/** Return `tz` if it is a valid IANA timezone, otherwise fall back to "UTC". */
export function resolveTimeZone(tz: string | undefined | null): string {
  if (!tz) return "UTC";
  try {
    // Constructing a formatter throws RangeError for an unknown timezone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** The calendar date (YYYY-MM-DD) of `instant` as seen in `timeZone`. */
export function localDateKey(instant: Date, timeZone: string): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The `days` calendar dates (YYYY-MM-DD) ending on the current day in
 * `timeZone`, oldest first. Day arithmetic is done on a UTC anchor of the local
 * calendar date so DST transitions can't shift the dates.
 */
export function buildDayDates(now: Date, days: number, timeZone: string): string[] {
  const anchor = new Date(localDateKey(now, timeZone) + "T00:00:00Z");
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]!);
  }
  return dates;
}

export interface DaySlot {
  /** Calendar date (YYYY-MM-DD) in the target timezone. */
  date: string;
  /** Short weekday label matching `date`. */
  label: string;
}

/**
 * Like {@link buildDayDates}, but each date is paired with its short weekday
 * label.
 */
export function buildDaySlots(now: Date, days: number, timeZone: string): DaySlot[] {
  return buildDayDates(now, days, timeZone).map((date) => ({
    date,
    label: new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    }),
  }));
}

/** The hour of day (0–23) of `instant` as seen in `timeZone`. */
export function localHour(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return parseInt(formatted, 10);
}
