export type PresetKey = "classic" | "deep" | "short";

export interface PomodoroPreset {
  key: PresetKey;
  label: string;
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  plannedCycles: number;
}

export const PRESETS: Record<PresetKey, PomodoroPreset> = {
  classic: { key: "classic", label: "Classic 25/5", focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, plannedCycles: 4 },
  deep:    { key: "deep",    label: "Deep 50/10",   focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 2, plannedCycles: 3 },
  short:   { key: "short",   label: "Short 15/3",   focusMinutes: 15, breakMinutes: 3,  longBreakMinutes: 10, longBreakEvery: 4, plannedCycles: 4 },
};

export function getPreset(key: string): PomodoroPreset | undefined {
  return (PRESETS as Record<string, PomodoroPreset>)[key];
}

export const XP_PER_FOCUS_MINUTE = 0.2;
export const BLOCK_BONUS = 5;
export const FULL_SET_BONUS = 25;
export const GRACE_SECONDS = 5;

/** XP for one completed focus interval: per-minute time reward + block-completion bonus. */
export function computeIntervalXp(focusMinutes: number): number {
  return Math.round(focusMinutes * XP_PER_FOCUS_MINUTE) + BLOCK_BONUS;
}

/** XP for trailing partial focus on a manual stop (no block bonus). */
export function computePartialXp(minutes: number): number {
  return Math.round(minutes * XP_PER_FOCUS_MINUTE);
}

/** Breaks-excluded lower bound on wall-clock seconds to have completed `intervalIndex` focus blocks. */
export function expectedElapsedSeconds(focusMinutes: number, intervalIndex: number): number {
  return intervalIndex * focusMinutes * 60;
}
