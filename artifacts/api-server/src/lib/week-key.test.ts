import { describe, it, expect } from "vitest";
import { getWeekKey } from "./week-key";

describe("getWeekKey", () => {
  it("formats as YYYY-Www with a zero-padded week number", () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(getWeekKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
  });

  it("returns the same key for every day within one ISO week", () => {
    const mon = getWeekKey(new Date(Date.UTC(2026, 6, 13))); // Mon 2026-07-13
    const sun = getWeekKey(new Date(Date.UTC(2026, 6, 19))); // Sun 2026-07-19
    expect(mon).toBe(sun);
    expect(mon).toBe("2026-W29");
  });

  it("rolls to the next key across the week boundary", () => {
    const sun = getWeekKey(new Date(Date.UTC(2026, 6, 19))); // Sun 2026-07-19
    const mon = getWeekKey(new Date(Date.UTC(2026, 6, 20))); // Mon 2026-07-20
    expect(sun).toBe("2026-W29");
    expect(mon).toBe("2026-W30");
  });
});
