import { describe, it, expect } from "vitest";
import { WORLD_BOSS, worldBossHp, dayKey, rollDamage, crossedThreshold } from "./world-boss";

describe("WORLD_BOSS consts", () => {
  it("exposes the tunable economy knobs", () => {
    expect(WORLD_BOSS.HP_PER_CONTRIBUTOR).toBe(300);
    expect(WORLD_BOSS.HP_MIN).toBe(300);
    expect(WORLD_BOSS.ATTACK_XP).toBe(15);
    expect(WORLD_BOSS.DEFEAT_COINS).toBe(50);
    expect(WORLD_BOSS.DEFEAT_XP).toBe(250);
  });
});

describe("worldBossHp", () => {
  it("scales linearly with prior-week active contributors", () => {
    expect(worldBossHp(1)).toBe(300);
    expect(worldBossHp(3)).toBe(900);
    expect(worldBossHp(10)).toBe(3000);
  });
  it("has no cap: big cohorts get proportionally big bosses", () => {
    expect(worldBossHp(17)).toBe(5100);  // above the old 5000 clamp
    expect(worldBossHp(300)).toBe(90000);
  });
  it("floors at HP_MIN so a quiet or first-ever week is solo-winnable", () => {
    expect(worldBossHp(0)).toBe(300);
  });
  it("sanitizes junk input to the floor", () => {
    expect(worldBossHp(-5)).toBe(300);
    expect(worldBossHp(Number.NaN)).toBe(300);
    expect(worldBossHp(2.9)).toBe(600); // fractional counts floor to ints
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
    expect(rollDamage(101, () => 0)).toBe(76);   // 101 * 0.75 = 75.75 → rounds up to 76
    expect(rollDamage(101, () => 1)).toBe(126);  // 101 * 1.25 = 126.25 → rounds down to 126
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
