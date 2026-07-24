import { describe, it, expect } from "vitest";
import { nextStreakState } from "./streak-cadence";

const existing = {
  currentStreak: 4,
  longestStreak: 9,
  lastCompletedDate: "2026-06-15",
  lastPeriodKey: "2026-06",
};

describe("nextStreakState — weekly (unchanged behavior)", () => {
  it("advances when the previous completion was yesterday", () => {
    const r = nextStreakState({
      frequency: "weekly",
      completionDate: "2026-07-24",
      occurrenceDate: "2026-07-24",
      existing: { currentStreak: 3, longestStreak: 5, lastCompletedDate: "2026-07-23", lastPeriodKey: null },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 4, longestStreak: 5 });
  });

  it("resets when a day was skipped", () => {
    const r = nextStreakState({
      frequency: "weekly",
      completionDate: "2026-07-24",
      occurrenceDate: "2026-07-24",
      existing: { currentStreak: 3, longestStreak: 5, lastCompletedDate: "2026-07-21", lastPeriodKey: null },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, longestStreak: 5 });
  });

  it("reports already-counted for a repeat on the same day", () => {
    const r = nextStreakState({
      frequency: "weekly",
      completionDate: "2026-07-24",
      occurrenceDate: "2026-07-24",
      existing: { currentStreak: 3, longestStreak: 5, lastCompletedDate: "2026-07-24", lastPeriodKey: null },
    });
    expect(r.status).toBe("already_counted");
  });

  it("leaves the period key null", () => {
    const r = nextStreakState({
      frequency: "weekly",
      completionDate: "2026-07-24",
      occurrenceDate: "2026-07-24",
      existing: null,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, periodKey: null });
  });
});

describe("nextStreakState — monthly", () => {
  it("advances across consecutive months", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-07-16",
      occurrenceDate: "2026-07-15",
      existing,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 5, longestStreak: 9, periodKey: "2026-07" });
  });

  it("raises the longest streak when the new streak exceeds it", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-07-15",
      occurrenceDate: "2026-07-15",
      existing: { ...existing, currentStreak: 9, longestStreak: 9 },
    });
    expect(r).toMatchObject({ currentStreak: 10, longestStreak: 10 });
  });

  it("resets to 1 when a month was skipped", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-08-15",
      occurrenceDate: "2026-08-15",
      existing,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, periodKey: "2026-08" });
  });

  it("counts a late completion in the occurrence's period, not the completion's", () => {
    // Due Jul 31, actually finished Aug 2 — still the July beat.
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-08-02",
      occurrenceDate: "2026-07-31",
      existing,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 5, periodKey: "2026-07" });
  });

  it("reports already-counted for a second completion in the same month", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-06-20",
      occurrenceDate: "2026-06-15",
      existing,
    });
    expect(r.status).toBe("already_counted");
  });

  it("starts at 1 with no existing row", () => {
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-07-15",
      occurrenceDate: "2026-07-15",
      existing: null,
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, longestStreak: 1, periodKey: "2026-07" });
  });

  it("treats a missing period key on an existing row as a reset, not a crash", () => {
    // A weekly template switched to monthly: no period key was ever stored.
    const r = nextStreakState({
      frequency: "monthly",
      completionDate: "2026-07-15",
      occurrenceDate: "2026-07-15",
      existing: { currentStreak: 4, longestStreak: 9, lastCompletedDate: "2026-06-15", lastPeriodKey: null },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, periodKey: "2026-07" });
  });
});

describe("nextStreakState — yearly", () => {
  it("advances across consecutive years", () => {
    const r = nextStreakState({
      frequency: "yearly",
      completionDate: "2027-03-03",
      occurrenceDate: "2027-03-03",
      existing: { currentStreak: 2, longestStreak: 2, lastCompletedDate: "2026-03-03", lastPeriodKey: "2026" },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 3, periodKey: "2027" });
  });

  it("resets when a year was skipped", () => {
    const r = nextStreakState({
      frequency: "yearly",
      completionDate: "2028-03-03",
      occurrenceDate: "2028-03-03",
      existing: { currentStreak: 2, longestStreak: 2, lastCompletedDate: "2026-03-03", lastPeriodKey: "2026" },
    });
    expect(r).toMatchObject({ status: "advanced", currentStreak: 1, periodKey: "2028" });
  });
});
