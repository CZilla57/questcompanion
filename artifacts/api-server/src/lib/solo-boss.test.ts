import { describe, it, expect } from "vitest";
import { BOSS_POWER_RATIO, getBossPower } from "./solo-boss";

describe("getBossPower", () => {
  it("scales to the player, not the calendar", () => {
    expect(getBossPower(69)).toBe(66);   // Chad's W29 power → a fair fight, not 750
    expect(getBossPower(35)).toBe(33);   // fresh level-1 hero (30 + 5, no gear)
    expect(getBossPower(600)).toBe(570); // late-game player
  });

  it("is monotonic in player power", () => {
    let prev = 0;
    for (let p = 1; p <= 1000; p++) {
      const b = getBossPower(p);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it("every player's best roll beats the boss (winnable at all power levels)", () => {
    for (let p = 1; p <= 1000; p++) {
      const bestRoll = Math.round(p * 1.25);
      expect(bestRoll).toBeGreaterThanOrEqual(getBossPower(p));
    }
  });

  it("every player's worst roll loses to the boss (the fight keeps teeth)", () => {
    for (let p = 10; p <= 1000; p++) {
      const worstRoll = Math.round(p * 0.75);
      expect(worstRoll).toBeLessThan(getBossPower(p));
    }
  });

  it("pitches the win chance at ~60% under the [0.75, 1.25] roll", () => {
    // P(win) = (1.25 − ratio) / 0.5 — the one balance knob, kept explicit.
    expect((1.25 - BOSS_POWER_RATIO) / 0.5).toBeCloseTo(0.6);
  });
});
