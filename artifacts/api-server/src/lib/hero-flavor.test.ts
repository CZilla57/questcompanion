import { describe, it, expect } from "vitest";
import { VIGNETTES, currentVignette, type HeroClass } from "./hero-flavor";
import type { HungerStage } from "./hero-care";

const STAGES: HungerStage[] = ["well_fed", "peckish", "hungry", "starving", "fainted"];
const CLASSES: HeroClass[] = ["fighter", "mage", "ranger", "healer"];

describe("VIGNETTES catalog", () => {
  it("has unique ids", () => {
    const ids = VIGNETTES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every stage x class combination has at least one eligible vignette", () => {
    for (const stage of STAGES) {
      for (const cls of CLASSES) {
        const eligible = VIGNETTES.filter(
          (v) => v.stages.includes(stage) && (!v.classes || v.classes.includes(cls)),
        );
        expect(eligible.length, `${stage}/${cls}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("currentVignette", () => {
  const now = new Date("2026-07-13T10:30:00Z");
  it("is deterministic for the same user/stage/class/time-bucket", () => {
    const a = currentVignette(1, "well_fed", "mage", now);
    const b = currentVignette(1, "well_fed", "mage", new Date(now.getTime() + 60 * 1000));
    expect(a.id).toBe(b.id); // same 3h bucket
  });
  it("rotates across 3-hour buckets (some bucket differs)", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 8; i++) {
      picks.add(currentVignette(1, "well_fed", "mage", new Date(now.getTime() + i * 3 * 60 * 60 * 1000)).id);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
  it("only returns vignettes eligible for the stage", () => {
    const v = currentVignette(3, "fainted", "fighter", now);
    expect(v.stages).toContain("fainted");
  });
  it("never returns another class's vignette", () => {
    for (let u = 1; u <= 20; u++) {
      const v = currentVignette(u, "well_fed", "healer", now);
      if (v.classes) expect(v.classes).toContain("healer");
    }
  });
});
