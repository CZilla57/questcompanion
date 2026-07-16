import { describe, it, expect } from "vitest";
import { WORLD_BOSS, worldBossHp, dayKey, rollDamage, crossedThreshold } from "./world-boss";

describe("WORLD_BOSS consts", () => {
  it("exposes the tunable economy knobs", () => {
    expect(WORLD_BOSS.HP_BASE).toBe(1500);
    expect(WORLD_BOSS.HP_STEP).toBe(300);
    expect(WORLD_BOSS.HP_CAP).toBe(5000);
    expect(WORLD_BOSS.ATTACK_XP).toBe(15);
    expect(WORLD_BOSS.DEFEAT_COINS).toBe(50);
    expect(WORLD_BOSS.DEFEAT_XP).toBe(250);
  });
});

describe("worldBossHp", () => {
  it("is HP_BASE in week 1 and escalates by HP_STEP per week", () => {
    expect(worldBossHp("2026-W01")).toBe(1500);
    expect(worldBossHp("2026-W02")).toBe(1800);
    expect(worldBossHp("2026-W10")).toBe(1500 + 9 * 300); // 4200
  });
  it("clamps at HP_CAP", () => {
    expect(worldBossHp("2026-W52")).toBe(5000);
  });
  it("falls back to base when the week number can't be parsed", () => {
    expect(worldBossHp("garbage")).toBe(1500);
  });
});

describe("dayKey", () => {
  it("formats the UTC date as YYYY-MM-DD", () => {
    expect(dayKey(new Date(Date.UTC(2026, 6, 5, 23, 59)))).toBe("2026-07-05");
    expect(dayKey(new Date(Date.UTC(2026, 11, 31, 0, 0)))).toBe("2026-12-31");
  });
});

describe("rollDamage", () => {
  it("is 75% of power at the low roll and 125% at the high roll", () => {
    expect(rollDamage(200, () => 0)).toBe(150);   // 200 * 0.75
    expect(rollDamage(200, () => 1)).toBe(250);   // 200 * 1.25
  });
  it("rounds to an integer", () => {
    expect(rollDamage(101, () => 0.5)).toBe(Math.round(101)); // 101 * 1.0
  });
  it("never returns negative for zero power", () => {
    expect(rollDamage(0, () => 0)).toBe(0);
  });
});

describe("crossedThreshold", () => {
  it("true only when this attack takes the total from below hp to >= hp", () => {
    expect(crossedThreshold(1400, 1550, 1500)).toBe(true);
    expect(crossedThreshold(1500, 1600, 1500)).toBe(false); // already at/over before
    expect(crossedThreshold(1000, 1400, 1500)).toBe(false); // still short
    expect(crossedThreshold(1499, 1500, 1500)).toBe(true);  // exact landing
  });
});
