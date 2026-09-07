import { describe, it, expect } from "vitest";
import { salvageValue, SALVAGE_VALUE } from "./salvage";
import { gearCoinCost } from "./coins";
import type { GearRarity } from "@workspace/db";

const RARITIES: GearRarity[] = ["common", "rare", "epic", "legendary"];

describe("salvageValue", () => {
  it("returns the concrete published ladder", () => {
    expect(salvageValue("common")).toBe(8);
    expect(salvageValue("rare")).toBe(24);
    expect(salvageValue("epic")).toBe(60);
    expect(salvageValue("legendary")).toBe(160);
  });

  it("is always at least 1 coin (giving up an item is never worthless)", () => {
    for (const r of RARITIES) expect(salvageValue(r)).toBeGreaterThanOrEqual(1);
  });

  it("NO ARBITRAGE: salvage value is strictly less than the buy cost", () => {
    for (const r of RARITIES) {
      expect(salvageValue(r)).toBeLessThan(gearCoinCost(r));
    }
  });

  it("increases monotonically with rarity", () => {
    for (let i = 1; i < RARITIES.length; i++) {
      expect(salvageValue(RARITIES[i])).toBeGreaterThan(salvageValue(RARITIES[i - 1]));
    }
  });

  it("the exported table matches the function for every rarity", () => {
    for (const r of RARITIES) expect(SALVAGE_VALUE[r]).toBe(salvageValue(r));
  });
});
