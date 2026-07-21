import { describe, it, expect } from "vitest";
import { paceDelta, isFreshStart } from "./my-week";
import type { MyWeekComparison } from "@workspace/api-client-react";

const metric = (current: number, samePointLastWeek: number, lastWeekTotal: number) =>
  ({ current, samePointLastWeek, lastWeekTotal });

const comparison = (over: Partial<MyWeekComparison> = {}): MyWeekComparison => ({
  timezone: "UTC",
  weekStartDateKey: "2026-07-20",
  quests: metric(0, 0, 0),
  xp: metric(0, 0, 0),
  focusMinutes: metric(0, 0, 0),
  ...over,
});

describe("paceDelta (anti-shame: celebration-only)", () => {
  it("returns the positive lead over last week's pace", () => {
    expect(paceDelta(metric(5, 2, 10))).toBe(3);
  });
  it("returns null when level — no zero-chip", () => {
    expect(paceDelta(metric(4, 4, 9))).toBeNull();
  });
  it("returns null when behind — never a deficit", () => {
    expect(paceDelta(metric(1, 6, 12))).toBeNull();
  });
  it("returns null on an all-zero metric", () => {
    expect(paceDelta(metric(0, 0, 0))).toBeNull();
  });
});

describe("isFreshStart", () => {
  it("is true only when every metric is zero in both weeks", () => {
    expect(isFreshStart(comparison())).toBe(true);
  });
  it("is false once anything happened this week", () => {
    expect(isFreshStart(comparison({ xp: metric(10, 0, 0) }))).toBe(false);
  });
  it("is false when last week had signal (returning user)", () => {
    expect(isFreshStart(comparison({ quests: metric(0, 0, 4) }))).toBe(false);
  });
  it("is false when only the same-point number is nonzero", () => {
    expect(isFreshStart(comparison({ focusMinutes: metric(0, 3, 0) }))).toBe(false);
  });
});
