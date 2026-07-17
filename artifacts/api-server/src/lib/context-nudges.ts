import type { PatternSummary } from "./patterns";

// Anti-shame envelope + per-kind windows (spec §3). All hours are the USER's
// local hours; the scheduler resolves them per user before calling in.
export const ENVELOPE_START = 7;
export const ENVELOPE_END = 22; // exclusive
export const MAX_PER_DAY = 2;
export const SPACING_MIN = 90;
export const DUE_TODAY_HOUR = 19;
export const DEFAULT_POWER_HOUR = 9;
export const QUICK_WIN_START = 16;
export const QUICK_WIN_END = 18; // exclusive — latest send (17:59) clears SPACING_MIN before hour 19
export const QUICK_WIN_MEDIAN_MAX = 10;
export const QUICK_WIN_MIN_COUNT = 3;
export const QUICK_WIN_ESTIMATE_MAX = 10;

export type ContextNudgeKind = "due_today" | "power_window" | "quick_win";

export interface ContextNudge {
  kind: ContextNudgeKind;
  title: string;
  body: string;
  tag: "context-nudge";
  url: "/";
}

export interface OpenQuestLite {
  id: number;
  title: string;
  dueDate: string | null; // YYYY-MM-DD; null = anchored
  category: string;
  estimatedMinutes: number | null;
  difficulty: string;
  priority: string;
}

export interface NudgeGateState {
  now: Date;
  localHour: number;
  localToday: string; // YYYY-MM-DD in the user's zone
  sentDates: { dueToday: string | null; powerWindow: string | null; quickWin: string | null };
  contextNudgedAt: Date | null;
}

export interface ContextNudgeInputs extends NudgeGateState {
  patterns: PatternSummary | null;
  /** completed == false AND (dueDate <= localToday OR dueDate IS NULL) — caller-filtered. */
  openQuests: OpenQuestLite[];
}

/**
 * Which kinds could still fire this tick, in priority order — the scheduler's
 * cheap pre-gate (no patterns, no quest rows). selectContextNudge re-runs this;
 * it is the authority, this is the optimization.
 */
export function eligibleKinds(gate: NudgeGateState): ContextNudgeKind[] {
  const { localHour, localToday, sentDates, contextNudgedAt, now } = gate;
  if (localHour < ENVELOPE_START || localHour >= ENVELOPE_END) return [];
  const sentToday = [sentDates.dueToday, sentDates.powerWindow, sentDates.quickWin]
    .filter((d) => d === localToday).length;
  if (sentToday >= MAX_PER_DAY) return [];
  if (contextNudgedAt && (now.getTime() - contextNudgedAt.getTime()) / 60_000 < SPACING_MIN) return [];

  const kinds: ContextNudgeKind[] = [];
  if (sentDates.dueToday !== localToday && localHour === DUE_TODAY_HOUR) kinds.push("due_today");
  // The learned power hour is unknown until patterns load, so any envelope hour
  // qualifies here; selectContextNudge applies the real target hour.
  if (sentDates.powerWindow !== localToday) kinds.push("power_window");
  if (sentDates.quickWin !== localToday && localHour >= QUICK_WIN_START && localHour < QUICK_WIN_END) {
    kinds.push("quick_win");
  }
  return kinds;
}

function lowestId<T extends { id: number }>(quests: T[]): T | undefined {
  return quests.reduce<T | undefined>((best, q) => (!best || q.id < best.id ? q : best), undefined);
}

function dueTodayNudge(inputs: ContextNudgeInputs): ContextNudge | null {
  const due = inputs.openQuests.filter((q) => q.dueDate === inputs.localToday);
  if (due.length === 0) return null;
  const body = due.length === 1
    ? `'${due[0]!.title}' is due today and still open — one small push keeps the momentum. Daily bonus if you clear it!`
    : `${due.length} quests due today are still open — even one keeps the momentum. Clear them all for the daily bonus!`;
  return { kind: "due_today", title: "Still time for a win 🌙", body, tag: "context-nudge", url: "/" };
}

// Implemented in later tasks.
function powerWindowNudge(_inputs: ContextNudgeInputs): ContextNudge | null {
  return null;
}
function quickWinNudge(_inputs: ContextNudgeInputs): ContextNudge | null {
  return null;
}

/** At most ONE nudge per tick, or null. Pure; the full anti-shame envelope lives here. */
export function selectContextNudge(inputs: ContextNudgeInputs): ContextNudge | null {
  if (inputs.openQuests.length === 0) return null;
  for (const kind of eligibleKinds(inputs)) {
    const nudge =
      kind === "due_today" ? dueTodayNudge(inputs)
      : kind === "power_window" ? powerWindowNudge(inputs)
      : quickWinNudge(inputs);
    if (nudge) return nudge;
  }
  return null;
}
