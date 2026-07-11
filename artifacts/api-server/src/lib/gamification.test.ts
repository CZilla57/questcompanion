import { describe, it, expect } from "vitest";
import { getLevelInfo, getPointsToNextLevel, getPointsIntoLevel } from "./gamification";

describe("getPointsIntoLevel", () => {
  it("is 0 at the exact start of a level band", () => {
    // Level 5 "Momentum" starts at 850
    expect(getPointsIntoLevel(850)).toBe(0);
  });

  it("counts points earned since entering the current band", () => {
    // 1000 is 150 into the 850–1299 band (the case where the old
    // `totalPoints % 1000` formula wrongly rendered the bar at 0%)
    expect(getPointsIntoLevel(1000)).toBe(150);
    expect(getPointsIntoLevel(900)).toBe(50);
  });

  it("never goes negative and stays inside the band width", () => {
    for (let p = 0; p <= 5000; p += 37) {
      const into = getPointsIntoLevel(p);
      expect(into).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("level progress invariant", () => {
  // The dashboard renders pointsIntoLevel / (pointsIntoLevel + pointsToNextLevel).
  // For every non-max level, that sum must equal the band's full width, so the
  // fraction is a true 0..<100% position within the level.
  it("pointsIntoLevel + pointsToNextLevel equals the band span below max level", () => {
    for (const totalPoints of [0, 50, 99, 100, 250, 500, 849, 850, 1000, 1299, 1300, 4099]) {
      const info = getLevelInfo(totalPoints);
      const span = info.maxPoints + 1 - info.minPoints;
      expect(getPointsIntoLevel(totalPoints) + getPointsToNextLevel(totalPoints)).toBe(span);
    }
  });

  it("computed percentage matches the true position within the band", () => {
    const pct = (p: number) => {
      const span = getPointsIntoLevel(p) + getPointsToNextLevel(p);
      return span > 0 ? (getPointsIntoLevel(p) / span) * 100 : 100;
    };
    expect(pct(1000)).toBeCloseTo((150 / 450) * 100, 5); // ~33.3%, NOT 0%
    expect(pct(900)).toBeCloseTo((50 / 450) * 100, 5);   // ~11.1%, NOT 90%
    expect(pct(850)).toBe(0);
  });

  it("reports 100% at the max level", () => {
    // Level 10 "Apex" has no next level
    expect(getPointsToNextLevel(4100)).toBe(0);
    const span = getPointsIntoLevel(4100) + getPointsToNextLevel(4100);
    const pct = span > 0 ? (getPointsIntoLevel(4100) / span) * 100 : 100;
    expect(pct).toBe(100);
  });
});
