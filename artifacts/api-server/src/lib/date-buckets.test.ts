import { describe, it, expect } from "vitest";
import { resolveTimeZone, localDateKey, buildDayDates, buildDaySlots, localHour } from "./date-buckets";

describe("resolveTimeZone", () => {
  it("returns a valid IANA timezone unchanged", () => {
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to UTC for missing input", () => {
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
  });
});

describe("localDateKey", () => {
  it("uses the local calendar day, not the UTC day", () => {
    // 01:00 UTC on Jul 12 is still Jul 11 (21:00) in New York (UTC-4 in summer).
    const instant = new Date("2026-07-12T01:00:00Z");
    expect(localDateKey(instant, "America/New_York")).toBe("2026-07-11");
    expect(localDateKey(instant, "UTC")).toBe("2026-07-12");
  });

  it("rolls forward for timezones ahead of UTC", () => {
    // 23:00 UTC on Jul 11 is already Jul 12 (08:00) in Tokyo (UTC+9).
    const instant = new Date("2026-07-11T23:00:00Z");
    expect(localDateKey(instant, "Asia/Tokyo")).toBe("2026-07-12");
  });
});

describe("buildDaySlots", () => {
  it("does not extend into the user's future (the reported bug)", () => {
    // Evening for a user west of UTC: server UTC has already rolled to Jul 12.
    const now = new Date("2026-07-12T01:00:00Z");
    const slots = buildDaySlots(now, 3, "America/New_York");
    // Newest slot is the user's local today (Jul 11), not the UTC "tomorrow".
    expect(slots.map((s) => s.date)).toEqual(["2026-07-09", "2026-07-10", "2026-07-11"]);
  });

  it("would show a future day under the old UTC behavior (contrast)", () => {
    const now = new Date("2026-07-12T01:00:00Z");
    const slots = buildDaySlots(now, 3, "UTC");
    expect(slots[slots.length - 1]!.date).toBe("2026-07-12");
  });

  it("returns `days` slots, oldest first", () => {
    const now = new Date("2026-07-12T01:00:00Z");
    const slots = buildDaySlots(now, 14, "America/New_York");
    expect(slots).toHaveLength(14);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.date > slots[i - 1]!.date).toBe(true);
    }
  });

  it("labels each slot with the weekday matching its date", () => {
    const now = new Date("2026-07-12T01:00:00Z");
    const slots = buildDaySlots(now, 3, "America/New_York");
    // 2026-07-11 is a Saturday.
    expect(slots[slots.length - 1]).toEqual({ date: "2026-07-11", label: "Sat" });
  });

  it("buildDayDates returns the same dates as buildDaySlots", () => {
    const now = new Date("2026-07-12T01:00:00Z");
    const dates = buildDayDates(now, 3, "America/New_York");
    expect(dates).toEqual(["2026-07-09", "2026-07-10", "2026-07-11"]);
    expect(dates).toEqual(buildDaySlots(now, 3, "America/New_York").map((s) => s.date));
  });
});

describe("localHour", () => {
  it("uses the local wall-clock hour, not the UTC hour", () => {
    // 01:00 UTC is 21:00 the previous evening in New York (UTC-4 in summer).
    const instant = new Date("2026-07-12T01:00:00Z");
    expect(localHour(instant, "America/New_York")).toBe(21);
    expect(localHour(instant, "UTC")).toBe(1);
  });

  it("returns 0 (not 24) at local midnight", () => {
    // 04:00 UTC is exactly midnight in New York (UTC-4).
    const instant = new Date("2026-07-11T04:00:00Z");
    expect(localHour(instant, "America/New_York")).toBe(0);
  });
});
