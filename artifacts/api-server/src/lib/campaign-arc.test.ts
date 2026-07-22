import { describe, it, expect } from "vitest";
import { curatedArc, CURATED_ARCS, MIN_CHAPTERS, MAX_CHAPTERS } from "./campaign-arc";

describe("CURATED_ARCS", () => {
  it("ships at least three arcs", () => {
    expect(CURATED_ARCS.length).toBeGreaterThanOrEqual(3);
  });
  it("gives every arc enough beats for the maximum chapter count", () => {
    for (const arc of CURATED_ARCS) {
      expect(arc.beats.length).toBeGreaterThanOrEqual(MAX_CHAPTERS);
    }
  });
  it("never names a goal it cannot know", () => {
    // Curated prose must read correctly without knowing the user's goal.
    for (const arc of CURATED_ARCS) {
      const text = [arc.premise, arc.ending, ...arc.beats].join(" ");
      expect(text).not.toMatch(/\{|\}|%s|GOAL/i);
    }
  });
});

describe("curatedArc", () => {
  it("returns exactly the requested number of chapter beats", () => {
    expect(curatedArc(4).chapterBeats).toHaveLength(4);
  });
  it("is deterministic for the same pick", () => {
    expect(curatedArc(3, 1)).toEqual(curatedArc(3, 1));
  });
  it("selects different arcs for different picks", () => {
    expect(curatedArc(3, 0).arcPremise).not.toBe(curatedArc(3, 1).arcPremise);
  });
  it("wraps out-of-range picks instead of throwing", () => {
    expect(curatedArc(3, 99).chapterBeats).toHaveLength(3);
    expect(curatedArc(3, -1).chapterBeats).toHaveLength(3);
  });
  it("clamps chapter counts below the minimum", () => {
    expect(curatedArc(0).chapterBeats).toHaveLength(MIN_CHAPTERS);
  });
  it("clamps chapter counts above the maximum", () => {
    expect(curatedArc(50).chapterBeats).toHaveLength(MAX_CHAPTERS);
  });
  it("always supplies a premise and an ending", () => {
    const arc = curatedArc(5);
    expect(arc.arcPremise.length).toBeGreaterThan(0);
    expect(arc.endingBeat.length).toBeGreaterThan(0);
  });
});
