import type { HungerStage } from "./hero-care";

export const FIRST_NUDGE_MIN = 90;
export const INTERVAL_MIN = 60;
// 60 >= the longest preset focus interval (deep = 50 min). lastIntervalAt is only
// written when an interval completes, so a shorter window would make a genuine deep
// session flicker "stale" between completions and push the first nudge past ~90 min.
export const STALE_SESSION_MIN = 60;
export const BEDTIME_HOUR = 23;
export const DEEP_NIGHT_START = 2;
export const MORNING = 7;
export const MEAL_WINDOWS: readonly [number, number][] = [[12, 13], [18, 19]];

export type NudgeKind = "hydrate" | "stretch" | "food" | "bedtime";

export interface ProtectionNudge {
  kind: NudgeKind;
  title: string;
  body: string;
  tag: string;
}

export interface ActiveSessionLite {
  startedAt: Date;
  lastIntervalAt: Date | null;
}

export interface Stretch {
  active: boolean;
  startedAt: Date | null;
}

/** A protected stretch = a fresh active focus session and/or held hyperfocus mode. */
export function protectedStretch(input: {
  activeSessions: ActiveSessionLite[];
  mode: string;
  hyperfocusSince: Date | null;
  now: Date;
}): Stretch {
  const starts: number[] = [];
  const staleBefore = input.now.getTime() - STALE_SESSION_MIN * 60_000;
  for (const s of input.activeSessions) {
    const activityAt = (s.lastIntervalAt ?? s.startedAt).getTime();
    if (activityAt >= staleBefore) starts.push(s.startedAt.getTime());
  }
  if (input.mode === "hyperfocus" && input.hyperfocusSince) {
    starts.push(input.hyperfocusSince.getTime());
  }
  if (starts.length === 0) return { active: false, startedAt: null };
  return { active: true, startedAt: new Date(Math.min(...starts)) };
}

const COPY: Record<NudgeKind, { title: string; body: string }> = {
  hydrate: { title: "Protecting your flow", body: "Deep in it for a while now — a sip of water?" },
  stretch: { title: "Protecting your flow", body: "You've been locked in. Stand up, roll the shoulders?" },
  food:    { title: "Protecting your flow", body: "Your hero's getting hungry — maybe grab a bite too?" },
  bedtime: { title: "It's getting late", body: "You're still going strong — want to start winding down soon? Tomorrow-you will thank you." },
};

function nudge(kind: NudgeKind): ProtectionNudge {
  return { kind, ...COPY[kind], tag: `hyperfocus-${kind}` };
}

function inMealWindow(localHour: number): boolean {
  return MEAL_WINDOWS.some(([a, b]) => localHour >= a && localHour < b);
}

/**
 * Which protection nudge to send this tick, or null. Pure and silent; anti-shame
 * (bedtime is an invitation, deep night is quiet, nothing fires while paused).
 */
export function selectProtectionNudge(input: {
  stretch: Stretch;
  now: Date;
  localHour: number;
  lastNudgedAt: Date | null;
  lastKind: NudgeKind | null;
  hungerStage: HungerStage;
  pausedUntil: Date | null;
}): ProtectionNudge | null {
  const { stretch, now, localHour } = input;
  if (!stretch.active || !stretch.startedAt) return null;
  if (input.pausedUntil && input.pausedUntil.getTime() > now.getTime()) return null;

  const durationMin = (now.getTime() - stretch.startedAt.getTime()) / 60_000;
  if (durationMin < FIRST_NUDGE_MIN) return null;

  const lastNudgeThisStretch =
    input.lastNudgedAt && input.lastNudgedAt.getTime() >= stretch.startedAt.getTime();
  if (lastNudgeThisStretch && (now.getTime() - input.lastNudgedAt!.getTime()) / 60_000 < INTERVAL_MIN) {
    return null;
  }
  const lastKind = lastNudgeThisStretch ? input.lastKind : null;

  // Deep night: never buzz through the small hours.
  if (localHour >= DEEP_NIGHT_START && localHour < MORNING) return null;
  // Bedtime window: late evening, or the hour(s) before deep-night.
  if (localHour >= BEDTIME_HOUR || localHour < DEEP_NIGHT_START) return nudge("bedtime");
  // Food: hero hungry, or a meal window.
  const hungry = input.hungerStage === "hungry" || input.hungerStage === "starving" || input.hungerStage === "fainted";
  if (hungry || inMealWindow(localHour)) return nudge("food");
  // Otherwise alternate hydrate/stretch.
  return nudge(lastKind === "hydrate" ? "stretch" : "hydrate");
}
