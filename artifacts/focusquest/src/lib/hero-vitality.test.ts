import { describe, it, expect } from "vitest";
import { stageSegments, stageLabel, heroSpriteEffect, type HungerStage } from "./hero-vitality";

const STAGES: HungerStage[] = ["well_fed", "peckish", "hungry", "starving", "fainted"];

describe("stageSegments", () => {
  it("monotonically decreases from 5 to 0 across stages", () => {
    const values = STAGES.map(stageSegments);
    expect(values[0]).toBe(5);
    expect(values[4]).toBe(0);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]!);
    }
  });
});

describe("stageLabel", () => {
  it("has a human label for every stage", () => {
    for (const s of STAGES) expect(stageLabel(s).length).toBeGreaterThan(0);
  });
});

describe("heroSpriteEffect", () => {
  it("leaves well_fed/peckish/undefined untouched", () => {
    expect(heroSpriteEffect("well_fed")).toEqual({});
    expect(heroSpriteEffect("peckish")).toEqual({});
    expect(heroSpriteEffect(undefined)).toEqual({});
  });
  it("applies a filter from hungry onward", () => {
    expect(heroSpriteEffect("hungry").filter).toBeTruthy();
    expect(heroSpriteEffect("starving").filter).toBeTruthy();
  });
  it("fainted lies on the ground (rotated) and grayscaled", () => {
    const fx = heroSpriteEffect("fainted");
    expect(fx.transform).toContain("rotate(90deg)");
    expect(fx.filter).toContain("grayscale");
  });
});
