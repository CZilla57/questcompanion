import { describe, it, expect } from "vitest";
import { buildBeatPrompt, fallbackBeat, parseBeat, draftBeat, MAX_BEAT_LENGTH } from "./dungeon-master";
import { containsGuiltLanguage } from "./reflection";
import type { DmBeatFacts } from "@workspace/db";

function facts(overrides: Partial<DmBeatFacts> = {}): DmBeatFacts {
  return {
    completedTitles: [],
    plannedTitles: [],
    kingdomGrowth: [],
    focusMinutes: 0,
    streakDays: 0,
    chapterBeat: null,
    ...overrides,
  };
}

describe("buildBeatPrompt", () => {
  it("quotes real titles and states the no-fabrication rule", () => {
    const p = buildBeatPrompt("camp", facts({ completedTitles: ['Ship "the" report', "Fold laundry"] }));
    expect(p).toContain("no fabrication");
    expect(p).toContain('"Fold laundry"');
    expect(p).toContain('{"beat": "..."}');
  });

  it("morning frames plans as invitations, not obligations", () => {
    const p = buildBeatPrompt("morning", facts({ plannedTitles: ["Email Sam"] }));
    expect(p).toMatch(/invitation/i);
    expect(p).toContain('"Email Sam"');
  });
});

describe("parseBeat — no-fabrication guard", () => {
  const f = facts({ completedTitles: ["Fold laundry"], plannedTitles: ["Email Sam"] });

  it("accepts a beat that only quotes real titles", () => {
    expect(parseBeat({ beat: 'You cleared "Fold laundry" by the fire.' }, f, "camp"))
      .toBe('You cleared "Fold laundry" by the fire.');
  });

  it("accepts a beat that quotes no titles at all", () => {
    expect(parseBeat({ beat: "The party rests after a full day." }, f, "camp"))
      .toBe("The party rests after a full day.");
  });

  it("matches titles case-insensitively", () => {
    expect(parseBeat({ beat: 'You cleared "fold laundry".' }, f, "camp")).toContain("fold laundry");
  });

  it("REJECTS a fabricated quoted quest", () => {
    expect(() => parseBeat({ beat: 'You slew "the Dragon of Ards".' }, f, "camp"))
      .toThrow(/fabricated/);
  });

  it("rejects guilt language", () => {
    expect(() => parseBeat({ beat: "You only managed a little today." }, f, "camp"))
      .toThrow(/guilt/);
  });

  it("rejects empty or over-length output", () => {
    expect(() => parseBeat({ beat: "" }, f, "camp")).toThrow();
    expect(() => parseBeat({ beat: "x".repeat(MAX_BEAT_LENGTH + 1) }, f, "camp")).toThrow(/over/);
  });

  it("rejects a non-string beat", () => {
    expect(() => parseBeat({ beat: 42 }, f, "camp")).toThrow(/missing string/);
    expect(() => parseBeat(null, f, "camp")).toThrow(/missing string/);
  });
});

describe("fallbackBeat", () => {
  it("is deterministic for a given user + date + kind", () => {
    const f = facts({ plannedTitles: ["Email Sam"] });
    expect(fallbackBeat("morning", 7, "2026-09-06", f)).toBe(fallbackBeat("morning", 7, "2026-09-06", f));
  });

  it("only ever names real titles (obeys no-fabrication too)", () => {
    const f = facts({ completedTitles: ["Fold laundry"] });
    const beat = fallbackBeat("camp", 1, "2026-09-06", f);
    // The only quoted phrase must be the real title.
    expect(beat).toContain('"Fold laundry"');
    for (const m of beat.matchAll(/"([^"]+)"/g)) expect(f.completedTitles).toContain(m[1]);
  });

  it("never contains guilt language across many inputs", () => {
    for (let u = 0; u < 30; u++) {
      const morning = fallbackBeat("morning", u, "2026-09-06", facts({ plannedTitles: ["A", "B", "C"] }));
      const camp = fallbackBeat("camp", u, "2026-09-06", facts({ completedTitles: ["A"], kingdomGrowth: ["the Forge reached Outpost"] }));
      expect(containsGuiltLanguage(morning)).toBe(false);
      expect(containsGuiltLanguage(camp)).toBe(false);
      expect(morning.length).toBeLessThanOrEqual(MAX_BEAT_LENGTH);
      expect(camp.length).toBeLessThanOrEqual(MAX_BEAT_LENGTH);
    }
  });

  it("handles an empty day without inventing a quest", () => {
    const beat = fallbackBeat("camp", 1, "2026-09-06", facts());
    expect(beat).not.toContain('"');
    expect(beat.length).toBeGreaterThan(0);
  });
});

describe("draftBeat", () => {
  const f = facts({ completedTitles: ["Fold laundry"] });

  it("uses the fallback when no generator is configured", async () => {
    const r = await draftBeat("camp", f, 1, "2026-09-06", null);
    expect(r.source).toBe("fallback");
  });

  it("uses the model output when it is valid + grounded", async () => {
    const gen = async () => ({ beat: 'You cleared "Fold laundry".' });
    const r = await draftBeat("camp", f, 1, "2026-09-06", gen);
    expect(r).toEqual({ narrative: 'You cleared "Fold laundry".', source: "ai" });
  });

  it("falls back silently when the model fabricates", async () => {
    const gen = async () => ({ beat: 'You slew "the Kraken".' });
    const r = await draftBeat("camp", f, 1, "2026-09-06", gen);
    expect(r.source).toBe("fallback");
  });

  it("falls back silently when the model throws", async () => {
    const gen = async () => { throw new Error("provider down"); };
    const r = await draftBeat("camp", f, 1, "2026-09-06", gen);
    expect(r.source).toBe("fallback");
  });
});
