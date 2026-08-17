export type Phase = "focus" | "break" | "longBreak" | "done";

export interface TimerConfig {
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number; // long break after every N focus intervals
  plannedCycles: number;  // total focus intervals
}

export interface TimerState {
  phase: Phase;
  cycleIndex: number;         // 1-based current (or just-finished) focus interval
  remainingSeconds: number;   // seconds left in the current phase (0 when done)
  completedIntervals: number; // focus intervals fully elapsed by now
}

/**
 * Given the session config and wall-clock timestamps, return where the timer is now.
 * Walks focus -> break -> (long break every N) up to plannedCycles; there is no break
 * after the final focus interval.
 */
export function reconstructTimerState(config: TimerConfig, startedAtMs: number, nowMs: number): TimerState {
  let t = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const focusSec = config.focusMinutes * 60;
  let completed = 0;

  for (let cycle = 1; cycle <= config.plannedCycles; cycle++) {
    if (t < focusSec) {
      return { phase: "focus", cycleIndex: cycle, remainingSeconds: focusSec - t, completedIntervals: completed };
    }
    t -= focusSec;
    completed = cycle;

    if (cycle === config.plannedCycles) break; // no break after the last focus block

    const isLong = cycle % config.longBreakEvery === 0;
    const breakSec = (isLong ? config.longBreakMinutes : config.breakMinutes) * 60;
    if (t < breakSec) {
      return {
        phase: isLong ? "longBreak" : "break",
        cycleIndex: cycle,
        remainingSeconds: breakSec - t,
        completedIntervals: completed,
      };
    }
    t -= breakSec;
  }

  return { phase: "done", cycleIndex: config.plannedCycles, remainingSeconds: 0, completedIntervals: config.plannedCycles };
}

/**
 * True when the time since the last credited interval (or start) exceeds one
 * focus + long-break span — i.e. the user was clearly absent and the session
 * should be finalized with only banked intervals rather than back-credited.
 */
export function isStaleGap(config: TimerConfig, lastActivityMs: number, nowMs: number): boolean {
  const gapSec = Math.floor((nowMs - lastActivityMs) / 1000);
  return gapSec > (config.focusMinutes + config.longBreakMinutes) * 60;
}
