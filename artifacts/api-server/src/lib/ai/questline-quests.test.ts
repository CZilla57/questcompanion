import { describe, it, expect, vi } from "vitest";
import {
  buildQuestlineQuestsPrompt,
  parseQuestlineQuests,
  suggestQuestlineQuests,
  sanitizeQuestTitles,
  QuestlineQuestsParseError,
  MIN_QUESTS,
  MAX_QUESTS,
  MAX_QUEST_LENGTH,
  MAX_QUESTLINE_QUESTS,
} from "./questline-quests";

describe("buildQuestlineQuestsPrompt", () => {
  it("includes the goal, the count bounds, and the JSON shape", () => {
    const p = buildQuestlineQuestsPrompt("Run a 5K");
    expect(p).toContain("Run a 5K");
    expect(p).toContain(String(MIN_QUESTS));
    expect(p).toContain(String(MAX_QUESTS));
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain("\"quests\"");
  });
});

describe("parseQuestlineQuests", () => {
  it("trims and returns valid quests", () => {
    expect(parseQuestlineQuests({ quests: ["  a ", "b", "c"] })).toEqual(["a", "b", "c"]);
  });
  it("drops empty/whitespace quests", () => {
    expect(parseQuestlineQuests({ quests: ["a", "   ", "b", "", "c"] })).toEqual(["a", "b", "c"]);
  });
  it("truncates over-long quests to MAX_QUEST_LENGTH", () => {
    const long = "x".repeat(MAX_QUEST_LENGTH + 50);
    const [first] = parseQuestlineQuests({ quests: [long, "b", "c"] });
    expect(first.length).toBe(MAX_QUEST_LENGTH);
  });
  it("clamps to MAX_QUESTS", () => {
    const many = Array.from({ length: MAX_QUESTS + 4 }, (_, i) => `quest ${i}`);
    expect(parseQuestlineQuests({ quests: many })).toHaveLength(MAX_QUESTS);
  });
  it("throws when fewer than MIN_QUESTS usable quests remain", () => {
    expect(() => parseQuestlineQuests({ quests: ["only one", "  "] })).toThrow(QuestlineQuestsParseError);
  });
  it("throws on a non-object or missing quests array", () => {
    expect(() => parseQuestlineQuests({ nope: true })).toThrow(QuestlineQuestsParseError);
    expect(() => parseQuestlineQuests(null)).toThrow(QuestlineQuestsParseError);
    expect(() => parseQuestlineQuests({ quests: "not an array" })).toThrow(QuestlineQuestsParseError);
  });
});

describe("suggestQuestlineQuests", () => {
  it("passes the built prompt to generate and returns parsed quests", async () => {
    const generate = vi.fn(async () => ({ quests: ["a", "b", "c"] }));
    const result = await suggestQuestlineQuests("Learn guitar", generate);
    expect(result).toEqual(["a", "b", "c"]);
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("Learn guitar"));
  });
});

describe("sanitizeQuestTitles", () => {
  it("trims, drops empties, and caps count to MAX_QUESTLINE_QUESTS", () => {
    const many = Array.from({ length: MAX_QUESTLINE_QUESTS + 3 }, (_, i) => ` t${i} `);
    const out = sanitizeQuestTitles([" a ", "", "   ", "b", ...many]);
    expect(out).toHaveLength(MAX_QUESTLINE_QUESTS);
    expect(out[0]).toBe("a");
    expect(out).not.toContain("");
  });
  it("truncates over-long titles", () => {
    const long = "y".repeat(MAX_QUEST_LENGTH + 20);
    expect(sanitizeQuestTitles([long])[0].length).toBe(MAX_QUEST_LENGTH);
  });
});
