import { describe, it, expect } from "vitest";
import { validateRecurrenceInput, streakUnitFor } from "./recurrence-validation";

describe("validateRecurrenceInput — weekly", () => {
  it("accepts a weekly rule with days", () => {
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1, 3] })).toBeNull();
  });

  it("rejects a weekly rule with no days", () => {
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [] }))
      .toBe("Pick at least one day of the week.");
  });

  it("rejects an out-of-range weekday", () => {
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [7] }))
      .toBe("Days of the week must be 0 (Sunday) through 6 (Saturday).");
  });
});

describe("validateRecurrenceInput — monthly", () => {
  it("accepts a day-of-month rule", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15,
    })).toBeNull();
  });

  it("accepts an nth-weekday rule, including last", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 2, daysOfWeek: [4],
    })).toBeNull();
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [6],
    })).toBeNull();
  });

  it("requires a mode", () => {
    expect(validateRecurrenceInput({ frequency: "monthly" }))
      .toBe("Pick how the month is anchored: a day of the month, or a weekday.");
  });

  it("requires a valid day of month", () => {
    const msg = "Day of the month must be between 1 and 31.";
    expect(validateRecurrenceInput({ frequency: "monthly", monthlyMode: "day_of_month" })).toBe(msg);
    expect(validateRecurrenceInput({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 0 })).toBe(msg);
    expect(validateRecurrenceInput({ frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 32 })).toBe(msg);
  });

  it("requires a weekday for nth_weekday", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 1, daysOfWeek: [],
    })).toBe("Pick a weekday for this monthly schedule.");
  });

  it("requires a supported week ordinal", () => {
    const msg = "Pick the 1st, 2nd, 3rd, 4th, or last week of the month.";
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 5, daysOfWeek: [1],
    })).toBe(msg);
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", daysOfWeek: [1],
    })).toBe(msg);
  });
});

describe("validateRecurrenceInput — yearly", () => {
  it("accepts a full yearly rule", () => {
    expect(validateRecurrenceInput({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 3, dayOfMonth: 3,
    })).toBeNull();
  });

  it("requires a month", () => {
    const msg = "Pick a month for this yearly schedule.";
    expect(validateRecurrenceInput({
      frequency: "yearly", monthlyMode: "day_of_month", dayOfMonth: 3,
    })).toBe(msg);
    expect(validateRecurrenceInput({
      frequency: "yearly", monthlyMode: "day_of_month", dayOfMonth: 3, monthOfYear: 13,
    })).toBe(msg);
  });
});

describe("validateRecurrenceInput — lead days", () => {
  it("accepts the boundaries", () => {
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1], leadDays: 0 })).toBeNull();
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1], leadDays: 60 })).toBeNull();
  });

  it("rejects out-of-range values", () => {
    const msg = "Lead time must be between 0 and 60 days.";
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1], leadDays: -1 })).toBe(msg);
    expect(validateRecurrenceInput({ frequency: "weekly", daysOfWeek: [1], leadDays: 61 })).toBe(msg);
  });
});

describe("validateRecurrenceInput — unknown frequency", () => {
  it("rejects a frequency outside the three cadences", () => {
    expect(validateRecurrenceInput({ frequency: "fortnightly", daysOfWeek: [1] }))
      .toBe("Frequency must be weekly, monthly, or yearly.");
  });
});

describe("streakUnitFor", () => {
  it("maps each cadence to its streak unit", () => {
    expect(streakUnitFor("weekly")).toBe("day");
    expect(streakUnitFor("monthly")).toBe("month");
    expect(streakUnitFor("yearly")).toBe("year");
  });
});
