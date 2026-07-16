import { describe, it, expect } from "vitest";
import { rhythmsState, formatPowerHours, rhythmsLines } from "./rhythms";
import type { PatternSummary } from "@workspace/api-client-react";

function summary(over: Partial<PatternSummary> = {}): PatternSummary {
  return {
    windowDays: 28,
    sampleSize: { completions: 20, focusMinutes: 100, checkins: 5, reflections: 3 },
    confidence: "ok",
    powerHours: [{ hour: 9, score: 5 }, { hour: 10, score: 4 }],
    bestDay: 2,
    medianQuestMinutes: 20,
    categoryMinutes: [],
    modeByBlock: [],
    topHelpers: ["small_steps"],
    topBlockers: ["low_energy"],
    ...over,
  } as PatternSummary;
}

describe("rhythmsState", () => {
  it("maps confidence to card state", () => {
    expect(rhythmsState(summary({ confidence: "none" }))).toBe("empty");
    expect(rhythmsState(summary({ confidence: "low" }))).toBe("early");
    expect(rhythmsState(summary({ confidence: "ok" }))).toBe("full");
  });
});

describe("formatPowerHours", () => {
  it("renders a contiguous run as a range (end exclusive)", () => {
    expect(formatPowerHours([{ hour: 9 }, { hour: 10 }])).toBe("9–11am");
  });
  it("renders separate hours as a list and handles noon/midnight", () => {
    expect(formatPowerHours([{ hour: 9 }, { hour: 14 }])).toBe("9–10am, 2–3pm");
    expect(formatPowerHours([{ hour: 0 }])).toBe("12–1am");
    expect(formatPowerHours([{ hour: 11 }, { hour: 12 }])).toBe("11am–1pm");
    expect(formatPowerHours([{ hour: 23 }])).toBe("11pm–12am");
  });
  it("is empty-safe", () => {
    expect(formatPowerHours([])).toBe("");
  });
});

describe("rhythmsLines", () => {
  it("emits only positive framings and skips missing facts", () => {
    const lines = rhythmsLines(summary());
    expect(lines.some((l) => l.includes("9–11am"))).toBe(true);
    expect(lines.some((l) => l.includes("Tuesday"))).toBe(true);
    expect(lines.some((l) => l.includes("~20 min"))).toBe(true);
    expect(lines.some((l) => l.includes("Small steps"))).toBe(true);
    // Blockers feed the LLM, never this card (spec §7).
    expect(lines.join(" ")).not.toMatch(/low energy/i);
  });
  it("drops null facts", () => {
    const lines = rhythmsLines(summary({ bestDay: null, medianQuestMinutes: null, topHelpers: [] }));
    expect(lines).toHaveLength(1); // just power hours
  });
});
