/**
 * The browser's IANA timezone (e.g. "America/New_York").
 *
 * Passed to server endpoints that bucket data by calendar day/hour so their
 * notion of "today" matches the user's local time instead of the server's UTC.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
