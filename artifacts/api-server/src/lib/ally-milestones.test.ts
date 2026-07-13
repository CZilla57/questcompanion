import { describe, it, expect } from "vitest";
import { MILESTONE_TYPES, isMilestoneType, hasFreshMilestone } from "./ally-milestones";

describe("MILESTONE_TYPES", () => {
  it("is exactly the five celebratable types", () => {
    expect([...MILESTONE_TYPES]).toEqual([
      "level_up", "badge_earned", "streak_milestone", "all_day_bonus", "questline_complete",
    ]);
  });
  it("classifies types", () => {
    expect(isMilestoneType("level_up")).toBe(true);
    expect(isMilestoneType("task_completed")).toBe(false);
  });
});

describe("hasFreshMilestone", () => {
  const now = new Date("2026-07-12T12:00:00Z");

  it("is true when a milestone is within the window", () => {
    const rows = [{ type: "level_up", createdAt: new Date("2026-07-12T06:00:00Z") }];
    expect(hasFreshMilestone(rows, now, 48)).toBe(true);
  });
  it("is false when the milestone is older than the window", () => {
    const rows = [{ type: "level_up", createdAt: new Date("2026-07-09T06:00:00Z") }];
    expect(hasFreshMilestone(rows, now, 48)).toBe(false);
  });
  it("ignores non-milestone activity even if recent", () => {
    const rows = [{ type: "task_completed", createdAt: new Date("2026-07-12T11:59:00Z") }];
    expect(hasFreshMilestone(rows, now, 48)).toBe(false);
  });
  it("is false for an empty feed", () => {
    expect(hasFreshMilestone([], now, 48)).toBe(false);
  });
});
