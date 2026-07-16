import { describe, it, expect } from "vitest";
import { isBigSwing, inPowerWindow, rescheduleStruggleDelta } from "./steering";

describe("isBigSwing", () => {
  it("true for a hard difficulty rung", () => {
    expect(isBigSwing({ difficulty: "hard", priority: "low", estimatedMinutes: 5 })).toBe(true);
  });

  it("true for high priority", () => {
    expect(isBigSwing({ difficulty: "medium", priority: "high", estimatedMinutes: null })).toBe(true);
  });

  it("true at the 25-minute estimate floor", () => {
    expect(isBigSwing({ difficulty: "medium", priority: "low", estimatedMinutes: 25 })).toBe(true);
  });

  it("false below the floor with medium difficulty and priority", () => {
    expect(isBigSwing({ difficulty: "medium", priority: "medium", estimatedMinutes: 24 })).toBe(false);
  });

  it("false with no estimate and nothing else qualifying", () => {
    expect(isBigSwing({ difficulty: "easy", priority: "low", estimatedMinutes: null })).toBe(false);
  });
});

describe("inPowerWindow", () => {
  const HOURS = [{ hour: 9 }, { hour: 14 }, { hour: 21 }]; // non-contiguous is normal

  it("member hour is in the window", () => {
    expect(inPowerWindow(14, HOURS)).toBe(true);
  });

  it("non-member hour is not", () => {
    expect(inPowerWindow(10, HOURS)).toBe(false);
  });

  it("empty powerHours never matches", () => {
    expect(inPowerWindow(9, [])).toBe(false);
  });
});

describe("rescheduleStruggleDelta", () => {
  it("forward reschedule counts as struggle when not steered", () => {
    expect(rescheduleStruggleDelta("2026-07-10", "2026-07-12", false)).toBe(1);
  });

  it("steered forward reschedule is planning, not avoidance", () => {
    expect(rescheduleStruggleDelta("2026-07-10", "2026-07-12", true)).toBe(0);
  });

  it("backward reschedule never counts, steered or not", () => {
    expect(rescheduleStruggleDelta("2026-07-12", "2026-07-10", false)).toBe(0);
    expect(rescheduleStruggleDelta("2026-07-12", "2026-07-10", true)).toBe(0);
  });

  it("no existing date never counts", () => {
    expect(rescheduleStruggleDelta(null, "2026-07-12", false)).toBe(0);
  });
});
