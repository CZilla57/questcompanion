import { describe, it, expect } from "vitest";
import type { Reflection } from "@workspace/api-client-react";
import { buildReflectionAnswer, canSubmitReflection, isAnswered } from "./derivations";

function refl(partial: Partial<Reflection>): Reflection {
  return {
    id: 1, localDate: "2026-08-17", prompt: "How did today go?", promptSource: "fallback",
    chips: [], freeText: null, ack: null, answeredAt: null, createdAt: "2026-08-17T00:00:00.000Z",
    ...partial,
  };
}

describe("buildReflectionAnswer", () => {
  it("passes chips through and includes tz", () => {
    const out = buildReflectionAnswer(["timer", "small_steps"], "", "America/New_York");
    expect(out.chips).toEqual(["timer", "small_steps"]);
    expect(out.tz).toBe("America/New_York");
  });
  it("omits blank/whitespace free-text (undefined)", () => {
    expect(buildReflectionAnswer([], "   ", "UTC").freeText).toBeUndefined();
    expect(buildReflectionAnswer([], "", "UTC").freeText).toBeUndefined();
  });
  it("trims non-blank free-text", () => {
    expect(buildReflectionAnswer([], "  went well  ", "UTC").freeText).toBe("went well");
  });
});

describe("canSubmitReflection", () => {
  it("false with no chips and blank text", () => {
    expect(canSubmitReflection(0, "")).toBe(false);
    expect(canSubmitReflection(0, "   ")).toBe(false);
  });
  it("true with at least one chip", () => {
    expect(canSubmitReflection(1, "")).toBe(true);
  });
  it("true with non-blank text and no chips", () => {
    expect(canSubmitReflection(0, "a note")).toBe(true);
  });
});

describe("isAnswered", () => {
  it("false when reflection is null", () => {
    expect(isAnswered(null, false)).toBe(false);
  });
  it("false when answeredAt is null", () => {
    expect(isAnswered(refl({ answeredAt: null }), false)).toBe(false);
  });
  it("true when answered and not editing", () => {
    expect(isAnswered(refl({ answeredAt: "2026-08-17T21:00:00.000Z" }), false)).toBe(true);
  });
  it("false when answered but editing", () => {
    expect(isAnswered(refl({ answeredAt: "2026-08-17T21:00:00.000Z" }), true)).toBe(false);
  });
});
