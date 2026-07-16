import { describe, it, expect } from "vitest";
import { derivePatterns, blockOfHour, type PatternInputs } from "./patterns";

const NOW = new Date("2026-07-16T20:00:00.000Z");

function inputs(over: Partial<PatternInputs> = {}): PatternInputs {
  return {
    now: NOW,
    timeZone: "UTC",
    completions: [],
    focusSessions: [],
    checkins: [],
    reflections: [],
    ...over,
  };
}

/** n completions at the given UTC hour on distinct recent days. */
function completionsAt(hourUtc: number, n: number, category = "default", actualMinutes: number | null = null) {
  return Array.from({ length: n }, (_, i) => ({
    completedAt: new Date(Date.UTC(2026, 6, 15 - i, hourUtc, 30)),
    category,
    estimatedMinutes: null,
    actualMinutes,
  }));
}

describe("derivePatterns", () => {
  it("returns a complete empty-safe summary on no data", () => {
    const s = derivePatterns(inputs());
    expect(s.windowDays).toBe(28);
    expect(s.confidence).toBe("none");
    expect(s.powerHours).toEqual([]);
    expect(s.bestDay).toBeNull();
    expect(s.medianQuestMinutes).toBeNull();
    expect(s.categoryMinutes).toEqual([]);
    expect(s.topHelpers).toEqual([]);
    expect(s.topBlockers).toEqual([]);
    expect(s.modeByBlock).toHaveLength(4);
    expect(s.modeByBlock.every((m) => m.dominantMode === null)).toBe(true);
  });

  it("confidence tiers: none <5, low <15, ok >=15 completions", () => {
    expect(derivePatterns(inputs({ completions: completionsAt(10, 4) })).confidence).toBe("none");
    expect(derivePatterns(inputs({ completions: completionsAt(10, 5) })).confidence).toBe("low");
    expect(derivePatterns(inputs({ completions: completionsAt(10, 15) })).confidence).toBe("ok");
  });

  it("drops rows older than the 28-day window", () => {
    const old = [{ completedAt: new Date("2026-06-01T10:00:00Z"), category: "default", estimatedMinutes: null, actualMinutes: null }];
    const s = derivePatterns(inputs({ completions: old }));
    expect(s.sampleSize.completions).toBe(0);
  });

  it("powerHours scores completions + focus minutes/25, top 3, earlier-hour tiebreak", () => {
    const s = derivePatterns(inputs({
      completions: [...completionsAt(9, 3), ...completionsAt(14, 3), ...completionsAt(20, 1)],
      // 50 focused minutes at hour 14 → +2 score there
      focusSessions: [{ startedAt: new Date("2026-07-14T14:05:00Z"), focusedSeconds: 3000 }],
    }));
    expect(s.powerHours[0]).toEqual({ hour: 14, score: 5 });
    expect(s.powerHours[1]).toEqual({ hour: 9, score: 3 });
    expect(s.powerHours[2]).toEqual({ hour: 20, score: 1 });
  });

  it("powerHours ties break toward the earlier hour", () => {
    const s = derivePatterns(inputs({ completions: [...completionsAt(15, 2), ...completionsAt(8, 2)] }));
    expect(s.powerHours[0]!.hour).toBe(8);
  });

  it("buckets hours in the user's timezone", () => {
    // 2026-07-15T02:30Z = 22:30 on Jul 14 in America/New_York (EDT, UTC-4)
    const s = derivePatterns(inputs({
      timeZone: "America/New_York",
      completions: [
        { completedAt: new Date("2026-07-15T02:30:00Z"), category: "default", estimatedMinutes: null, actualMinutes: null },
      ],
    }));
    expect(s.powerHours[0]!.hour).toBe(22);
  });

  it("bestDay requires confidence >= low and a strict max", () => {
    // 4 completions → confidence none → null even with a clear winner
    expect(derivePatterns(inputs({ completions: completionsAt(10, 4) })).bestDay).toBeNull();
    // 15 spread with a strict winner
    const wed = Array.from({ length: 8 }, (_, i) => ({
      completedAt: new Date(Date.UTC(2026, 6, 15 - i * 7, 10)), // Jul 15 2026 is a Wednesday
      category: "default", estimatedMinutes: null, actualMinutes: null,
    }));
    const s = derivePatterns(inputs({ completions: [...wed, ...completionsAt(9, 7)] }));
    expect(s.bestDay).toBe(3);
  });

  it("medianQuestMinutes needs >=3 samples with actualMinutes", () => {
    expect(derivePatterns(inputs({ completions: completionsAt(10, 5, "default", 20) })).medianQuestMinutes).toBe(20);
    expect(derivePatterns(inputs({
      completions: [...completionsAt(10, 2, "default", 20), ...completionsAt(11, 5, "default", null)],
    })).medianQuestMinutes).toBeNull();
  });

  it("categoryMinutes computes per-category medians over actualMinutes rows only", () => {
    const s = derivePatterns(inputs({
      completions: [
        ...completionsAt(9, 3, "chores", 10),
        ...completionsAt(10, 2, "fitness", 40),
        ...completionsAt(11, 2, "fitness", null), // no actualMinutes — excluded
      ],
    }));
    expect(s.categoryMinutes).toEqual([
      { category: "chores", medianActual: 10, count: 3 },
      { category: "fitness", medianActual: 40, count: 2 },
    ]);
  });

  it("modeByBlock needs >=2 checkins in a block; ties yield null", () => {
    const at = (h: number, mode: string) => ({ mode, createdAt: new Date(Date.UTC(2026, 6, 15, h)) });
    const s = derivePatterns(inputs({
      checkins: [at(9, "focused"), at(10, "focused"), at(14, "frozen"), at(19, "focused"), at(20, "distracted")],
    }));
    const by = Object.fromEntries(s.modeByBlock.map((m) => [m.block, m.dominantMode]));
    expect(by.morning).toBe("focused");   // 2 focused
    expect(by.afternoon).toBeNull();      // only 1 checkin
    expect(by.evening).toBeNull();        // 1–1 tie
  });

  it("topHelpers/topBlockers split by generated chip groups, top 3 by count", () => {
    const s = derivePatterns(inputs({
      reflections: [
        { chips: ["timer", "small_steps", "low_energy"] },
        { chips: ["timer", "too_big"] },
        { chips: ["timer", "small_steps", "low_energy", "body_double", "right_time"] },
      ],
    }));
    expect(s.topHelpers).toEqual(["timer", "small_steps", "body_double"]);
    expect(s.topBlockers).toEqual(["low_energy", "too_big"]);
    expect(s.sampleSize.reflections).toBe(3);
  });
});

describe("blockOfHour", () => {
  it("maps hours to the insights period buckets", () => {
    expect(blockOfHour(6)).toBe("morning");
    expect(blockOfHour(11)).toBe("morning");
    expect(blockOfHour(12)).toBe("afternoon");
    expect(blockOfHour(16)).toBe("afternoon");
    expect(blockOfHour(17)).toBe("evening");
    expect(blockOfHour(20)).toBe("evening");
    expect(blockOfHour(21)).toBe("night");
    expect(blockOfHour(2)).toBe("night");
  });
});
