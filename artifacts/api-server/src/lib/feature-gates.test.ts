import { describe, expect, it } from "vitest";
import {
  FEATURE_GATES, FEATURE_KEYS, effectiveLevel, isFeatureUnlocked, newlyUnlocked, unlockedFeatures,
} from "./feature-gates";

const fresh = (totalPoints: number, highestLevel = 1) =>
  ({ totalPoints, highestLevel, unlockAll: false });
const grandfathered = { totalPoints: 0, highestLevel: 1, unlockAll: true };

describe("effectiveLevel", () => {
  it("is the derived level when the floor is below it", () => {
    expect(effectiveLevel({ totalPoints: 250, highestLevel: 1 })).toBe(3);
  });
  it("is the floor when XP reversal dropped the derived level (monotonic)", () => {
    expect(effectiveLevel({ totalPoints: 99, highestLevel: 2 })).toBe(2);
  });
});

describe("unlockedFeatures", () => {
  it("is empty at L1 for a fresh account", () => {
    expect(unlockedFeatures(fresh(0))).toEqual([]);
  });
  it("opens exactly the charter ladder as levels rise", () => {
    expect(unlockedFeatures(fresh(100))).toEqual(["focus"]);
    expect(unlockedFeatures(fresh(250))).toEqual(["focus", "hero"]);
    expect(unlockedFeatures(fresh(500))).toEqual(["focus", "hero", "progress", "campaigns"]);
    expect(unlockedFeatures(fresh(850))).toEqual(["focus", "hero", "progress", "allies", "campaigns"]);
    expect(unlockedFeatures(fresh(1300))).toEqual([...FEATURE_KEYS]);
  });
  it("gives grandfathered users everything regardless of XP", () => {
    expect(unlockedFeatures(grandfathered)).toEqual([...FEATURE_KEYS]);
  });
  it("keeps a floored feature open after XP reversal", () => {
    expect(unlockedFeatures(fresh(99, 2))).toEqual(["focus"]);
  });
});

describe("isFeatureUnlocked", () => {
  it("matches the list", () => {
    expect(isFeatureUnlocked(fresh(100), "focus")).toBe(true);
    expect(isFeatureUnlocked(fresh(100), "hero")).toBe(false);
    expect(isFeatureUnlocked(grandfathered, "rewards")).toBe(true);
  });
});

describe("newlyUnlocked", () => {
  it("reports the gate crossed by an award", () => {
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 1 }, 1, 2)).toEqual(["focus"]);
  });
  it("reports multiple gates when a big award skips levels", () => {
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 1 }, 1, 4)).toEqual(["focus", "hero", "progress", "campaigns"]);
  });
  it("is ALWAYS empty for grandfathered users (they had everything)", () => {
    expect(newlyUnlocked({ unlockAll: true, highestLevel: 1 }, 1, 6)).toEqual([]);
  });
  it("does not re-celebrate a re-crossed gate the floor already holds", () => {
    // uncomplete dropped derived 2→1 with floor 2; re-crossing 1→2 is not new
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 2 }, 1, 2)).toEqual([]);
  });
  it("is empty when no gate sits inside the crossed range", () => {
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 1 }, 2, 2)).toEqual([]);
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 1 }, 6, 10)).toEqual([]);
  });
});

describe("gate table", () => {
  it("pins the charter ladder", () => {
    expect(FEATURE_GATES).toEqual({ focus: 2, hero: 3, progress: 4, allies: 5, rewards: 6, campaigns: 4 });
  });
});

describe("campaigns gate (Act VI Quest Campaigns)", () => {
  const user = (totalPoints: number) => ({ totalPoints, highestLevel: 0, unlockAll: false });

  it("is locked below level 4", () => {
    expect(isFeatureUnlocked(user(0), "campaigns")).toBe(false);
  });
  it("unlocks at the same band as progress", () => {
    expect(FEATURE_GATES.campaigns).toBe(FEATURE_GATES.progress);
  });
  it("is included for grandfathered users", () => {
    expect(unlockedFeatures({ totalPoints: 0, highestLevel: 0, unlockAll: true })).toContain("campaigns");
  });
});
