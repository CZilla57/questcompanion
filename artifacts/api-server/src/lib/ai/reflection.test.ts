import { describe, it, expect } from "vitest";
import {
  buildDaySummary, containsGuiltLanguage, draftQuestion, draftAck,
  fallbackQuestion, fallbackAck, buildReflectionQuestionPrompt,
  MAX_QUESTION_LENGTH, FALLBACK_QUESTIONS,
} from "./reflection";
import type { PatternSummary } from "../patterns";

const EMPTY_PATTERNS: PatternSummary = {
  windowDays: 28,
  sampleSize: { completions: 0, focusMinutes: 0, checkins: 0, reflections: 0 },
  confidence: "none",
  powerHours: [], bestDay: null, medianQuestMinutes: null,
  categoryMinutes: [], modeByBlock: [
    { block: "morning", dominantMode: null }, { block: "afternoon", dominantMode: null },
    { block: "evening", dominantMode: null }, { block: "night", dominantMode: null },
  ],
  topHelpers: [], topBlockers: [],
};

const DAY = buildDaySummary({
  completedToday: [
    { title: "Fold laundry", category: "chores", completedAt: new Date("2026-07-16T14:00:00Z") },
  ],
  focusSecondsToday: 1500,
  checkinsToday: [{ mode: "focused", createdAt: new Date("2026-07-16T09:30:00Z") }],
  rescueCountToday: 1,
  streakDays: 4,
  timeZone: "UTC",
});

describe("buildDaySummary", () => {
  it("assembles only positive/neutral facts and caps quests at 6", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `q${i}`, category: "default", completedAt: new Date("2026-07-16T10:00:00Z"),
    }));
    const s = buildDaySummary({
      completedToday: many, focusSecondsToday: 0, checkinsToday: [],
      rescueCountToday: 0, streakDays: 0, timeZone: "UTC",
    });
    expect(s.completedQuests).toHaveLength(6);
    // Anti-shame: the summary's shape has no channel for unfinished work.
    expect(Object.keys(s).sort()).toEqual(
      ["completedQuests", "focusMinutes", "modesSeen", "rescueCount", "streakDays"].sort(),
    );
  });

  it("maps checkins to day blocks and rounds focus minutes", () => {
    expect(DAY.focusMinutes).toBe(25);
    expect(DAY.modesSeen).toEqual([{ mode: "focused", block: "morning" }]);
  });
});

describe("containsGuiltLanguage", () => {
  it("flags guilt phrases case-insensitively, including curly apostrophes", () => {
    expect(containsGuiltLanguage("You should have started earlier")).toBe(true);
    expect(containsGuiltLanguage("Why didn't you finish?")).toBe(true);
    expect(containsGuiltLanguage("Why didn\u2019t you finish?")).toBe(true);
    expect(containsGuiltLanguage("You missed the deadline")).toBe(true);
    expect(containsGuiltLanguage("You failed today")).toBe(true);
    expect(containsGuiltLanguage("You're falling behind")).toBe(true);
    expect(containsGuiltLanguage("You only did one thing")).toBe(true);
    expect(containsGuiltLanguage("It was just one quest")).toBe(true);
  });
  it("passes warm copy", () => {
    expect(containsGuiltLanguage("What made the morning flow?")).toBe(false);
    expect(containsGuiltLanguage("Adjusted for readability")).toBe(false); // 'just' inside a word
  });
});

describe("buildReflectionQuestionPrompt", () => {
  it("grounds the prompt in day facts and bans unfinished-work talk", () => {
    const p = buildReflectionQuestionPrompt(DAY, EMPTY_PATTERNS);
    expect(p).toContain("Fold laundry");
    expect(p).toContain("25");
    expect(p.toLowerCase()).toContain("never");         // hard rules present
    expect(p.toLowerCase()).toContain("unfinished");    // explicit prohibition
    expect(p).toContain('{"question"');                 // JSON contract
  });
});

describe("draftQuestion", () => {
  it("uses the model answer when valid", async () => {
    const gen = async () => ({ question: "What made the morning flow so well?" });
    const r = await draftQuestion(DAY, EMPTY_PATTERNS, 1, "2026-07-16", gen);
    expect(r).toEqual({ question: "What made the morning flow so well?", source: "ai" });
  });

  it.each([
    ["model throws", async () => { throw new Error("down"); }],
    ["bad shape", async () => ({ nope: true })],
    ["too long", async () => ({ question: "x".repeat(MAX_QUESTION_LENGTH + 1) })],
    ["guilt language", async () => ({ question: "Why didn't you do more?" })],
    ["empty", async () => ({ question: "  " })],
  ])("falls back when %s", async (_name, gen) => {
    const r = await draftQuestion(DAY, EMPTY_PATTERNS, 1, "2026-07-16", gen as never);
    expect(r.source).toBe("fallback");
    expect(FALLBACK_QUESTIONS).toContain(r.question);
  });

  it("goes straight to fallback when generate is null (AI unconfigured)", async () => {
    const r = await draftQuestion(DAY, EMPTY_PATTERNS, 1, "2026-07-16", null);
    expect(r.source).toBe("fallback");
  });
});

describe("fallbacks", () => {
  it("are deterministic per (userId, localDate) and vary across days", () => {
    expect(fallbackQuestion(1, "2026-07-16")).toBe(fallbackQuestion(1, "2026-07-16"));
    const days = Array.from({ length: 12 }, (_, i) =>
      fallbackQuestion(1, `2026-07-${String(i + 1).padStart(2, "0")}`));
    expect(new Set(days).size).toBeGreaterThan(1);
    expect(fallbackAck(1, "2026-07-16")).toBe(fallbackAck(1, "2026-07-16"));
  });
  it("fallback pool itself contains no guilt language", () => {
    for (const q of FALLBACK_QUESTIONS) expect(containsGuiltLanguage(q)).toBe(false);
  });
});

describe("draftAck", () => {
  it("uses a valid model ack and falls back otherwise", async () => {
    const good = await draftAck(["timer"], null, 1, "2026-07-16", async () => ({ ack: "Timers it is — noted for your rhythms." }));
    expect(good).toBe("Timers it is — noted for your rhythms.");
    const bad = await draftAck(["timer"], null, 1, "2026-07-16", async () => ({ ack: "You only picked one thing." }));
    expect(containsGuiltLanguage(bad)).toBe(false);
  });
});
