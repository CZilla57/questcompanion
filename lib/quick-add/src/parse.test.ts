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

describe("parseQuickAdd — time-of-day", () => {
  it("parses 12-hour times", () => {
    expect(parseQuickAdd("call 3pm", { now: NOW }).dueTime).toBe("15:00");
    expect(parseQuickAdd("call 3:30pm", { now: NOW }).dueTime).toBe("15:30");
    expect(parseQuickAdd("call 9am", { now: NOW }).dueTime).toBe("09:00");
  });

  it("parses noon and midnight", () => {
    expect(parseQuickAdd("call noon", { now: NOW }).dueTime).toBe("12:00");
    expect(parseQuickAdd("call midnight", { now: NOW }).dueTime).toBe("00:00");
  });

  it("handles 12am/12pm correctly", () => {
    expect(parseQuickAdd("call 12pm", { now: NOW }).dueTime).toBe("12:00");
    expect(parseQuickAdd("call 12am", { now: NOW }).dueTime).toBe("00:00");
  });

  it("parses 24-hour times", () => {
    expect(parseQuickAdd("call 15:00", { now: NOW }).dueTime).toBe("15:00");
  });

  it("strips an 'at' prefix and the time token from the title", () => {
    const r = parseQuickAdd("Standup at 9am", { now: NOW });
    expect(r.dueTime).toBe("09:00");
    expect(r.title).toBe("Standup");
  });
});
