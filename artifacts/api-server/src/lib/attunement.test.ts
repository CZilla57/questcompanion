import { describe, it, expect } from "vitest";
import { ATTUNEMENT_CAP, isAttunable, attunementBonus, gearPower, type PowerGear } from "./attunement";
import type { GearRarity } from "@workspace/db";

const RARITIES: GearRarity[] = ["common", "rare", "epic", "legendary"];

describe("attunement constants", () => {
  it("caps attunement at 3 (the 5e cap)", () => {
    expect(ATTUNEMENT_CAP).toBe(3);
  });
});

describe("isAttunable", () => {
  it("is true only for epic and legendary", () => {
    expect(isAttunable("common")).toBe(false);
    expect(isAttunable("rare")).toBe(false);
    expect(isAttunable("epic")).toBe(true);
    expect(isAttunable("legendary")).toBe(true);
  });
});

describe("attunementBonus", () => {
  it("is half the stat power, rounded up", () => {
    expect(attunementBonus(10)).toBe(5);
    expect(attunementBonus(9)).toBe(5);
    expect(attunementBonus(1)).toBe(1);
  });
});

describe("gearPower", () => {
  const g = (statPower: number, rarity: GearRarity, attuned: boolean): PowerGear =>
    ({ statPower, rarity, attuned });

  it("is the plain stat sum when nothing is attuned", () => {
    const items = [g(10, "legendary", false), g(6, "rare", false), g(4, "common", false)];
    expect(gearPower(items)).toBe(20);
  });

  it("adds the bonus only for attuned attunable items", () => {
    // legendary 10 attuned → +5; epic 8 not attuned → +0; rare 6 attuned but not attunable → +0
    const items = [g(10, "legendary", true), g(8, "epic", false), g(6, "rare", true)];
    expect(gearPower(items)).toBe(10 + 5 + 8 + 6);
  });

  it("defensively ignores an attuned non-attunable item", () => {
    expect(gearPower([g(6, "common", true)])).toBe(6);
    expect(gearPower([g(6, "rare", true)])).toBe(6);
  });

  it("UPSIDE-ONLY: is always >= the plain stat sum", () => {
    for (const rarity of RARITIES) {
      for (const attuned of [true, false]) {
        const items = [g(10, rarity, attuned), g(5, rarity, attuned)];
        const base = items.reduce((s, it) => s + it.statPower, 0);
        expect(gearPower(items)).toBeGreaterThanOrEqual(base);
      }
    }
  });

  it("is zero for an empty loadout", () => {
    expect(gearPower([])).toBe(0);
  });
});
