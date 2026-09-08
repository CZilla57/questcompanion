import { describe, it, expect } from "vitest";
import {
  CONSUMABLES,
  consumableById,
  isConsumableId,
  boostFor,
} from "./consumables";
import { resolveCheck } from "./roll-engine";

describe("consumables catalog", () => {
  it("has unique ids, positive costs, and a boost each", () => {
    const ids = new Set(CONSUMABLES.map((c) => c.id));
    expect(ids.size).toBe(CONSUMABLES.length);
    for (const c of CONSUMABLES) {
      expect(c.coinCost).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.boost).toBeTruthy();
    }
  });

  it("consumableById / isConsumableId resolve known ids and reject junk", () => {
    expect(consumableById("focus_draught")?.name).toBe("Focus Draught");
    expect(consumableById("nope")).toBeUndefined();
    expect(isConsumableId("lucky_clover")).toBe(true);
    expect(isConsumableId("nope")).toBe(false);
    expect(isConsumableId(null)).toBe(false);
  });

  it("boostFor maps a queued id to its boost; null/unknown → undefined", () => {
    expect(boostFor("focus_draught")).toEqual({ kind: "bonus", amount: 3 });
    expect(boostFor(null)).toBeUndefined();
    expect(boostFor("nope")).toBeUndefined();
  });

  it("every catalog boost is upside-only against the roll engine (never lowers)", () => {
    const base = { modifier: 0, proficiency: 2, dc: 12, ability: "might" as const };
    for (let i = 0; i < 100; i++) {
      const seed = `cons-${i}`;
      const plain = resolveCheck({ ...base, seed });
      for (const c of CONSUMABLES) {
        const boosted = resolveCheck({ ...base, seed, boost: c.boost });
        expect(boosted.d20).toBeGreaterThanOrEqual(plain.d20);
        expect(boosted.total).toBeGreaterThanOrEqual(plain.total);
      }
    }
  });
});
