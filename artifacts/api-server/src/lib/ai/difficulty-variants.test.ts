import { describe, it, expect, vi } from "vitest";
import {
  buildVariantsPrompt,
  parseVariants,
  generateVariants,
  VariantsParseError,
  MAX_VARIANT_STEPS,
  MAX_VARIANT_STEP_LENGTH,
} from "./difficulty-variants";

const ok = {
  easy: { title: "Clear the counters", estimatedMinutes: 5, steps: ["Clear items", "Wipe down"] },
  hard: { title: "Deep-clean the kitchen", estimatedMinutes: 40, steps: ["Counters", "Dishes", "Floor", "Fridge"] },
};

describe("buildVariantsPrompt", () => {
  it("includes the quest and asks for smaller easy + bigger hard as JSON", () => {
    const p = buildVariantsPrompt({ title: "Clean the kitchen", estimatedMinutes: 15 });
    expect(p).toContain("Clean the kitchen");
    expect(p.toLowerCase()).toContain("smaller");
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain('"easy"');
    expect(p).toContain('"hard"');
  });

  it("includes description, category, estimate, and existing steps when present", () => {
    const p = buildVariantsPrompt({
      title: "X", description: "the big one", category: "household",
      estimatedMinutes: 90, steps: ["a", "b"],
    });
    expect(p).toContain("the big one");
    expect(p).toContain("household");
    expect(p).toContain("90");
  });
});

describe("parseVariants", () => {
  it("returns trimmed, validated easy + hard drafts", () => {
    expect(parseVariants(ok)).toEqual(ok);
  });

  it("rounds estimates and drops empty steps", () => {
    const r = parseVariants({
      easy: { title: " a ", estimatedMinutes: 4.6, steps: ["s1", "  ", ""] },
      hard: { title: "b", estimatedMinutes: 30, steps: ["x"] },
    });
    expect(r.easy.title).toBe("a");
    expect(r.easy.estimatedMinutes).toBe(5);
    expect(r.easy.steps).toEqual(["s1"]);
  });

  it("clamps steps to MAX_VARIANT_STEPS and truncates long steps", () => {
    const many = Array.from({ length: MAX_VARIANT_STEPS + 3 }, (_, i) => `step ${i}`);
    const longStep = "y".repeat(MAX_VARIANT_STEP_LENGTH + 20);
    const r = parseVariants({
      easy: { title: "a", estimatedMinutes: 5, steps: [longStep] },
      hard: { title: "b", estimatedMinutes: 30, steps: many },
    });
    expect(r.hard.steps).toHaveLength(MAX_VARIANT_STEPS);
    expect(r.easy.steps[0]!.length).toBe(MAX_VARIANT_STEP_LENGTH);
  });

  it("throws when easy is not strictly smaller than hard", () => {
    expect(() => parseVariants({
      easy: { title: "a", estimatedMinutes: 30, steps: [] },
      hard: { title: "b", estimatedMinutes: 20, steps: [] },
    })).toThrow(VariantsParseError);
  });

  it("throws on missing rungs, empty titles, or non-positive estimates", () => {
    expect(() => parseVariants({ easy: ok.easy })).toThrow(VariantsParseError);
    expect(() => parseVariants({ easy: { title: "", estimatedMinutes: 5, steps: [] }, hard: ok.hard })).toThrow(VariantsParseError);
    expect(() => parseVariants({ easy: { title: "a", estimatedMinutes: 0, steps: [] }, hard: ok.hard })).toThrow(VariantsParseError);
    expect(() => parseVariants(null)).toThrow(VariantsParseError);
  });
});

describe("generateVariants", () => {
  it("passes the built prompt to generate and returns parsed drafts", async () => {
    const generate = vi.fn(async () => ok);
    const result = await generateVariants({ title: "Clean the kitchen" }, generate);
    expect(result).toEqual(ok);
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("Clean the kitchen"));
  });
});
