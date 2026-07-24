import { describe, it, expect } from "vitest";
import { defaultLeadDays, toRecurrencePayload, type RecurrenceFormFields } from "./recurrence-form";

function form(overrides: Partial<RecurrenceFormFields> = {}): RecurrenceFormFields {
  return {
    frequency: "weekly",
    daysOfWeek: [1, 3, 5],
    monthlyMode: "day_of_month",
    dayOfMonth: 1,
    weekOfMonth: 1,
    monthOfYear: 1,
    leadDays: 0,
    ...overrides,
  };
}

describe("defaultLeadDays", () => {
  it("suggests a lead time scaled to the cadence", () => {
    expect(defaultLeadDays("weekly")).toBe(0);
    expect(defaultLeadDays("monthly")).toBe(3);
    expect(defaultLeadDays("yearly")).toBe(14);
  });
});

describe("toRecurrencePayload", () => {
  it("sends only weekday fields for a weekly rule", () => {
    expect(toRecurrencePayload(form())).toEqual({
      frequency: "weekly",
      daysOfWeek: [1, 3, 5],
      monthlyMode: null,
      dayOfMonth: null,
      weekOfMonth: null,
      monthOfYear: null,
      leadDays: 0,
    });
  });

  it("sends the day and no weekdays for a day-of-month rule", () => {
    const payload = toRecurrencePayload(form({
      frequency: "monthly", monthlyMode: "day_of_month", dayOfMonth: 15, leadDays: 3,
    }));
    expect(payload).toEqual({
      frequency: "monthly",
      daysOfWeek: [],
      monthlyMode: "day_of_month",
      dayOfMonth: 15,
      weekOfMonth: null,
      monthOfYear: null,
      leadDays: 3,
    });
  });

  it("sends a single weekday and the ordinal for an nth-weekday rule", () => {
    const payload = toRecurrencePayload(form({
      frequency: "monthly", monthlyMode: "nth_weekday", weekOfMonth: -1, daysOfWeek: [6, 2],
    }));
    expect(payload.daysOfWeek).toEqual([6]);
    expect(payload.weekOfMonth).toBe(-1);
    expect(payload.dayOfMonth).toBeNull();
  });

  it("includes the month for a yearly rule", () => {
    const payload = toRecurrencePayload(form({
      frequency: "yearly", monthlyMode: "day_of_month", monthOfYear: 3, dayOfMonth: 3, leadDays: 14,
    }));
    expect(payload).toMatchObject({ frequency: "yearly", monthOfYear: 3, dayOfMonth: 3, leadDays: 14 });
  });
});
