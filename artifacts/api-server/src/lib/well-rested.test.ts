import { describe, it, expect } from "vitest";
import {
  WELL_RESTED_BONUS,
  WELL_RESTED_HOURS,
  wellRestedExpiry,
  isWellRested,
  wellRestedBonus,
  shouldGrantWellRested,
} from "./well-rested";
import { resolveCheck } from "./roll-engine";

describe("well-rested — upside-framed attrition", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  it("bonus is a positive flat number and the window is a day-plus", () => {
    expect(WELL_RESTED_BONUS).toBeGreaterThan(0);
    expect(WELL_RESTED_HOURS).toBeGreaterThanOrEqual(24);
  });

  it("wellRestedExpiry stamps now + WELL_RESTED_HOURS", () => {
    expect(wellRestedExpiry(now).getTime()).toBe(now.getTime() + WELL_RESTED_HOURS * 3600_000);
  });

  it("isWellRested is true only for a future expiry", () => {
    expect(isWellRested(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isWellRested(new Date(now.getTime() - 1000), now)).toBe(false);
    expect(isWellRested(null, now)).toBe(false);
  });

  it("wellRestedBonus is the flat bonus while active, else 0 — never negative", () => {
    expect(wellRestedBonus(new Date(now.getTime() + 1000), now)).toBe(WELL_RESTED_BONUS);
    expect(wellRestedBonus(new Date(now.getTime() - 1000), now)).toBe(0);
    expect(wellRestedBonus(null, now)).toBe(0);
  });

  it("granted only when the streak ADVANCES (a broken run grants nothing)", () => {
    expect(shouldGrantWellRested(5, 4)).toBe(true);   // kept the run into a new day
    expect(shouldGrantWellRested(1, 7)).toBe(false);  // streak reset
    expect(shouldGrantWellRested(4, 4)).toBe(false);  // same day, no advance
  });
});

describe("well-rested through the roll engine — upside-only + composable", () => {
  const base = { modifier: 0, proficiency: 2, dc: 12, ability: "might" as const };

  it("a rested bonus only ever raises the total", () => {
    for (let i = 0; i < 100; i++) {
      const seed = `rest-${i}`;
      const plain = resolveCheck({ ...base, seed });
      const rested = resolveCheck({ ...base, seed, restedBonus: WELL_RESTED_BONUS });
      expect(rested.total).toBe(plain.total + WELL_RESTED_BONUS);
      expect(rested.d20).toBe(plain.d20);
    }
  });

  it("composes additively with a consumable flat bonus", () => {
    const seed = "rest-plus-consumable";
    const plain = resolveCheck({ ...base, seed });
    const both = resolveCheck({ ...base, seed, boost: { kind: "bonus", amount: 3 }, restedBonus: WELL_RESTED_BONUS });
    expect(both.total).toBe(plain.total + 3 + WELL_RESTED_BONUS);
  });

  it("a negative restedBonus can never lower the roll (clamped)", () => {
    const seed = "rest-clamp";
    const plain = resolveCheck({ ...base, seed });
    const bad = resolveCheck({ ...base, seed, restedBonus: -5 });
    expect(bad.total).toBe(plain.total);
  });
});
