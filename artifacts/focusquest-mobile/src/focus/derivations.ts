import type { TimerState } from "@workspace/pomodoro";

/** Pause-adjusted clock: frozen at pausedAtMs while paused, minus accumulated pause. */
export function effectiveNow(nowMs: number, pausedAtMs: number | null, pausedAccumMs: number): number {
  return (pausedAtMs ?? nowMs) - pausedAccumMs;
}

/** Seconds of the current focus block already elapsed (0 outside a focus phase). */
export function partialSeconds(state: TimerState, focusMinutes: number): number {
  const raw = state.phase === "focus" ? focusMinutes * 60 - state.remainingSeconds : 0;
  return Math.max(0, Math.floor(raw));
}

/** The next interval index to credit, or null. Advances one index per call. */
export function nextCreditIndex(
  state: TimerState,
  creditedSoFar: number,
  plannedCycles: number,
): number | null {
  const next = creditedSoFar + 1;
  return state.completedIntervals >= next && next <= plannedCycles ? next : null;
}

/** Local calendar date "YYYY-MM-DD" for the given IANA timezone (replaces date-fns format). */
export function localDateString(nowMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(nowMs));
}
