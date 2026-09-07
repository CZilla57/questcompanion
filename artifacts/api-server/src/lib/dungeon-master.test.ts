import { describe, it, expect } from "vitest";
import { buildBeatFacts, beatHasSubstance, type DmFactInputs } from "./dungeon-master";

function inputs(overrides: Partial<DmFactInputs> = {}): DmFactInputs {
  return {
    completedToday: [],
    plannedToday: [],
    lifetimeBeforeToday: {},
    pointsToday: {},
    focusMinutes: 0,
    streakDays: 0,
    chapterBeat: null,
    ...overrides,
  };
}

describe("buildBeatFacts", () => {
  it("is strengths-only: carries titles, focus, streak, chapter", () => {
    const facts = buildBeatFacts(inputs({
      completedToday: [{ title: "Ship report", category: "work" }],
      plannedToday: [{ title: "Fold laundry" }],
      focusMinutes: 40,
      streakDays: 3,
      chapterBeat: "The first stretch is behind you.",
    }));
    expect(facts.completedTitles).toEqual(["Ship report"]);
    expect(facts.plannedTitles).toEqual(["Fold laundry"]);
    expect(facts.focusMinutes).toBe(40);
    expect(facts.streakDays).toBe(3);
    expect(facts.chapterBeat).toBe("The first stretch is behind you.");
  });

  it("caps titles at 6 (grounding, not an inventory dump)", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `Quest ${i}` }));
    const facts = buildBeatFacts(inputs({ plannedToday: many }));
    expect(facts.plannedTitles).toHaveLength(6);
  });

  it("keeps the most RECENT completions when capping", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `Done ${i}`, category: "work" }));
    const facts = buildBeatFacts(inputs({ completedToday: many }));
    expect(facts.completedTitles).toEqual(["Done 2", "Done 3", "Done 4", "Done 5", "Done 6", "Done 7"]);
  });

  it("reports kingdom growth ONLY when a tier boundary was crossed today", () => {
    // forge tiers: crossing from Wild(0) to Outpost happens at a real threshold.
    // Pushing forge from 0 to a settlement-level total crosses at least one tier.
    const grew = buildBeatFacts(inputs({
      lifetimeBeforeToday: { forge: 0 },
      pointsToday: { forge: 500 },
    }));
    expect(grew.kingdomGrowth.length).toBeGreaterThan(0);
    expect(grew.kingdomGrowth[0]).toMatch(/^the .+ reached /);

    // A small same-tier gain reports NO growth — never claims an advance.
    const flat = buildBeatFacts(inputs({
      lifetimeBeforeToday: { forge: 500 },
      pointsToday: { forge: 1 },
    }));
    expect(flat.kingdomGrowth).toEqual([]);
  });

  it("reports no growth when nothing was added today", () => {
    const facts = buildBeatFacts(inputs({ lifetimeBeforeToday: { forge: 9999 }, pointsToday: {} }));
    expect(facts.kingdomGrowth).toEqual([]);
  });
});

describe("beatHasSubstance", () => {
  it("morning leans on planned quests", () => {
    expect(beatHasSubstance("morning", buildBeatFacts(inputs({ plannedToday: [{ title: "X" }] })))).toBe(true);
    expect(beatHasSubstance("morning", buildBeatFacts(inputs({ completedToday: [{ title: "X", category: "c" }] })))).toBe(false);
  });

  it("camp leans on completed quests", () => {
    expect(beatHasSubstance("camp", buildBeatFacts(inputs({ completedToday: [{ title: "X", category: "c" }] })))).toBe(true);
    expect(beatHasSubstance("camp", buildBeatFacts(inputs({ plannedToday: [{ title: "X" }] })))).toBe(false);
  });

  it("focus, growth, or an active chapter is enough substance", () => {
    expect(beatHasSubstance("morning", buildBeatFacts(inputs({ focusMinutes: 25 })))).toBe(true);
    expect(beatHasSubstance("camp", buildBeatFacts(inputs({ chapterBeat: "beat" })))).toBe(true);
  });

  it("an empty day has no substance (DM stays quiet)", () => {
    expect(beatHasSubstance("morning", buildBeatFacts(inputs()))).toBe(false);
    expect(beatHasSubstance("camp", buildBeatFacts(inputs()))).toBe(false);
  });
});
