import { describe, it, expect } from "vitest";
import { isReflectionChip, validateAnswer, shouldPromptReflection, MAX_FREE_TEXT } from "./reflections";

describe("isReflectionChip", () => {
  it("accepts keys from both generated enums, rejects everything else", () => {
    expect(isReflectionChip("timer")).toBe(true);       // helped
    expect(isReflectionChip("low_energy")).toBe(true);  // hindered
    expect(isReflectionChip("procrastinated")).toBe(false);
    expect(isReflectionChip(42)).toBe(false);
  });
});

describe("validateAnswer", () => {
  it("accepts chips-only, text-only, and both", () => {
    expect(validateAnswer({ chips: ["timer"] })).toEqual({ ok: true, chips: ["timer"], freeText: null });
    expect(validateAnswer({ chips: [], freeText: "long day" })).toEqual({ ok: true, chips: [], freeText: "long day" });
    expect(validateAnswer({ chips: ["too_big"], freeText: " hi " })).toEqual({ ok: true, chips: ["too_big"], freeText: "hi" });
  });
  it("rejects unknown chips, empty answers, non-arrays, and oversize text", () => {
    expect(validateAnswer({ chips: ["nope"] }).ok).toBe(false);
    expect(validateAnswer({ chips: [] }).ok).toBe(false);
    expect(validateAnswer({ chips: [], freeText: "   " }).ok).toBe(false);
    expect(validateAnswer({ chips: "timer" }).ok).toBe(false);
    expect(validateAnswer({}).ok).toBe(false);
    expect(validateAnswer({ chips: [], freeText: "x".repeat(MAX_FREE_TEXT + 1) }).ok).toBe(false);
  });
  it("de-duplicates repeated chips", () => {
    expect(validateAnswer({ chips: ["timer", "timer"] })).toEqual({ ok: true, chips: ["timer"], freeText: null });
  });
});

describe("shouldPromptReflection", () => {
  const base = { localHour: 20, promptedToday: false, answeredToday: false, hadSignalToday: true, hasTimezone: true };
  it("fires inside the [19,22) window with all gates open", () => {
    expect(shouldPromptReflection(base)).toBe(true);
    expect(shouldPromptReflection({ ...base, localHour: 19 })).toBe(true);
    expect(shouldPromptReflection({ ...base, localHour: 21 })).toBe(true);
  });
  it("stays silent outside the window", () => {
    expect(shouldPromptReflection({ ...base, localHour: 18 })).toBe(false);
    expect(shouldPromptReflection({ ...base, localHour: 22 })).toBe(false);
  });
  it("dedups, skips answered days, skips zero-signal days (anti-shame), skips no-tz users", () => {
    expect(shouldPromptReflection({ ...base, promptedToday: true })).toBe(false);
    expect(shouldPromptReflection({ ...base, answeredToday: true })).toBe(false);
    expect(shouldPromptReflection({ ...base, hadSignalToday: false })).toBe(false);
    expect(shouldPromptReflection({ ...base, hasTimezone: false })).toBe(false);
  });
});
