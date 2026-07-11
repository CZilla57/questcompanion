import { describe, it, expect } from "vitest";
import {
  PRESETS, getPreset, computeIntervalXp, computePartialXp,
  expectedElapsedSeconds, FULL_SET_BONUS,
} from "./focus-sessions";

describe("focus-sessions pure lib", () => {
  it("defines the three presets with the agreed numbers", () => {
    expect(getPreset("classic")).toMatchObject({ focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, plannedCycles: 4 });
    expect(getPreset("deep")).toMatchObject({ focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 2, plannedCycles: 3 });
    expect(getPreset("short")).toMatchObject({ focusMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, longBreakEvery: 4, plannedCycles: 4 });
    expect(getPreset("nope")).toBeUndefined();
    expect(Object.keys(PRESETS)).toEqual(["classic", "deep", "short"]);
  });

  it("computes per-interval XP as round(min*0.2)+5", () => {
    expect(computeIntervalXp(25)).toBe(10);
    expect(computeIntervalXp(50)).toBe(15);
    expect(computeIntervalXp(15)).toBe(8);
  });

  it("totals a full classic session to 65 XP", () => {
    const total = 4 * computeIntervalXp(25) + FULL_SET_BONUS;
    expect(total).toBe(65);
  });

  it("computes partial XP with no block bonus and rounds", () => {
    expect(computePartialXp(0)).toBe(0);
    expect(computePartialXp(12)).toBe(2); // round(2.4)
    expect(computePartialXp(13)).toBe(3); // round(2.6)
  });

  it("gives a breaks-excluded elapsed lower bound", () => {
    expect(expectedElapsedSeconds(25, 1)).toBe(1500);
    expect(expectedElapsedSeconds(25, 3)).toBe(4500);
  });
});
