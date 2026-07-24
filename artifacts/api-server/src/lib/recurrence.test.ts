import { describe, it, expect } from "vitest";
import { occursOn, addDays, type RecurrenceRule } from "./recurrence";

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    frequency: "weekly",
    daysOfWeek: [1, 2, 3, 4, 5],
    monthlyMode: null,
    dayOfMonth: null,
    weekOfMonth: null,
    monthOfYear: null,
    startDate: "2020-01-01",
    endDate: null,
    ...overrides,
  };
}

describe("addDays", () => {
  it("steps forward across a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("steps backward with a negative count", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("occursOn — weekly", () => {
  it("matches a listed weekday", () => {
    // 2026-07-24 is a Friday (day 5).
    expect(occursOn(rule(), "2026-07-24")).toBe(true);
  });

  it("rejects an unlisted weekday", () => {
    // 2026-07-25 is a Saturday (day 6), not in [1..5].
    expect(occursOn(rule(), "2026-07-25")).toBe(false);
  });
});

describe("occursOn — monthly day_of_month", () => {
  const monthly = rule({
    frequency: "monthly",
    monthlyMode: "day_of_month",
    dayOfMonth: 15,
    daysOfWeek: [],
  });

  it("matches the chosen day in any month", () => {
    expect(occursOn(monthly, "2026-07-15")).toBe(true);
    expect(occursOn(monthly, "2026-08-15")).toBe(true);
  });

  it("rejects every other day", () => {
    expect(occursOn(monthly, "2026-07-14")).toBe(false);
    expect(occursOn(monthly, "2026-07-16")).toBe(false);
  });

  it("clamps the 31st to the last day of a short month", () => {
    const d31 = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 31, daysOfWeek: [] });
    // 2026 is not a leap year: February clamps to the 28th.
    expect(occursOn(d31, "2026-02-28")).toBe(true);
    expect(occursOn(d31, "2026-02-27")).toBe(false);
    // April has 30 days.
    expect(occursOn(d31, "2026-04-30")).toBe(true);
    // A month that actually has a 31st is unaffected.
    expect(occursOn(d31, "2026-07-31")).toBe(true);
    expect(occursOn(d31, "2026-07-30")).toBe(false);
  });

  it("clamps the 30th to Feb 29 in a leap year", () => {
    const d30 = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 30, daysOfWeek: [] });
    expect(occursOn(d30, "2028-02-29")).toBe(true);
    expect(occursOn(d30, "2028-02-28")).toBe(false);
  });
});

describe("occursOn — start and end gating", () => {
  it("rejects dates before startDate", () => {
    expect(occursOn(rule({ startDate: "2026-08-01" }), "2026-07-24")).toBe(false);
  });

  it("rejects dates after endDate", () => {
    expect(occursOn(rule({ endDate: "2026-07-01" }), "2026-07-24")).toBe(false);
  });

  it("includes both boundary dates", () => {
    // 2026-07-24 Friday, 2026-07-20 Monday — both are listed weekdays.
    expect(occursOn(rule({ startDate: "2026-07-24" }), "2026-07-24")).toBe(true);
    expect(occursOn(rule({ endDate: "2026-07-20" }), "2026-07-20")).toBe(true);
  });
});

describe("occursOn — malformed rules never throw", () => {
  it("returns false when a monthly rule has no mode", () => {
    expect(occursOn(rule({ frequency: "monthly", monthlyMode: null }), "2026-07-15")).toBe(false);
  });

  it("returns false when day_of_month has no day", () => {
    const bad = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: null });
    expect(occursOn(bad, "2026-07-15")).toBe(false);
  });

  it("returns false for an out-of-range day", () => {
    const bad = rule({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 0 });
    expect(occursOn(bad, "2026-07-01")).toBe(false);
  });

  it("returns false for a weekly rule with no days", () => {
    expect(occursOn(rule({ daysOfWeek: [] }), "2026-07-24")).toBe(false);
  });
});
