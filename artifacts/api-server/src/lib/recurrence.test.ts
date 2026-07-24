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

describe("occursOn — monthly nth_weekday", () => {
  // daysOfWeek carries the single weekday for this mode.
  const firstMonday = rule({
    frequency: "monthly",
    monthlyMode: "nth_weekday",
    weekOfMonth: 1,
    daysOfWeek: [1],
  });

  it("matches the first Monday", () => {
    // July 2026 starts on a Wednesday; the first Monday is the 6th.
    expect(occursOn(firstMonday, "2026-07-06")).toBe(true);
    expect(occursOn(firstMonday, "2026-07-13")).toBe(false);
  });

  it("matches when the month starts on the target weekday", () => {
    // June 2026 starts on a Monday, so the first Monday is the 1st.
    expect(occursOn(firstMonday, "2026-06-01")).toBe(true);
  });

  it("matches the third Friday", () => {
    const thirdFriday = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 3, daysOfWeek: [5],
    });
    // July 2026 Fridays: 3, 10, 17, 24, 31 — the third is the 17th.
    expect(occursOn(thirdFriday, "2026-07-17")).toBe(true);
    expect(occursOn(thirdFriday, "2026-07-24")).toBe(false);
  });

  it("resolves 'last' in a month with five of that weekday", () => {
    const lastFriday = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [5],
    });
    // July 2026 has five Fridays; the last is the 31st.
    expect(occursOn(lastFriday, "2026-07-31")).toBe(true);
    expect(occursOn(lastFriday, "2026-07-24")).toBe(false);
  });

  it("resolves 'last' in a month with four of that weekday", () => {
    const lastSaturday = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [6],
    });
    // February 2026 Saturdays: 7, 14, 21, 28 — the last is the 28th.
    expect(occursOn(lastSaturday, "2026-02-28")).toBe(true);
    expect(occursOn(lastSaturday, "2026-02-21")).toBe(false);
  });

  it("returns false when nth_weekday has no weekday", () => {
    const bad = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 1, daysOfWeek: [],
    });
    expect(occursOn(bad, "2026-07-06")).toBe(false);
  });

  it("returns false for an unsupported week ordinal", () => {
    const bad = rule({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 5, daysOfWeek: [1],
    });
    expect(occursOn(bad, "2026-07-27")).toBe(false);
  });
});

describe("occursOn — yearly", () => {
  it("matches month plus day, and only that month", () => {
    const march3 = rule({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 3, dayOfMonth: 3, daysOfWeek: [],
    });
    expect(occursOn(march3, "2026-03-03")).toBe(true);
    expect(occursOn(march3, "2027-03-03")).toBe(true);
    expect(occursOn(march3, "2026-04-03")).toBe(false);
    expect(occursOn(march3, "2026-03-04")).toBe(false);
  });

  it("clamps Feb 29 to Feb 28 in a common year", () => {
    const leapDay = rule({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 2, dayOfMonth: 29, daysOfWeek: [],
    });
    expect(occursOn(leapDay, "2026-02-28")).toBe(true);
    expect(occursOn(leapDay, "2028-02-29")).toBe(true);
    // In a leap year it must NOT also fire on the 28th.
    expect(occursOn(leapDay, "2028-02-28")).toBe(false);
  });

  it("supports nth_weekday scoped to a month", () => {
    const firstMondayOfMarch = rule({
      frequency: "yearly", monthlyMode: "nth_weekday", monthOfYear: 3, weekOfMonth: 1, daysOfWeek: [1],
    });
    // March 2026 starts on a Sunday; the first Monday is the 2nd.
    expect(occursOn(firstMondayOfMarch, "2026-03-02")).toBe(true);
    expect(occursOn(firstMondayOfMarch, "2026-03-09")).toBe(false);
    expect(occursOn(firstMondayOfMarch, "2026-04-06")).toBe(false);
  });

  it("returns false when yearly has no month", () => {
    const bad = rule({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: null, dayOfMonth: 3, daysOfWeek: [],
    });
    expect(occursOn(bad, "2026-03-03")).toBe(false);
  });
});
