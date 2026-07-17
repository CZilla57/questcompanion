import { describe, it, expect } from "vitest";
import { buildRecapPrompt, fallbackNarrative, draftNarrative, MAX_NARRATIVE_LENGTH } from "./weekly-recap";
import { containsGuiltLanguage } from "./reflection";
import type { WeekStats } from "@workspace/db";

function stats(overrides: Partial<WeekStats> = {}): WeekStats {
  return {
    weekKey: "2026-W29",
    questsCompleted: 3,
    sampleQuestTitles: ["Fold laundry", "Ship report"],
    focusSessions: 2,
    focusMinutes: 45,
    xpEarned: 120,
    coinsEarned: 15,
    initiations: 4,
    levelUps: 0,
    badges: [],
    questlinesCompleted: [],
    boss: null,
    rhythms: null,
    ...overrides,
  };
}

describe("buildRecapPrompt", () => {
  it("grounds only in nonzero facts and carries the hard rules", () => {
    const prompt = buildRecapPrompt(stats({ levelUps: 0, coinsEarned: 0 }));
    expect(prompt).toContain("Quests completed: 3");
    expect(prompt).toContain('"Fold laundry"');
    expect(prompt).toContain("Focused minutes: 45");
    expect(prompt).not.toContain("Level-ups");
    expect(prompt).not.toContain("Coins earned");
    expect(prompt).toContain("NEVER mention unfinished");
    expect(prompt).toContain("NEVER compare this week to any other week");
    expect(prompt).toContain('{"narrative": "..."}');
  });

  it("includes boss and rhythms blocks when present", () => {
    const prompt = buildRecapPrompt(stats({
      boss: { damage: 40, attacks: 3, defeated: true },
      rhythms: { powerHours: [9, 14], bestDay: 2, topHelpers: ["timer"] },
    }));
    expect(prompt).toContain("dealt 40 damage");
    expect(prompt).toContain("boss FELL");
    expect(prompt).toContain("9, 14");
    expect(prompt).toContain("Tuesday");
  });

  it("renders topHelpers as human labels, never raw chip keys — the model must never see enum values", () => {
    const prompt = buildRecapPrompt(stats({
      rhythms: { powerHours: [], bestDay: null, topHelpers: ["small_steps", "body_double"] },
    }));
    expect(prompt).toContain("Small steps");
    expect(prompt).toContain("Someone with me");
    expect(prompt).not.toContain("small_steps");
    expect(prompt).not.toContain("body_double");
  });
});

describe("fallbackNarrative", () => {
  it("is deterministic per user+week and varies across seeds", () => {
    const a = fallbackNarrative(1, "2026-W29", stats());
    expect(fallbackNarrative(1, "2026-W29", stats())).toBe(a);
    const variants = new Set(Array.from({ length: 12 }, (_, i) => fallbackNarrative(i, "2026-W29", stats())));
    expect(variants.size).toBeGreaterThan(1);
  });

  it("never contains guilt language, for any seed", () => {
    for (let userId = 0; userId < 20; userId++) {
      expect(containsGuiltLanguage(fallbackNarrative(userId, "2026-W29", stats()))).toBe(false);
    }
  });

  it("mentions the week's actual wins", () => {
    const text = fallbackNarrative(1, "2026-W29", stats({ questsCompleted: 3, focusMinutes: 45 }));
    expect(text).toContain("3 quest");
    expect(text).toContain("45 focused minute");
  });
});

describe("draftNarrative", () => {
  it("uses the model when it behaves", async () => {
    const result = await draftNarrative(stats(), 1, "2026-W29", async () => ({ narrative: "A steady, real week of showing up." }));
    expect(result).toEqual({ narrative: "A steady, real week of showing up.", source: "ai" });
  });

  it("falls back when the model emits guilt language, overlong text, or garbage", async () => {
    for (const bad of [
      async () => ({ narrative: "You only did three things." }),
      async () => ({ narrative: "x".repeat(MAX_NARRATIVE_LENGTH + 1) }),
      async () => ({ wrong: "shape" }),
      async () => { throw new Error("503"); },
    ]) {
      const result = await draftNarrative(stats(), 1, "2026-W29", bad as never);
      expect(result.source).toBe("fallback");
      expect(containsGuiltLanguage(result.narrative)).toBe(false);
    }
  });

  it("falls back immediately with no generator", async () => {
    expect((await draftNarrative(stats(), 1, "2026-W29", null)).source).toBe("fallback");
  });
});
