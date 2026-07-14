import { describe, it, expect } from "vitest";
import { countdownReducer, countdownIdle, formatClock, MICRO_START_SECONDS } from "./countdown";

describe("countdownReducer", () => {
  it("starts at the requested seconds", () => {
    const s = countdownReducer(countdownIdle, { type: "start", seconds: MICRO_START_SECONDS });
    expect(s).toEqual({ totalSeconds: 120, remaining: 120, status: "running" });
  });

  it("ticks down to zero and stops — zero is a state, not a failure", () => {
    let s = countdownReducer(countdownIdle, { type: "start", seconds: 2 });
    s = countdownReducer(s, { type: "tick" });
    expect(s.remaining).toBe(1);
    s = countdownReducer(s, { type: "tick" });
    expect(s).toEqual({ totalSeconds: 2, remaining: 0, status: "zero" });
    // Extra ticks at zero change nothing.
    expect(countdownReducer(s, { type: "tick" })).toEqual(s);
  });

  it("ignores ticks while idle", () => {
    expect(countdownReducer(countdownIdle, { type: "tick" })).toEqual(countdownIdle);
  });

  it("restart refills the same duration", () => {
    let s = countdownReducer(countdownIdle, { type: "start", seconds: 120 });
    s = countdownReducer(s, { type: "tick" });
    s = countdownReducer(s, { type: "restart" });
    expect(s).toEqual({ totalSeconds: 120, remaining: 120, status: "running" });
  });

  it("reset returns to idle", () => {
    let s = countdownReducer(countdownIdle, { type: "start", seconds: 120 });
    expect(countdownReducer(s, { type: "reset" })).toEqual(countdownIdle);
  });
});

describe("formatClock", () => {
  it("renders m:ss", () => {
    expect(formatClock(120)).toBe("2:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(0)).toBe("0:00");
  });
});
