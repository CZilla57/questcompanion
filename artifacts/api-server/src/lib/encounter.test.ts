import { describe, it, expect } from "vitest";
import {
  BAND_DAMAGE_MULTIPLIER,
  BLOODIED_AT,
  WOUNDED_AT,
  damageForCheck,
  encounterView,
  encounterPhaseLabel,
  encounterStatusLine,
  type EncounterPhase,
} from "./encounter";
import type { CheckBand } from "./roll-engine";

describe("damageForCheck", () => {
  const bands: CheckBand[] = ["glancing", "success", "crit"];

  it("scales base power by the band, crit hardest", () => {
    expect(damageForCheck(100, "crit")).toBeGreaterThan(damageForCheck(100, "success"));
    expect(damageForCheck(100, "success")).toBeGreaterThan(damageForCheck(100, "glancing"));
    expect(damageForCheck(100, "crit")).toBe(150);
    expect(damageForCheck(100, "success")).toBe(100);
    expect(damageForCheck(100, "glancing")).toBe(60);
  });

  it("every hit lands — never below 1, even for tiny or zero power (upside-only)", () => {
    for (const band of bands) {
      expect(damageForCheck(0, band)).toBeGreaterThanOrEqual(1);
      expect(damageForCheck(1, band)).toBeGreaterThanOrEqual(1);
      expect(damageForCheck(-50, band)).toBeGreaterThanOrEqual(1);
    }
  });

  it("has a multiplier for each band and none is negative", () => {
    for (const band of bands) expect(BAND_DAMAGE_MULTIPLIER[band]).toBeGreaterThan(0);
  });
});

describe("encounterView", () => {
  it("computes remaining HP and percentage", () => {
    const v = encounterView(1000, 400);
    expect(v.hpRemaining).toBe(600);
    expect(v.percentRemaining).toBeCloseTo(0.6);
    expect(v.felled).toBe(false);
    expect(v.status).toBe("active");
  });

  it("phases by remaining fraction: fresh → bloodied → wounded → resting", () => {
    expect(encounterView(100, 0).phase).toBe("fresh");       // 100%
    expect(encounterView(100, 30).phase).toBe("fresh");      // 70% > 60%
    expect(encounterView(100, 50).phase).toBe("bloodied");   // 50%
    expect(encounterView(100, 80).phase).toBe("wounded");    // 20%
    expect(encounterView(100, 100).phase).toBe("resting");   // 0%
  });

  it("uses the documented thresholds", () => {
    // Just above / at the bloodied boundary.
    expect(encounterView(100, Math.round((1 - BLOODIED_AT) * 100) - 1).phase).toBe("fresh");
    expect(encounterView(100, Math.round((1 - BLOODIED_AT) * 100)).phase).toBe("bloodied");
    // At the wounded boundary.
    expect(encounterView(100, Math.round((1 - WOUNDED_AT) * 100)).phase).toBe("wounded");
  });

  it("never overfills or goes negative; extra damage can't raise remaining HP", () => {
    const v = encounterView(500, 900);
    expect(v.hpRemaining).toBe(0);
    expect(v.percentRemaining).toBe(0);
    expect(v.felled).toBe(true);
    expect(v.status).toBe("resting");

    let prev = Infinity;
    for (let d = 0; d <= 1200; d += 50) {
      const rem = encounterView(1000, d).hpRemaining;
      expect(rem).toBeLessThanOrEqual(prev);
      prev = rem;
    }
  });

  it("handles a zero-HP encounter without dividing by zero", () => {
    const v = encounterView(0, 0);
    expect(v.percentRemaining).toBe(0);
    expect(v.felled).toBe(true);
  });
});

describe("encounterPhaseLabel", () => {
  it("labels every phase", () => {
    const phases: EncounterPhase[] = ["fresh", "bloodied", "wounded", "resting"];
    for (const p of phases) expect(encounterPhaseLabel(p).length).toBeGreaterThan(0);
  });
});

describe("encounterStatusLine — anti-shame", () => {
  it("a felled encounter rests and hands the field to the player; never 'lost'/'failed'", () => {
    const felled = encounterView(100, 100);
    const line = encounterStatusLine(felled, "The Gloom").toLowerCase();
    expect(line).toContain("rest");
    expect(line).not.toContain("lost");
    expect(line).not.toContain("fail");
    expect(line).not.toContain("defeat");
  });

  it("a live encounter frames quests as blows landed, never nags", () => {
    for (const dmg of [0, 50, 80]) {
      const line = encounterStatusLine(encounterView(100, dmg), "The Gloom").toLowerCase();
      expect(line).not.toContain("fail");
      expect(line).not.toContain("you didn't");
    }
    expect(encounterStatusLine(encounterView(100, 0), "The Gloom")).toContain("The Gloom");
  });
});
