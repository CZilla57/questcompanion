import { describe, it, expect, vi } from "vitest";
import {
  buildBreakdownPrompt,
  parseBreakdown,
  breakdownTask,
  BreakdownParseError,
  MIN_STEPS,
  MAX_STEPS,
  MAX_STEP_LENGTH,
} from "./task-breakdown";

describe("buildBreakdownPrompt", () => {
  it("includes the title and the core ADHD constraints", () => {
    const p = buildBreakdownPrompt({ title: "clean the garage" });
    expect(p).toContain("clean the garage");
    expect(p.toLowerCase()).toContain("first step");
    expect(p).toContain(String(MIN_STEPS));
    expect(p).toContain(String(MAX_STEPS));
    // JSON-mode providers require the shape to be stated in the prompt.
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain("\"steps\"");
  });

  it("includes description, category, and estimate when present", () => {
    const p = buildBreakdownPrompt({
      title: "X",
      description: "the big one",
      category: "household",
      estimatedMinutes: 90,
    });
    expect(p).toContain("the big one");
    expect(p).toContain("household");
    expect(p).toContain("90");
  });
});

describe("parseBreakdown", () => {
  it("trims and returns valid steps", () => {
    expect(parseBreakdown({ steps: ["  a ", "b", "c"] })).toEqual(["a", "b", "c"]);
  });

  it("drops empty/whitespace steps", () => {
    expect(parseBreakdown({ steps: ["a", "   ", "b", "", "c"] })).toEqual(["a", "b", "c"]);
  });

  it("truncates over-long steps to MAX_STEP_LENGTH", () => {
    const long = "x".repeat(MAX_STEP_LENGTH + 50);
    const [first] = parseBreakdown({ steps: [long, "b", "c"] });
    expect(first.length).toBe(MAX_STEP_LENGTH);
  });

  it("clamps to MAX_STEPS", () => {
    const many = Array.from({ length: MAX_STEPS + 4 }, (_, i) => `step ${i}`);
    expect(parseBreakdown({ steps: many })).toHaveLength(MAX_STEPS);
  });

  it("throws when fewer than MIN_STEPS usable steps remain", () => {
    expect(() => parseBreakdown({ steps: ["only one", "   "] })).toThrow(BreakdownParseError);
  });

  it("throws on a non-object or missing steps array", () => {
    expect(() => parseBreakdown({ nope: true })).toThrow(BreakdownParseError);
    expect(() => parseBreakdown(null)).toThrow(BreakdownParseError);
    expect(() => parseBreakdown({ steps: "not an array" })).toThrow(BreakdownParseError);
  });
});

describe("breakdownTask", () => {
  it("passes the built prompt to generate and returns parsed steps", async () => {
    const generate = vi.fn(async () => ({ steps: ["a", "b", "c"] }));
    const result = await breakdownTask({ title: "Tidy the shed" }, generate);
    expect(result).toEqual(["a", "b", "c"]);
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("Tidy the shed"));
  });
});
