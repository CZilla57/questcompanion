import { describe, it, expect } from "vitest";
import { assignPoints } from "./auto-points";
import { STARTER_QUESTS, buildStarterQuestRows } from "./starter-quests";

describe("starter quests", () => {
  it("defines exactly four starter quests", () => {
    expect(STARTER_QUESTS).toHaveLength(4);
  });

  it("maps the four quests to four distinct categories", () => {
    const rows = buildStarterQuestRows(42, "2026-07-11");
    const categories = rows.map((r) => r.category);
    // Titles are chosen so assignPoints() spreads them across the category system.
    expect(categories).toEqual(["health", "learning", "household", "deep_work"]);
    expect(new Set(categories).size).toBe(4);
  });

  it("stamps userId, dueDate, medium priority, and assignPoints values on every row", () => {
    const userId = 7;
    const today = "2026-07-11";
    const rows = buildStarterQuestRows(userId, today);

    expect(rows).toHaveLength(STARTER_QUESTS.length);
    for (const row of rows) {
      const expected = assignPoints(row.title, "medium");
      expect(row.userId).toBe(userId);
      expect(row.dueDate).toBe(today);
      expect(row.priority).toBe("medium");
      expect(row.points).toBe(expected.points);
      expect(row.category).toBe(expected.category);
      expect(row.points).toBeGreaterThan(0);
    }
  });
});
