import { describe, it, expect } from "vitest";
import { bondTier, dayGap, STREAK_MILESTONES } from "./companion";

describe("bondTier", () => {
  it("maps lifetime completions to the 5 named tiers", () => {
    expect(bondTier(0)).toMatchObject({ tier: 0, name: "Newly Met" });
    expect(bondTier(9)).toMatchObject({ tier: 0, name: "Newly Met" });
    expect(bondTier(10)).toMatchObject({ tier: 1, name: "Trusted" });
    expect(bondTier(49)).toMatchObject({ tier: 1, name: "Trusted" });
    expect(bondTier(50)).toMatchObject({ tier: 2, name: "Steadfast" });
    expect(bondTier(149)).toMatchObject({ tier: 2, name: "Steadfast" });
    expect(bondTier(150)).toMatchObject({ tier: 3, name: "Kindred" });
    expect(bondTier(399)).toMatchObject({ tier: 3, name: "Kindred" });
    expect(bondTier(400)).toMatchObject({ tier: 4, name: "Legendary Bond" });
    expect(bondTier(99999)).toMatchObject({ tier: 4, name: "Legendary Bond" });
  });
});

describe("dayGap", () => {
  it("returns null for a user who has never been active", () => {
    expect(dayGap(null, "2026-07-17")).toBeNull();
  });
  it("counts whole calendar days between two date keys", () => {
    expect(dayGap("2026-07-17", "2026-07-17")).toBe(0);
    expect(dayGap("2026-07-16", "2026-07-17")).toBe(1);
    expect(dayGap("2026-07-15", "2026-07-17")).toBe(2);
    expect(dayGap("2026-07-10", "2026-07-17")).toBe(7);
  });
  it("spans month boundaries correctly", () => {
    expect(dayGap("2026-06-30", "2026-07-02")).toBe(2);
  });
});

describe("STREAK_MILESTONES", () => {
  it("is the agreed ladder", () => {
    expect([...STREAK_MILESTONES]).toEqual([3, 7, 14, 30, 50, 100, 200, 365]);
  });
});
