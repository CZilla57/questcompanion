import { describe, it, expect } from "vitest";
import { bondTier, dayGap, STREAK_MILESTONES, deriveCompanionBeat } from "./companion";

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

describe("deriveCompanionBeat", () => {
  const base = { streakDays: 0, dayGap: 0 as number | null, hungerStage: "well_fed" as const, bondTier: 0 };

  it("welcome_back wins when the gap is >= 3 days, even over a milestone", () => {
    const beat = deriveCompanionBeat({ ...base, dayGap: 5, streakDays: 7 });
    expect(beat.kind).toBe("welcome_back");
  });
  it("welcome_back shows even when the hero is fainted (stays warm)", () => {
    expect(deriveCompanionBeat({ ...base, dayGap: 9, hungerStage: "fainted" }).kind).toBe("welcome_back");
  });
  it("streak_milestone fires on a milestone day (gap 0)", () => {
    for (const n of [3, 7, 14, 30, 50, 100, 200, 365]) {
      expect(deriveCompanionBeat({ ...base, streakDays: n }).kind).toBe("streak_milestone");
    }
  });
  it("non-milestone streak with no gap is ambient", () => {
    expect(deriveCompanionBeat({ ...base, streakDays: 8 }).kind).toBe("ambient");
  });
  it("rest_day for a 1-2 day gap when not a milestone", () => {
    expect(deriveCompanionBeat({ ...base, dayGap: 1 }).kind).toBe("rest_day");
    expect(deriveCompanionBeat({ ...base, dayGap: 2 }).kind).toBe("rest_day");
  });
  it("ambient yields to hunger (quiet) when starving or fainted", () => {
    expect(deriveCompanionBeat({ ...base, hungerStage: "starving" }).kind).toBe("quiet");
    expect(deriveCompanionBeat({ ...base, hungerStage: "fainted" }).kind).toBe("quiet");
  });
  it("null gap (brand-new user) with no milestone is ambient", () => {
    expect(deriveCompanionBeat({ ...base, dayGap: null }).kind).toBe("ambient");
  });
  it("carries streakDays and bondTier through", () => {
    const beat = deriveCompanionBeat({ ...base, streakDays: 7, bondTier: 3 });
    expect(beat).toMatchObject({ streakDays: 7, bondTier: 3 });
  });
});
