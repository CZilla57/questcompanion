import { describe, it, expect } from "vitest";
import {
  validateRecurrenceInput,
  streakUnitFor,
  mergeRecurrenceUpdate,
  type StoredRecurrence,
} from "./recurrence-validation";

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

  it("rejects more than one weekday for nth_weekday", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 1, daysOfWeek: [1, 3, 5],
    })).toBe("Pick exactly one weekday for this monthly schedule.");
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

describe("validateRecurrenceInput — dormant sibling fields", () => {
  it("rejects an out-of-range dayOfMonth even when the active mode is nth_weekday", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: 2, daysOfWeek: [4], dayOfMonth: -999,
    })).toBe("Day of the month must be between 1 and 31.");
  });

  it("rejects an out-of-range weekOfMonth even when the active mode is day_of_month", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15, weekOfMonth: 99,
    })).toBe("Pick the 1st, 2nd, 3rd, 4th, or last week of the month.");
  });

  it("rejects an out-of-range monthOfYear even when frequency is not yearly", () => {
    expect(validateRecurrenceInput({
      frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15, monthOfYear: 13,
    })).toBe("Pick a month for this yearly schedule.");
  });
});

describe("mergeRecurrenceUpdate", () => {
  const existing: StoredRecurrence = {
    frequency: "yearly",
    daysOfWeek: [],
    monthlyMode: "day_of_month",
    dayOfMonth: 3,
    weekOfMonth: null,
    monthOfYear: 3,
    leadDays: 0,
  };

  it("keeps the existing value when a key is absent from the body", () => {
    const merged = mergeRecurrenceUpdate(existing, {});
    expect(merged.monthOfYear).toBe(3);
    expect(merged.dayOfMonth).toBe(3);
    expect(merged.monthlyMode).toBe("day_of_month");
    expect(merged.frequency).toBe("yearly");
  });

  it("overrides the existing value when a key is present with a real value", () => {
    const merged = mergeRecurrenceUpdate(existing, { monthOfYear: 7 });
    expect(merged.monthOfYear).toBe(7);
    // Untouched keys still fall back to the stored row.
    expect(merged.dayOfMonth).toBe(3);
  });

  it("clears the value when a key is present with null, rather than falling back", () => {
    const merged = mergeRecurrenceUpdate(existing, { monthOfYear: null });
    expect(merged.monthOfYear).toBeUndefined();
  });

  it("rejects PATCH { monthOfYear: null } on a yearly row (validate matches what gets written)", () => {
    const merged = mergeRecurrenceUpdate(existing, { monthOfYear: null });
    expect(validateRecurrenceInput(merged)).toBe("Pick a month for this yearly schedule.");
  });

  it("rejects PATCH { monthlyMode: null } on a monthly nth_weekday row (validate matches what gets written)", () => {
    const monthlyExisting: StoredRecurrence = {
      frequency: "monthly",
      daysOfWeek: [4],
      monthlyMode: "nth_weekday",
      dayOfMonth: null,
      weekOfMonth: 2,
      monthOfYear: null,
      leadDays: 0,
    };
    const merged = mergeRecurrenceUpdate(monthlyExisting, { monthlyMode: null });
    expect(validateRecurrenceInput(merged)).toBe(
      "Pick how the month is anchored: a day of the month, or a weekday.",
    );
  });
});
