import { describe, it, expect } from "vitest";
import { spawnWindow, ruleFromTemplate } from "./spawn-window";

describe("spawnWindow", () => {
  it("is a single day when leadDays is 0", () => {
    const w = spawnWindow(new Date("2026-07-24T12:00:00Z"), "UTC", 0);
    expect(w).toEqual({ from: "2026-07-24", to: "2026-07-24" });
  });

  it("extends forward by leadDays", () => {
    const w = spawnWindow(new Date("2026-07-24T12:00:00Z"), "UTC", 3);
    expect(w).toEqual({ from: "2026-07-24", to: "2026-07-27" });
  });

  it("uses the user's local calendar day, not UTC", () => {
    // 01:00 UTC Jul 12 is still Jul 11 (21:00) in New York.
    const instant = new Date("2026-07-12T01:00:00Z");
    expect(spawnWindow(instant, "America/New_York", 0).from).toBe("2026-07-11");
    expect(spawnWindow(instant, "UTC", 0).from).toBe("2026-07-12");
  });

  it("rolls forward for timezones ahead of UTC", () => {
    // 23:00 UTC Jul 11 is already Jul 12 in Tokyo.
    const instant = new Date("2026-07-11T23:00:00Z");
    expect(spawnWindow(instant, "Asia/Tokyo", 0).from).toBe("2026-07-12");
  });

  it("falls back to UTC for a null or invalid timezone", () => {
    const instant = new Date("2026-07-12T01:00:00Z");
    expect(spawnWindow(instant, null, 0).from).toBe("2026-07-12");
    expect(spawnWindow(instant, "Not/AZone", 0).from).toBe("2026-07-12");
  });

  it("treats a negative or absurd leadDays as zero-width", () => {
    const instant = new Date("2026-07-24T12:00:00Z");
    expect(spawnWindow(instant, "UTC", -5)).toEqual({ from: "2026-07-24", to: "2026-07-24" });
    expect(spawnWindow(instant, "UTC", 9999).to).toBe("2026-09-22"); // clamped to 60
  });

  it("counts whole days across a DST spring-forward", () => {
    // US DST begins 2026-03-08. A window spanning it must still be 7 calendar
    // days, not 7 days minus an hour — date keys are stepped on UTC anchors.
    const w = spawnWindow(new Date("2026-03-05T18:00:00Z"), "America/New_York", 7);
    expect(w).toEqual({ from: "2026-03-05", to: "2026-03-12" });
  });

  it("counts whole days across a DST fall-back", () => {
    // US DST ends 2026-11-01.
    const w = spawnWindow(new Date("2026-10-29T18:00:00Z"), "America/New_York", 5);
    expect(w).toEqual({ from: "2026-10-29", to: "2026-11-03" });
  });
});

describe("ruleFromTemplate", () => {
  const row = {
    daysOfWeek: "1,3,5",
    frequency: "weekly",
    monthlyMode: null,
    dayOfMonth: null,
    weekOfMonth: null,
    monthOfYear: null,
    startDate: "2026-01-01",
    endDate: null,
  };

  it("parses the weekday CSV", () => {
    expect(ruleFromTemplate(row).daysOfWeek).toEqual([1, 3, 5]);
  });

  it("drops junk and out-of-range weekdays", () => {
    expect(ruleFromTemplate({ ...row, daysOfWeek: "1, ,9,x,3" }).daysOfWeek).toEqual([1, 3]);
  });

  it("carries the cadence columns through unchanged", () => {
    const monthly = ruleFromTemplate({
      ...row,
      frequency: "monthly",
      monthlyMode: "nth_weekday",
      weekOfMonth: -1,
      daysOfWeek: "6",
    });
    expect(monthly.frequency).toBe("monthly");
    expect(monthly.monthlyMode).toBe("nth_weekday");
    expect(monthly.weekOfMonth).toBe(-1);
    expect(monthly.daysOfWeek).toEqual([6]);
  });

  it("defaults an unknown frequency to weekly", () => {
    expect(ruleFromTemplate({ ...row, frequency: "fortnightly" }).frequency).toBe("weekly");
  });
});
