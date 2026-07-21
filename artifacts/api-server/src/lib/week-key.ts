// ISO-8601 week key, e.g. "2026-W29". Shared by the solo weekly boss and the
// co-op World Boss so both agree on week boundaries.
export function getWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** The ISO week key of 7 days before `now` — the World Boss's cohort-sizing
 * basis (prior week's active contributors). Date-based, so year boundaries
 * need no string arithmetic. */
export function priorWeekKey(now: Date = new Date()): string {
  return getWeekKey(new Date(now.getTime() - 7 * 86400000));
}
