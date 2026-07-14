import { localDateKey, localDayStartUtc, resolveTimeZone } from "./date-buckets";

export const BRAIN_MODES = ["focused", "distracted", "frozen", "hyperfocus", "neutral"] as const;
export type BrainMode = (typeof BRAIN_MODES)[number];

export const CHECKIN_SOURCES = ["tap", "daily_prompt", "emergency_exit"] as const;
export type CheckinSource = (typeof CHECKIN_SOURCES)[number];

export const MODE_TTL_HOURS = 4;

export function isBrainMode(v: unknown): v is BrainMode {
  return typeof v === "string" && (BRAIN_MODES as readonly string[]).includes(v);
}

export function isCheckinSource(v: unknown): v is CheckinSource {
  return typeof v === "string" && (CHECKIN_SOURCES as readonly string[]).includes(v);
}

/** min(createdAt + 4h, the next local midnight after createdAt). */
export function modeExpiresAt(createdAt: Date, tz: string): Date {
  const zone = resolveTimeZone(tz);
  const ttlEnd = new Date(createdAt.getTime() + MODE_TTL_HOURS * 3_600_000);
  // Next local midnight: UTC-anchored day arithmetic on the local date key is
  // DST-safe (same approach as buildDayDates).
  const anchor = new Date(localDateKey(createdAt, zone) + "T00:00:00Z");
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  const nextMidnight = localDayStartUtc(anchor.toISOString().split("T")[0]!, zone);
  return ttlEnd < nextMidnight ? ttlEnd : nextMidnight;
}

export interface BrainState {
  mode: BrainMode;
  since: Date | null;
  expiresAt: Date | null;
  checkedInToday: boolean;
}

/**
 * Mode is derived, never stored. Only the NEWEST check-in row is consulted, so
 * a `neutral` row genuinely clears — older rows can never resurrect a mode.
 */
export function deriveBrainState(
  latest: { mode: string; createdAt: Date } | undefined,
  now: Date,
  tz: string,
): BrainState {
  const zone = resolveTimeZone(tz);
  const checkedInToday =
    !!latest && localDateKey(latest.createdAt, zone) === localDateKey(now, zone);

  if (!latest || !isBrainMode(latest.mode) || latest.mode === "neutral") {
    return { mode: "neutral", since: null, expiresAt: null, checkedInToday };
  }
  const expiresAt = modeExpiresAt(latest.createdAt, zone);
  if (now.getTime() >= expiresAt.getTime()) {
    return { mode: "neutral", since: null, expiresAt: null, checkedInToday };
  }
  return { mode: latest.mode, since: latest.createdAt, expiresAt, checkedInToday };
}
