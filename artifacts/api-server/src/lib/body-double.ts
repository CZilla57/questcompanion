// Act IV Body-Doubling Rooms — pure decision logic (no I/O), envelope-style.
import { GRACE_SECONDS, computeIntervalXp } from "./focus-sessions";
import { resolveTimeZone, localHour } from "./date-buckets";
import { inQuietHours, DEEP_NIGHT_START, DEEP_NIGHT_END } from "./notification-envelope";

// Poll cadence (10 s) must stay well under HERE_THRESHOLD_SEC.
export const HERE_THRESHOLD_SEC = 45;
export const WAVE_MIN_GAP_SEC = 15;
// Must stay > the longest sprint (50 min) so a claimable sprint in a fully
// heads-down room is essentially never swept out from under it.
export const SWEEP_STALE_MIN = 90;
export const SWEEP_MAX_AGE_HOURS = 12;

export const SPRINT_MINUTES = [15, 25, 50] as const;
export type SprintMinutes = (typeof SPRINT_MINUTES)[number];

export type Presence = "here" | "headsDown";

/** A locked phone is a body double working, not a body double gone. */
export function presenceOf(lastSeenAt: Date, now: Date): Presence {
  return (now.getTime() - lastSeenAt.getTime()) / 1000 <= HERE_THRESHOLD_SEC ? "here" : "headsDown";
}

export function isSprintMinutes(m: unknown): m is SprintMinutes {
  return typeof m === "number" && (SPRINT_MINUTES as readonly number[]).includes(m);
}

/** Same anti-cheat grammar as focus-interval crediting: wall-clock lower bound. */
export function sprintElapsedOk(startedAt: Date, minutes: number, now: Date): boolean {
  return (now.getTime() - startedAt.getTime()) / 1000 >= minutes * 60 - GRACE_SECONDS;
}

/** Company pays exactly like a focus block (D5). */
export function sprintBonusXp(minutes: number): number {
  return computeIntervalXp(minutes);
}

/** Payout eligibility is joined-and-not-left — NEVER heartbeat freshness. */
export function eligibleMembers<T extends { leftAt: Date | null }>(members: T[]): T[] {
  return members.filter((m) => m.leftAt === null);
}

export function canWave(lastWaveAt: Date | null, now: Date): boolean {
  if (!lastWaveAt) return true;
  return (now.getTime() - lastWaveAt.getTime()) / 1000 >= WAVE_MIN_GAP_SEC;
}

/** Sweep predicate — pure mirror of the cron UPDATE's WHERE clause. */
export function shouldSweepRoom(createdAt: Date, memberLastSeens: Date[], now: Date): boolean {
  if (now.getTime() - createdAt.getTime() >= SWEEP_MAX_AGE_HOURS * 3_600_000) return true;
  const freshest = memberLastSeens.reduce((max, d) => Math.max(max, d.getTime()), 0);
  return now.getTime() - freshest >= SWEEP_STALE_MIN * 60_000;
}

/** One-Voice-spirit courtesy: no invite pushes into deep night or quiet hours. */
export function shouldSendInvitePush(
  recipient: { timezone: string | null; quietHoursStart: number; quietHoursEnd: number },
  now: Date,
): boolean {
  const hour = localHour(now, resolveTimeZone(recipient.timezone));
  if (hour >= DEEP_NIGHT_START && hour < DEEP_NIGHT_END) return false;
  return !inQuietHours(hour, recipient.quietHoursStart, recipient.quietHoursEnd);
}
