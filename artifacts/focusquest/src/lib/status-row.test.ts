import { describe, it, expect } from "vitest";
import { statusRowParts } from "./status-row";

describe("statusRowParts", () => {
  it("renders streak, level, and today's XP as plain facts", () => {
    expect(statusRowParts({ streakDays: 6, currentLevel: 4, todayPoints: 35 }))
      .toEqual(["6-day streak", "Lv 4", "35 XP today"]);
  });
  it("omits the streak segment at streak 0 — never leads home with a zero", () => {
    expect(statusRowParts({ streakDays: 0, currentLevel: 1, todayPoints: 0 }))
      .toEqual(["Lv 1", "0 XP today"]);
  });
  it("singularizes day 1", () => {
    expect(statusRowParts({ streakDays: 1, currentLevel: 2, todayPoints: 10 })[0])
      .toBe("1-day streak");
  });
});
