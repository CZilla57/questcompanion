import { describe, it, expect } from "vitest";
import { comparisonWindows } from "./self-week";

describe("comparisonWindows", () => {
  it("splits a UTC user's timeline into week-to-date, same-point, and full last week", () => {
    // Wed 2026-07-22 15:30Z. This Monday: Jul 20. Prev Monday: Jul 13.
    const now = new Date(Date.UTC(2026, 6, 22, 15, 30));
    const w = comparisonWindows(now, "UTC");
    expect(w.weekStartDateKey).toBe("2026-07-20");
    expect(w.current.start.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(w.current.end.toISOString()).toBe(now.toISOString());
    expect(w.samePoint.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(w.samePoint.end.toISOString()).toBe("2026-07-15T15:30:00.000Z"); // same elapsed
    expect(w.lastWeek.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(w.lastWeek.end.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("anchors Mondays in the user's zone, not UTC", () => {
    // 2026-07-21 03:00Z is still Monday Jul 20, 22:00 in Chicago (CDT, UTC-5).
    const now = new Date(Date.UTC(2026, 6, 21, 3, 0));
    const w = comparisonWindows(now, "America/Chicago");
    expect(w.weekStartDateKey).toBe("2026-07-20");
    expect(w.current.start.toISOString()).toBe("2026-07-20T05:00:00.000Z"); // Mon 00:00 CDT
    expect(w.samePoint.start.toISOString()).toBe("2026-07-13T05:00:00.000Z");
    // elapsed = 22h → same-point cutoff lands Mon Jul 13, 22:00 CDT.
    expect(w.samePoint.end.toISOString()).toBe("2026-07-14T03:00:00.000Z");
  });

  it("keeps the closed week honest across a DST shift (spring forward)", () => {
    // US DST began Sun 2026-03-08. Thu Mar 12 18:00Z, Chicago:
    // prev Monday Mar 2 (CST, 06:00Z), this Monday Mar 9 (CDT, 05:00Z) — a 167h week.
    const now = new Date(Date.UTC(2026, 2, 12, 18, 0));
    const w = comparisonWindows(now, "America/Chicago");
    expect(w.lastWeek.start.toISOString()).toBe("2026-03-02T06:00:00.000Z");
    expect(w.lastWeek.end.toISOString()).toBe("2026-03-09T05:00:00.000Z");
    expect(w.current.start.toISOString()).toBe("2026-03-09T05:00:00.000Z");
  });

  it("yields a hair-thin same-point window on Monday morning", () => {
    // Monday 2026-07-20 00:05Z, UTC user: 5 minutes into the week.
    const now = new Date(Date.UTC(2026, 6, 20, 0, 5));
    const w = comparisonWindows(now, "UTC");
    expect(w.samePoint.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(w.samePoint.end.toISOString()).toBe("2026-07-13T00:05:00.000Z");
  });
});
