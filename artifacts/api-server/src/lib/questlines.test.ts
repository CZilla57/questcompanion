import { describe, it, expect } from "vitest";
import {
  computeProgress,
  isReadyToClaim,
  computeRewardXp,
  isQuestlineAssignable,
} from "./questlines";

describe("computeProgress", () => {
  it("counts total and done", () => {
    expect(computeProgress([{ completed: true }, { completed: false }, { completed: true }]))
      .toEqual({ total: 3, done: 2 });
  });
  it("returns zeros for an empty questline", () => {
    expect(computeProgress([])).toEqual({ total: 0, done: 0 });
  });
});

describe("isReadyToClaim", () => {
  it("is ready when active with >=1 quest all done", () => {
    expect(isReadyToClaim({ status: "active" }, { total: 3, done: 3 })).toBe(true);
  });
  it("is not ready when quests remain", () => {
    expect(isReadyToClaim({ status: "active" }, { total: 3, done: 2 })).toBe(false);
  });
  it("is not ready when empty (total 0)", () => {
    expect(isReadyToClaim({ status: "active" }, { total: 0, done: 0 })).toBe(false);
  });
  it("is not ready when already completed", () => {
    expect(isReadyToClaim({ status: "completed" }, { total: 3, done: 3 })).toBe(false);
  });
});

describe("computeRewardXp", () => {
  it("scales 25 XP per quest", () => {
    expect(computeRewardXp(3)).toBe(75);
  });
  it("caps at 8 quests (200 XP)", () => {
    expect(computeRewardXp(8)).toBe(200);
    expect(computeRewardXp(40)).toBe(200);
  });
  it("is 0 for an empty questline", () => {
    expect(computeRewardXp(0)).toBe(0);
  });
});

describe("isQuestlineAssignable", () => {
  it("allows a one-off quest", () => {
    expect(isQuestlineAssignable({ recurringTaskId: null })).toBe(true);
  });
  it("rejects a recurring-spawned quest", () => {
    expect(isQuestlineAssignable({ recurringTaskId: 7 })).toBe(false);
  });
});
