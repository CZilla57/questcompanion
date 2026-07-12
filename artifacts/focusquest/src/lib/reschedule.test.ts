import { describe, it, expect } from "vitest";
import {
  parseDueDate,
  toDueDateString,
  todayDueDate,
  tomorrowDueDate,
  nextWeekDueDate,
} from "./reschedule";

const DAY_MS = 86_400_000;

describe("toDueDateString", () => {
  it("formats a local Date to yyyy-MM-dd", () => {
    // new Date(year, monthIndex, day) is local time; July = month index 6.
    expect(toDueDateString(new Date(2026, 6, 12))).toBe("2026-07-12");
  });
});

describe("parseDueDate", () => {
  it("parses yyyy-MM-dd to local midnight (no UTC off-by-one)", () => {
    const d = parseDueDate("2026-07-12");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July, 0-based
    expect(d.getDate()).toBe(12);
    expect(d.getHours()).toBe(0);
  });

  it("round-trips with toDueDateString", () => {
    expect(toDueDateString(parseDueDate("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("shortcut dates", () => {
  it("tomorrow is exactly one day after today", () => {
    const today = parseDueDate(todayDueDate());
    const tomorrow = parseDueDate(tomorrowDueDate());
    expect(Math.round((tomorrow.getTime() - today.getTime()) / DAY_MS)).toBe(1);
  });

  it("next week is exactly seven days after today", () => {
    const today = parseDueDate(todayDueDate());
    const nextWeek = parseDueDate(nextWeekDueDate());
    expect(Math.round((nextWeek.getTime() - today.getTime()) / DAY_MS)).toBe(7);
  });
});
