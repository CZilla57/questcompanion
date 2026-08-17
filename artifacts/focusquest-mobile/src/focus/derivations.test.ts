import { describe, it, expect } from "vitest";
import type { TimerState } from "@workspace/pomodoro";
import { effectiveNow, partialSeconds, nextCreditIndex, localDateString } from "./derivations";

function st(partial: Partial<TimerState>): TimerState {
  return { phase: "focus", cycleIndex: 1, remainingSeconds: 0, completedIntervals: 0, ...partial };
}

describe("effectiveNow", () => {
  it("returns now when running with no accumulated pause", () => {
    expect(effectiveNow(10_000, null, 0)).toBe(10_000);
  });
  it("freezes at pausedAt while paused", () => {
    expect(effectiveNow(10_000, 4_000, 0)).toBe(4_000);
  });
  it("subtracts accumulated pause while running", () => {
    expect(effectiveNow(10_000, null, 3_000)).toBe(7_000);
  });
  it("freezes at pausedAt minus accumulated pause", () => {
    expect(effectiveNow(10_000, 4_000, 1_000)).toBe(3_000);
  });
});

describe("partialSeconds", () => {
  it("is elapsed focus seconds during a focus phase", () => {
    // 25-min focus, 15 min remaining -> 10 min elapsed = 600s
    expect(partialSeconds(st({ phase: "focus", remainingSeconds: 15 * 60 }), 25)).toBe(600);
  });
  it("is zero during a break", () => {
    expect(partialSeconds(st({ phase: "break", remainingSeconds: 60 }), 25)).toBe(0);
  });
  it("is zero when done", () => {
    expect(partialSeconds(st({ phase: "done", remainingSeconds: 0 }), 25)).toBe(0);
  });
  it("never goes negative", () => {
    // remaining greater than the whole focus block (defensive) clamps to 0
    expect(partialSeconds(st({ phase: "focus", remainingSeconds: 26 * 60 }), 25)).toBe(0);
  });
});

describe("nextCreditIndex", () => {
  it("returns credited+1 when a new boundary has passed", () => {
    expect(nextCreditIndex(st({ completedIntervals: 1 }), 0, 4)).toBe(1);
  });
  it("returns null when no new boundary has passed yet", () => {
    expect(nextCreditIndex(st({ completedIntervals: 0 }), 0, 4)).toBeNull();
  });
  it("returns null when the next index is already credited", () => {
    expect(nextCreditIndex(st({ completedIntervals: 1 }), 1, 4)).toBeNull();
  });
  it("advances one index at a time when several boundaries passed", () => {
    expect(nextCreditIndex(st({ completedIntervals: 3 }), 1, 4)).toBe(2);
  });
  it("returns null past the final planned cycle", () => {
    expect(nextCreditIndex(st({ completedIntervals: 4 }), 4, 4)).toBeNull();
  });
});

describe("localDateString", () => {
  const t = Date.UTC(2026, 7, 14, 3, 30); // 2026-08-14T03:30:00Z
  it("formats the local calendar date in UTC", () => {
    expect(localDateString(t, "UTC")).toBe("2026-08-14");
  });
  it("rolls back across the date line for a western zone", () => {
    // America/New_York is UTC-4 in August -> 2026-08-13 23:30 local
    expect(localDateString(t, "America/New_York")).toBe("2026-08-13");
  });
});
