import { describe, it, expect } from "vitest";
import { qualifyingBadges, type BadgeRule } from "./badge-rules";

const mk = (id: number, metric: string, requirement: number): BadgeRule =>
  ({ id, metric, requirement }) as BadgeRule;

describe("qualifyingBadges", () => {
  it("grants a badge once the metric reaches the requirement", () => {
    const badges = [mk(1, "tasks_completed", 10)];
    expect(qualifyingBadges(badges, { tasks_completed: 10 }, new Set()))
      .toEqual([badges[0]]);
  });

  it("does not grant a badge below the requirement", () => {
    const badges = [mk(1, "tasks_completed", 10)];
    expect(qualifyingBadges(badges, { tasks_completed: 9 }, new Set())).toEqual([]);
  });

  it("skips badges the user already owns", () => {
    const badges = [mk(1, "tasks_completed", 1), mk(2, "tasks_completed", 5)];
    const got = qualifyingBadges(badges, { tasks_completed: 100 }, new Set([1]));
    expect(got.map((b) => b.id)).toEqual([2]);
  });

  it("grants every backfilled tier at once, not just the highest", () => {
    // A user who jumps from 0 to 60 completions should receive all tiers passed.
    const badges = [
      mk(1, "tasks_completed", 1),
      mk(2, "tasks_completed", 10),
      mk(3, "tasks_completed", 50),
      mk(4, "tasks_completed", 100),
    ];
    const got = qualifyingBadges(badges, { tasks_completed: 60 }, new Set());
    expect(got.map((b) => b.id)).toEqual([1, 2, 3]);
  });

  it("ignores badges whose metric is absent from the stats snapshot", () => {
    // The social award path supplies only social counters; it must not
    // accidentally grant (or withhold) task/points badges.
    const badges = [mk(1, "tasks_completed", 1), mk(2, "allies", 1)];
    const got = qualifyingBadges(badges, { allies: 3 }, new Set());
    expect(got.map((b) => b.id)).toEqual([2]);
  });

  it("treats an explicit zero as a real value, not a missing metric", () => {
    const badges = [mk(1, "boss_attacks", 0)];
    expect(qualifyingBadges(badges, { boss_attacks: 0 }, new Set()))
      .toEqual([badges[0]]);
  });

  it("evaluates several distinct metrics in one pass", () => {
    const badges = [
      mk(1, "allies", 1),
      mk(2, "nudges_sent", 10),
      mk(3, "boss_attacks", 25),
    ];
    const got = qualifyingBadges(
      badges,
      { allies: 2, nudges_sent: 4, boss_attacks: 25 },
      new Set(),
    );
    expect(got.map((b) => b.id)).toEqual([1, 3]);
  });

  it("returns an empty list for an empty catalog", () => {
    expect(qualifyingBadges([], { tasks_completed: 999 }, new Set())).toEqual([]);
  });
});
