import { describe, it, expect } from "vitest";
import {
  utcDateString,
  anchoredTaskGatesBonus,
  isBonusGatingTask,
  countsAsTodayCompletion,
} from "./anchored-tasks";

const today = "2026-07-12";
const old = new Date("2026-07-01T00:00:00Z");

describe("utcDateString", () => {
  it("returns the YYYY-MM-DD portion in UTC", () => {
    expect(utcDateString(new Date("2026-07-12T23:30:00Z"))).toBe("2026-07-12");
  });
});

describe("anchoredTaskGatesBonus", () => {
  it("does not gate a non-anchored task", () => {
    expect(anchoredTaskGatesBonus({ isAnchored: false, createdAt: old }, today)).toBe(false);
  });
  it("does not gate an anchored task created today (grace)", () => {
    expect(anchoredTaskGatesBonus({ isAnchored: true, createdAt: new Date("2026-07-12T09:00:00Z") }, today)).toBe(false);
  });
  it("gates an anchored task created before today", () => {
    expect(anchoredTaskGatesBonus({ isAnchored: true, createdAt: new Date("2026-07-11T09:00:00Z") }, today)).toBe(true);
  });
});

describe("isBonusGatingTask", () => {
  it("includes a task due today", () => {
    expect(isBonusGatingTask({ dueDate: today, isAnchored: false, createdAt: old }, today)).toBe(true);
  });
  it("excludes a task due another day", () => {
    expect(isBonusGatingTask({ dueDate: "2026-07-15", isAnchored: false, createdAt: old }, today)).toBe(false);
  });
  it("includes a past-grace anchored task", () => {
    expect(isBonusGatingTask({ dueDate: null, isAnchored: true, createdAt: old }, today)).toBe(true);
  });
  it("excludes an anchored task created today", () => {
    expect(isBonusGatingTask({ dueDate: null, isAnchored: true, createdAt: new Date("2026-07-12T01:00:00Z") }, today)).toBe(false);
  });
});

describe("countsAsTodayCompletion", () => {
  it("counts a task due today", () => {
    expect(countsAsTodayCompletion({ dueDate: today, isAnchored: false, completedAt: null }, today)).toBe(true);
  });
  it("counts an anchored task completed today", () => {
    expect(countsAsTodayCompletion({ dueDate: null, isAnchored: true, completedAt: new Date("2026-07-12T20:00:00Z") }, today)).toBe(true);
  });
  it("does not count an anchored task completed another day", () => {
    expect(countsAsTodayCompletion({ dueDate: null, isAnchored: true, completedAt: new Date("2026-07-11T20:00:00Z") }, today)).toBe(false);
  });
  it("does not count an anchored task with no completion time", () => {
    expect(countsAsTodayCompletion({ dueDate: null, isAnchored: true, completedAt: null }, today)).toBe(false);
  });
});
