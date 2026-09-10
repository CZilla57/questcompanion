import { describe, it, expect } from "vitest";
import {
  PER_ABILITY_CAP,
  gearAbilityBonus,
  equippedAbilityMods,
  gearModifierFor,
} from "./gear-mods";

describe("gearAbilityBonus — rarity-only, even", () => {
  it("maps rarity to even score bonuses (common carries none)", () => {
    expect(gearAbilityBonus("common")).toBe(0);
    expect(gearAbilityBonus("rare")).toBe(2);
    expect(gearAbilityBonus("epic")).toBe(2);
    expect(gearAbilityBonus("legendary")).toBe(4);
  });
  it("is always even and never negative", () => {
    for (const r of ["common", "rare", "epic", "legendary"] as const) {
      const b = gearAbilityBonus(r);
      expect(b % 2).toBe(0);
      expect(b).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("equippedAbilityMods — sum then cap", () => {
  it("returns nothing for no equipped gear (unequip is neutral)", () => {
    expect(equippedAbilityMods([])).toEqual({});
  });
  it("sums same-ability items", () => {
    expect(equippedAbilityMods([{ statMods: { intellect: 2 } }, { statMods: { intellect: 2 } }]))
      .toEqual({ intellect: 4 });
  });
  it("clamps a single ability to the per-ability cap", () => {
    expect(equippedAbilityMods([
      { statMods: { might: 4 } }, { statMods: { might: 4 } },
    ])).toEqual({ might: PER_ABILITY_CAP });
  });
  it("keeps distinct abilities separate", () => {
    expect(equippedAbilityMods([{ statMods: { might: 2, finesse: 2 } }, { statMods: { finesse: 2 } }]))
      .toEqual({ might: 2, finesse: 4 });
  });
  it("is monotonic — adding gear never lowers an ability", () => {
    const base = equippedAbilityMods([{ statMods: { vigor: 2 } }]);
    const more = equippedAbilityMods([{ statMods: { vigor: 2 } }, { statMods: { vigor: 2 } }]);
    expect(more.vigor!).toBeGreaterThanOrEqual(base.vigor!);
  });
});

describe("gearModifierFor — score bonus to modifier", () => {
  it("halves the (even) score bonus into a modifier term", () => {
    expect(gearModifierFor({ intellect: 2 }, "intellect")).toBe(1);
    expect(gearModifierFor({ intellect: 4 }, "intellect")).toBe(2);
    expect(gearModifierFor({}, "intellect")).toBe(0);
  });
});
