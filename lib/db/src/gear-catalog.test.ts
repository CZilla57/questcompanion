import { describe, it, expect } from "vitest";
import { GEAR_CATALOG } from "./gear-catalog";

const ABILITIES = ["might", "intellect", "attunement", "presence", "vigor", "finesse"] as const;

describe("gear catalog stat_mods", () => {
  it("gives common items no ability mod (statPower only)", () => {
    for (const item of GEAR_CATALOG.filter((i) => i.rarity === "common")) {
      expect(item.statMods, item.name).toEqual({});
    }
  });

  it("gives every rare+ item exactly one even ability mod in [2,4]", () => {
    for (const item of GEAR_CATALOG.filter((i) => i.rarity !== "common")) {
      const entries = Object.entries(item.statMods);
      expect(entries.length, item.name).toBe(1);
      const [, bonus] = entries[0]!;
      expect(bonus % 2, item.name).toBe(0);
      expect(bonus, item.name).toBeGreaterThanOrEqual(2);
      expect(bonus, item.name).toBeLessThanOrEqual(4);
    }
  });

  it("covers all six abilities on low-level (≤5) in-store gear — none is un-boostable", () => {
    const covered = new Set<string>();
    for (const item of GEAR_CATALOG.filter((i) => i.inStore && i.levelRequired <= 5)) {
      for (const a of Object.keys(item.statMods)) covered.add(a);
    }
    for (const a of ABILITIES) expect(covered.has(a), `ability ${a} uncovered`).toBe(true);
  });

  it("the weapon slot spans at least three abilities (a real weapon decision)", () => {
    const weaponAbilities = new Set<string>();
    for (const item of GEAR_CATALOG.filter((i) => i.slot === "weapon" && i.rarity !== "common")) {
      for (const a of Object.keys(item.statMods)) weaponAbilities.add(a);
    }
    expect(weaponAbilities.size).toBeGreaterThanOrEqual(3);
  });
});
