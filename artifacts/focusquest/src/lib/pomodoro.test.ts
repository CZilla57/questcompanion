import { describe, it, expect } from "vitest";
import { reconstructTimerState, isStaleGap, type TimerConfig } from "./pomodoro";

const classic: TimerConfig = { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, plannedCycles: 4 };
const longBreakCfg: TimerConfig = { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 2, plannedCycles: 4 };
const MIN = 60_000;

describe("reconstructTimerState", () => {
  it("is in focus 1 near the start", () => {
    const s = reconstructTimerState(classic, 0, 10 * MIN);
    expect(s).toMatchObject({ phase: "focus", cycleIndex: 1, completedIntervals: 0 });
    expect(s.remainingSeconds).toBe(15 * 60);
  });

  it("is on the short break after focus 1", () => {
    const s = reconstructTimerState(classic, 0, 27 * MIN); // 25 focus + 2 into break
    expect(s).toMatchObject({ phase: "break", cycleIndex: 1, completedIntervals: 1 });
    expect(s.remainingSeconds).toBe(3 * 60);
  });

  it("is in focus 2 after the first break", () => {
    const s = reconstructTimerState(classic, 0, 32 * MIN); // 25 + 5 + 2
    expect(s).toMatchObject({ phase: "focus", cycleIndex: 2, completedIntervals: 1 });
  });

  it("is in focus 4 during the last cycle (no trailing break)", () => {
    // 3 full cycles = 3*(25+5)=90; then focus 4 = 25 -> 115; no break after the last focus.
    const s = reconstructTimerState(classic, 0, 100 * MIN); // during focus 4
    expect(s).toMatchObject({ phase: "focus", cycleIndex: 4, completedIntervals: 3 });
  });

  it("returns a long break after the 2nd focus block when longBreakEvery is 2", () => {
    // focus1[0,25) short-break1[25,30) focus2[30,55) longBreak[55,70) ...
    const s = reconstructTimerState(longBreakCfg, 0, 57 * MIN);
    expect(s).toMatchObject({ phase: "longBreak", cycleIndex: 2, completedIntervals: 2 });
    expect(s.remainingSeconds).toBe(13 * 60); // 15-min long break, 2 min elapsed
  });

  it("is done past the whole session", () => {
    const s = reconstructTimerState(classic, 0, 999 * MIN);
    expect(s).toMatchObject({ phase: "done", cycleIndex: 4, completedIntervals: 4, remainingSeconds: 0 });
  });
});

describe("isStaleGap", () => {
  it("is false for a short gap", () => {
    expect(isStaleGap(classic, 0, 10 * MIN)).toBe(false);
  });
  it("is true past one focus + long break", () => {
    // threshold = (25 + 15) * 60 = 2400s = 40 min
    expect(isStaleGap(classic, 0, 41 * MIN)).toBe(true);
    expect(isStaleGap(classic, 0, 39 * MIN)).toBe(false);
  });

  it("treats the exact threshold second as NOT stale (strict >)", () => {
    // threshold = (25 + 15) * 60 = 2400s = 40 min exactly
    expect(isStaleGap(classic, 0, 40 * MIN)).toBe(false); // 2400 > 2400 is false
    expect(isStaleGap(classic, 0, 40 * MIN + 1000)).toBe(true); // 2401 > 2400
  });
});
