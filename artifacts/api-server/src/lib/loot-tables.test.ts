import { describe, it, expect } from "vitest";
import { oddsForTier, rollLoot, lootSeed, LOOT_BONUS_COINS } from "./loot-tables";
import { seededUnit } from "./roll-engine";

const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 12];

describe("seededUnit", () => {
  it("is in [0,1) and deterministic for a fixed seed", () => {
    for (const s of ["a", "loot:1:2:3", "zzz"]) {
      const v = seededUnit(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(seededUnit(s)).toBe(v);
    }
  });

  it("varies across seeds", () => {
    expect(seededUnit("a")).not.toBe(seededUnit("b"));
  });
});

describe("oddsForTier", () => {
  it("rarity odds sum to <= 1 (the remainder is the bonus-coins slice)", () => {
    for (const t of TIERS) {
      const o = oddsForTier(t);
      const sum = o.legendary + o.epic + o.rare + o.common;
      expect(sum).toBeLessThanOrEqual(1 + 1e-9);
      expect(1 - sum).toBeGreaterThanOrEqual(-1e-9); // nothing-extra slice ≥ 0
    }
  });

  it("cumulative odds of at-least-rare are non-decreasing in tier (better foes, better loot)", () => {
    const atLeastRare = (t: number) => {
      const o = oddsForTier(t);
      return o.legendary + o.epic + o.rare;
    };
    for (let t = 1; t < 12; t++) {
      expect(atLeastRare(t + 1)).toBeGreaterThanOrEqual(atLeastRare(t));
    }
  });

  it("all odds are non-negative", () => {
    for (const t of TIERS) {
      const o = oddsForTier(t);
      for (const v of [o.legendary, o.epic, o.rare, o.common]) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("rollLoot (upside-only)", () => {
  it("is deterministic for a fixed seed", () => {
    const seed = lootSeed(1, 2, 3);
    expect(rollLoot({ tier: 3, seed })).toEqual(rollLoot({ tier: 3, seed }));
  });

  it("bonusCoins is never negative, and is 0 exactly when gear drops", () => {
    for (const t of TIERS) {
      for (let i = 0; i < 200; i++) {
        const res = rollLoot({ tier: t, seed: `s${t}:${i}` });
        expect(res.bonusCoins).toBeGreaterThanOrEqual(0);
        if (res.rarity === null) expect(res.bonusCoins).toBe(LOOT_BONUS_COINS);
        else expect(res.bonusCoins).toBe(0);
      }
    }
  });

  it("only ever yields a known rarity or null", () => {
    const valid = new Set(["legendary", "epic", "rare", "common", null]);
    for (let i = 0; i < 300; i++) {
      const res = rollLoot({ tier: 5, seed: `x${i}` });
      expect(valid.has(res.rarity)).toBe(true);
    }
  });

  it("higher tiers empirically drop gear at least as often (monotone by sampling)", () => {
    const gearRate = (t: number) => {
      let hits = 0;
      const N = 4000;
      for (let i = 0; i < N; i++) if (rollLoot({ tier: t, seed: `rate${t}:${i}` }).rarity !== null) hits++;
      return hits / N;
    };
    // Compare tier bands (1 vs 4 vs 7); sampling tolerance is generous.
    expect(gearRate(4)).toBeGreaterThan(gearRate(1) - 0.05);
    expect(gearRate(7)).toBeGreaterThan(gearRate(4) - 0.05);
  });
});
