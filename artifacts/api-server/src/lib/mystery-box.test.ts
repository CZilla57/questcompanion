import { describe, it, expect } from "vitest";
import {
  MYSTERY_COST,
  mysteryBonus,
  canOpenMystery,
  rollMystery,
} from "./mystery-box";

describe("MYSTERY_COST", () => {
  it("is the fixed, cheaper-than-a-Small-tier pull cost", () => {
    expect(MYSTERY_COST).toBe(15);
  });
});

describe("mysteryBonus", () => {
  it("no bonus on the common low band", () => {
    expect(mysteryBonus(0)).toBe(0);
    expect(mysteryBonus(0.3)).toBe(0);
    expect(mysteryBonus(0.599)).toBe(0);
  });
  it("small band starts at 0.60", () => {
    expect(mysteryBonus(0.6)).toBe(5);
    expect(mysteryBonus(0.75)).toBe(5);
    expect(mysteryBonus(0.899)).toBe(5);
  });
  it("medium band starts at 0.90", () => {
    expect(mysteryBonus(0.9)).toBe(10);
    expect(mysteryBonus(0.95)).toBe(10);
    expect(mysteryBonus(0.989)).toBe(10);
  });
  it("jackpot band starts at 0.99, capped at the cost (free pull, never a net gain)", () => {
    expect(mysteryBonus(0.99)).toBe(15);
    expect(mysteryBonus(0.9999)).toBe(15);
    expect(mysteryBonus(MYSTERY_COST)).toBeLessThanOrEqual(MYSTERY_COST);
  });
});

describe("canOpenMystery", () => {
  it("no_rewards when the menu is empty (takes precedence over insufficient)", () => {
    expect(canOpenMystery(0, 0)).toEqual({ canOpen: false, reason: "no_rewards", remaining: 0 });
    expect(canOpenMystery(1000, 0)).toEqual({ canOpen: false, reason: "no_rewards", remaining: 0 });
  });
  it("insufficient below cost, with the remaining gap (never negative)", () => {
    expect(canOpenMystery(0, 3)).toEqual({ canOpen: false, reason: "insufficient", remaining: 15 });
    expect(canOpenMystery(10, 3)).toEqual({ canOpen: false, reason: "insufficient", remaining: 5 });
    expect(canOpenMystery(14, 1)).toEqual({ canOpen: false, reason: "insufficient", remaining: 1 });
  });
  it("ok at or above cost with a non-empty menu, remaining 0", () => {
    expect(canOpenMystery(15, 1)).toEqual({ canOpen: true, reason: "ok", remaining: 0 });
    expect(canOpenMystery(999, 5)).toEqual({ canOpen: true, reason: "ok", remaining: 0 });
  });
});

describe("rollMystery", () => {
  it("uses the first rng draw to pick the reward index, the second to roll the bonus", () => {
    const draws = [0.0, 0.0]; // index 0, bonus 0
    let i = 0;
    const rng = () => draws[i++]!;
    expect(rollMystery(4, rng)).toEqual({ rewardIndex: 0, bonus: 0 });
  });
  it("selects a uniform index across the pool", () => {
    // 0.5 * 4 = 2.0 -> floor 2
    expect(rollMystery(4, mkRng([0.5, 0.0]))).toEqual({ rewardIndex: 2, bonus: 0 });
    // 0.999 * 4 = 3.996 -> floor 3 (never out of range)
    expect(rollMystery(4, mkRng([0.999, 0.0]))).toEqual({ rewardIndex: 3, bonus: 0 });
  });
  it("applies the bonus table to the second draw", () => {
    expect(rollMystery(1, mkRng([0.0, 0.99])).bonus).toBe(15);
    expect(rollMystery(2, mkRng([0.0, 0.6])).bonus).toBe(5);
  });
});

function mkRng(draws: number[]): () => number {
  let i = 0;
  return () => draws[i++]!;
}
