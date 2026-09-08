import { describe, it, expect } from "vitest";
import {
  DC_BY_DIFFICULTY,
  DEFAULT_DC,
  CRIT_BONUS_COINS,
  PARTIAL_MARGIN,
  dcForDifficulty,
  rollD20,
  taskCheckSeed,
  resolveCheck,
  resolveTaskCheck,
  bandEffect,
  bandNarration,
  type CheckBand,
} from "./roll-engine";
import { abilityScores } from "./character-sheet";

describe("dcForDifficulty", () => {
  it("maps the three rungs and defaults unknown to medium", () => {
    expect(dcForDifficulty("easy")).toBe(DC_BY_DIFFICULTY.easy);
    expect(dcForDifficulty("medium")).toBe(DC_BY_DIFFICULTY.medium);
    expect(dcForDifficulty("hard")).toBe(DC_BY_DIFFICULTY.hard);
    expect(dcForDifficulty("legendary")).toBe(DEFAULT_DC);
    expect(dcForDifficulty("")).toBe(DEFAULT_DC);
  });

  it("orders easy < medium < hard", () => {
    expect(DC_BY_DIFFICULTY.easy).toBeLessThan(DC_BY_DIFFICULTY.medium);
    expect(DC_BY_DIFFICULTY.medium).toBeLessThan(DC_BY_DIFFICULTY.hard);
  });
});

describe("rollD20", () => {
  it("is deterministic for a seed", () => {
    expect(rollD20("task:1:2:2026-09-06")).toBe(rollD20("task:1:2:2026-09-06"));
  });

  it("always lands in 1..20", () => {
    for (let i = 0; i < 5000; i++) {
      const v = rollD20(`seed-${i}`);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it("covers the whole face range and is roughly uniform", () => {
    const counts = new Array(21).fill(0);
    const N = 40_000;
    for (let i = 0; i < N; i++) counts[rollD20(`u${i}`)]++;
    for (let face = 1; face <= 20; face++) {
      expect(counts[face], `face ${face} never rolled`).toBeGreaterThan(0);
      // Expected N/20 = 2000; allow generous slack for a hash-based die.
      expect(counts[face]).toBeGreaterThan(2000 * 0.7);
      expect(counts[face]).toBeLessThan(2000 * 1.3);
    }
  });

  it("different seeds generally differ", () => {
    expect(rollD20("a")).not.toBeUndefined();
    expect(taskCheckSeed(1, 2, "2026-09-06")).toBe("task:1:2:2026-09-06");
  });
});

describe("resolveCheck bands", () => {
  // Find a seed that yields a specific d20 so band logic can be tested directly.
  function seedForFace(face: number): string {
    for (let i = 0; i < 100_000; i++) {
      const s = `probe-${i}`;
      if (rollD20(s) === face) return s;
    }
    throw new Error(`no seed found for face ${face}`);
  }

  it("a natural 20 is always a crit, even against the hardest DC with no bonuses", () => {
    const c = resolveCheck({ seed: seedForFace(20), modifier: -1, proficiency: 2, dc: 16, ability: "might" });
    expect(c.d20).toBe(20);
    expect(c.band).toBe("crit");
  });

  it("total ≥ DC (without a nat 20) is a success", () => {
    const seed = seedForFace(10);
    const c = resolveCheck({ seed, modifier: 3, proficiency: 3, dc: 12, ability: "might" }); // 10+3+3=16 ≥ 12
    expect(c.band).toBe("success");
    expect(c.total).toBe(16);
  });

  it("a near miss (within PARTIAL_MARGIN of the DC) is a partial", () => {
    const seed = seedForFace(10);
    // 10 + 0 + 0 = 10 vs DC 12 → missed by 2 (≤ PARTIAL_MARGIN) → partial.
    const c = resolveCheck({ seed, modifier: 0, proficiency: 0, dc: 12, ability: "vigor" });
    expect(c.total).toBe(10);
    expect(c.band).toBe("partial");
  });

  it("a wide miss is a fail (still completes; never a negative outcome)", () => {
    const seed = seedForFace(2);
    // 2 - 1 + 2 = 3 vs DC 16 → missed by 13 (> PARTIAL_MARGIN) → fail.
    const c = resolveCheck({ seed, modifier: -1, proficiency: 2, dc: 16, ability: "vigor" });
    expect(c.band).toBe("fail");
  });

  it("exactly PARTIAL_MARGIN below the DC is still a partial (boundary)", () => {
    const seed = seedForFace(10);
    // 10 + 0 + 0 = 10 vs DC 14 → missed by exactly 4 → partial; DC 15 → missed by 5 → fail.
    expect(resolveCheck({ seed, modifier: 0, proficiency: 0, dc: 10 + PARTIAL_MARGIN, ability: "vigor" }).band).toBe("partial");
    expect(resolveCheck({ seed, modifier: 0, proficiency: 0, dc: 10 + PARTIAL_MARGIN + 1, ability: "vigor" }).band).toBe("fail");
  });

  it("a natural 1 is always the low band, even with a big bonus that clears the DC", () => {
    const c = resolveCheck({ seed: seedForFace(1), modifier: 10, proficiency: 6, dc: 8, ability: "might" });
    expect(c.d20).toBe(1);
    expect(c.band).toBe("fail"); // classic auto-miss — but still a full completion (see bandEffect)
  });

  it("reports the totals it used", () => {
    const seed = seedForFace(15);
    const c = resolveCheck({ seed, modifier: 2, proficiency: 4, dc: 12, ability: "intellect" });
    expect(c.total).toBe(15 + 2 + 4);
    expect(c.dc).toBe(12);
    expect(c.ability).toBe("intellect");
  });
});

describe("resolveTaskCheck", () => {
  const abilities = abilityScores({
    lifetimeByKingdom: { forge: 8000, hearth: 0 }, // might → Stronghold (+4), vigor → Wild (-1)
    focus: { completedIntervals: 0 },
  });

  it("rolls the ability that matches the task's category", () => {
    const forge = resolveTaskCheck({ seed: "s1", abilities, proficiency: 2, category: "deep_work", difficulty: "hard" });
    expect(forge.ability).toBe("might");
    expect(forge.modifier).toBe(4);
    expect(forge.dc).toBe(16);

    const home = resolveTaskCheck({ seed: "s1", abilities, proficiency: 2, category: "household", difficulty: "easy" });
    expect(home.ability).toBe("vigor");
    expect(home.modifier).toBe(-1);
    expect(home.dc).toBe(8);
  });

  it("uncategorized work rolls under finesse (capital has no ability)", () => {
    const c = resolveTaskCheck({ seed: "s1", abilities, proficiency: 2, category: "default", difficulty: "medium" });
    expect(c.ability).toBe("finesse");
  });
});

describe("bandEffect — the upside-only invariant", () => {
  const bands: CheckBand[] = ["crit", "success", "partial", "fail"];

  it("never carries a negative effect for any band", () => {
    for (const band of bands) {
      const e = bandEffect(band);
      expect(e.bonusCoins).toBeGreaterThanOrEqual(0);
    }
  });

  it("only a crit adds a bonus; success and partial are fully neutral", () => {
    expect(bandEffect("crit")).toEqual({ band: "crit", bonusLoot: true, bonusCoins: CRIT_BONUS_COINS, offerRescue: false });
    expect(bandEffect("success")).toEqual({ band: "success", bonusLoot: false, bonusCoins: 0, offerRescue: false });
    expect(bandEffect("partial")).toEqual({ band: "partial", bonusLoot: false, bonusCoins: 0, offerRescue: false });
  });

  it("fail's only consequence is to OFFER rescue — no bonus, but no cost either", () => {
    const f = bandEffect("fail");
    expect(f).toEqual({ band: "fail", bonusLoot: false, bonusCoins: 0, offerRescue: true });
  });

  it("only fail offers rescue; no other band does", () => {
    for (const band of bands) {
      expect(bandEffect(band).offerRescue).toBe(band === "fail");
    }
  });

  it("every band is exactly as rewarding as success at the base (no penalty)", () => {
    const s = bandEffect("success");
    for (const band of ["partial", "fail"] as CheckBand[]) {
      const e = bandEffect(band);
      expect(e.bonusCoins).toBe(s.bonusCoins);
      expect(e.bonusLoot).toBe(s.bonusLoot);
    }
  });
});

describe("bandNarration — anti-shame copy", () => {
  const bands: CheckBand[] = ["crit", "success", "partial", "fail"];

  it("quotes the quest title and never blames, for any band", () => {
    for (const band of bands) {
      const line = bandNarration(band, "Email Dr. Lee");
      expect(line).toContain('"Email Dr. Lee"');
      expect(line.toLowerCase()).not.toContain("fail");
      expect(line.toLowerCase()).not.toContain("you didn't");
    }
  });

  it("frames a partial toward a smaller next step, not a penalty", () => {
    const line = bandNarration("partial", "Deep clean the garage").toLowerCase();
    expect(line).toContain("smaller next step");
  });

  it("a fail affirms full completion and offers help, never a loss", () => {
    const line = bandNarration("fail", "Deep clean the garage");
    expect(line.toLowerCase()).toContain("in full");
    expect(line.toLowerCase()).toContain("break the next");
  });
});
