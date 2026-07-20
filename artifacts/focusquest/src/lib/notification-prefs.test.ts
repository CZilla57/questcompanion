import { describe, it, expect } from "vitest";
import { PREF_CATEGORIES, hourLabel } from "./notification-prefs";

describe("PREF_CATEGORIES", () => {
  it("covers exactly the four server pref keys, in display order", () => {
    expect(PREF_CATEGORIES.map((c) => c.key)).toEqual([
      "protection", "reminders", "reflection", "hero",
    ]);
  });
  it("every category has a non-empty label and hint", () => {
    for (const c of PREF_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("hourLabel", () => {
  it("formats all 24 hours as 12-hour AM/PM", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(1)).toBe("1 AM");
    expect(hourLabel(11)).toBe("11 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(13)).toBe("1 PM");
    expect(hourLabel(23)).toBe("11 PM");
  });
});
