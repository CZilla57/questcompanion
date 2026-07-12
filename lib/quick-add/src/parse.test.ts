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

describe("parseQuickAdd — dates", () => {
  it("parses relative words", () => {
    expect(parseQuickAdd("x today", { now: NOW }).dueDate).toBe("2026-07-12");
    expect(parseQuickAdd("x tonight", { now: NOW }).dueDate).toBe("2026-07-12");
    expect(parseQuickAdd("x tomorrow", { now: NOW }).dueDate).toBe("2026-07-13");
    expect(parseQuickAdd("x tmr", { now: NOW }).dueDate).toBe("2026-07-13");
  });

  it("parses 'in N days' and 'in N weeks'", () => {
    expect(parseQuickAdd("x in 3 days", { now: NOW }).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x in 2 weeks", { now: NOW }).dueDate).toBe("2026-07-26");
  });

  it("parses weekdays (today excluded) and 'next'", () => {
    expect(parseQuickAdd("x mon", { now: NOW }).dueDate).toBe("2026-07-13");
    expect(parseQuickAdd("x friday", { now: NOW }).dueDate).toBe("2026-07-17");
    expect(parseQuickAdd("x sun", { now: NOW }).dueDate).toBe("2026-07-19");
    expect(parseQuickAdd("x next mon", { now: NOW }).dueDate).toBe("2026-07-20");
  });

  it("parses numeric M/D, defaulting to the next future year", () => {
    expect(parseQuickAdd("x 7/15", { now: NOW }).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x 7/10", { now: NOW }).dueDate).toBe("2027-07-10");
    expect(parseQuickAdd("x 12/25/2026", { now: NOW }).dueDate).toBe("2026-12-25");
  });

  it("parses ISO and month-name dates", () => {
    expect(parseQuickAdd("x 2026-12-01", { now: NOW }).dueDate).toBe("2026-12-01");
    expect(parseQuickAdd("x jul 15", { now: NOW }).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x 15 jul", { now: NOW }).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x dec 25", { now: NOW }).dueDate).toBe("2026-12-25");
  });

  it("treats impossible dates/times as ordinary title text", () => {
    const r = parseQuickAdd("meet feb 30", { now: NOW });
    expect(r.dueDate).toBeUndefined();
    expect(r.title).toBe("meet feb 30");
    expect(parseQuickAdd("x 25:00", { now: NOW }).dueTime).toBeUndefined();
  });
});

describe("parseQuickAdd — full line, order independent", () => {
  it("parses the canonical example", () => {
    const r = parseQuickAdd("Email Sam re: budget tomorrow 3pm #work !high", { now: NOW });
    expect(r).toEqual({
      title: "Email Sam re: budget",
      dueDate: "2026-07-13",
      dueTime: "15:00",
      priority: "high",
      category: "deep_work",
    });
  });

  it("does not depend on token order", () => {
    const r = parseQuickAdd("!high #work 3pm tomorrow Email Sam re: budget", { now: NOW });
    expect(r.dueDate).toBe("2026-07-13");
    expect(r.dueTime).toBe("15:00");
    expect(r.priority).toBe("high");
    expect(r.category).toBe("deep_work");
    expect(r.title).toBe("Email Sam re: budget");
  });

  it("returns an empty title when the line is only tokens", () => {
    expect(parseQuickAdd("tomorrow 3pm !high", { now: NOW }).title).toBe("");
  });
});
