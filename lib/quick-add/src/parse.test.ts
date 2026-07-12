import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "./parse";

const NOW = new Date(2026, 6, 12, 9, 0, 0); // Sun 2026-07-12, 09:00 local

describe("parseQuickAdd — priority", () => {
  it("extracts !high and strips the token", () => {
    const r = parseQuickAdd("Ship the report !high", { now: NOW });
    expect(r.priority).toBe("high");
    expect(r.title).toBe("Ship the report");
  });

  it("accepts short aliases and is case-insensitive", () => {
    expect(parseQuickAdd("x !h", { now: NOW }).priority).toBe("high");
    expect(parseQuickAdd("x !MED", { now: NOW }).priority).toBe("medium");
    expect(parseQuickAdd("x !l", { now: NOW }).priority).toBe("low");
  });

  it("last priority token wins", () => {
    expect(parseQuickAdd("x !low !high", { now: NOW }).priority).toBe("high");
  });

  it("leaves priority undefined and keeps unknown !words in the title", () => {
    const r = parseQuickAdd("email !urgent", { now: NOW });
    expect(r.priority).toBeUndefined();
    expect(r.title).toBe("email !urgent");
  });
});

describe("parseQuickAdd — hashtags", () => {
  it("maps a known #tag to a category and strips it", () => {
    const r = parseQuickAdd("Email Sam #work", { now: NOW });
    expect(r.category).toBe("deep_work");
    expect(r.title).toBe("Email Sam");
  });

  it("strips an unknown #tag and leaves category undefined", () => {
    const r = parseQuickAdd("Email Sam #banana", { now: NOW });
    expect(r.category).toBeUndefined();
    expect(r.title).toBe("Email Sam");
  });
});
