import { describe, it, expect } from "vitest";
import { companionLine, companionReactionLine } from "./companion-copy";
import type { CompanionBeat } from "./companion";

const now = new Date("2026-07-17T12:00:00Z");
const beat = (kind: CompanionBeat["kind"], over: Partial<CompanionBeat> = {}): CompanionBeat =>
  ({ kind, streakDays: 0, bondTier: 0, ...over });

describe("companionLine", () => {
  it("returns an empty string for quiet (defers to hunger)", () => {
    expect(companionLine(beat("quiet"), { userId: 1, now })).toBe("");
  });
  it("returns a non-empty line for every visible beat", () => {
    for (const k of ["welcome_back", "streak_milestone", "rest_day", "ambient"] as const) {
      expect(companionLine(beat(k, { streakDays: 7, bondTier: 2 }), { userId: 1, now }).length).toBeGreaterThan(0);
    }
  });
  it("interpolates the streak count into a milestone line", () => {
    const line = companionLine(beat("streak_milestone", { streakDays: 30 }), { userId: 1, now });
    expect(line).toContain("30");
  });
  it("is deterministic for the same user + 3h bucket", () => {
    const a = companionLine(beat("ambient", { bondTier: 1 }), { userId: 42, now });
    const b = companionLine(beat("ambient", { bondTier: 1 }), { userId: 42, now });
    expect(a).toBe(b);
  });
  it("welcome_back copy is warm — never guilt/shame language", () => {
    // Sample across users to cover the whole pool.
    for (let u = 0; u < 20; u++) {
      const line = companionLine(beat("welcome_back"), { userId: u, now }).toLowerCase();
      expect(line).not.toMatch(/miss(ed)? \d|fail|behind|lost your|broke|guilt|should have/);
    }
  });
});

describe("companionReactionLine", () => {
  it("names the new tier on a bond tier-up", () => {
    expect(companionReactionLine("bond_tier_up", { userId: 1, now, bondTierName: "Kindred" }))
      .toContain("Kindred");
  });
  it("names the new level on a level-up", () => {
    expect(companionReactionLine("leveled_up", { userId: 1, now, newLevel: 12 })).toContain("12");
  });
});
