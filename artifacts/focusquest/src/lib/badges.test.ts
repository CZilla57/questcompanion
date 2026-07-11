import { describe, it, expect } from "vitest";
import { pickRecentBadges } from "./badges";

const mk = (id: string, earnedAt: string) => ({ id, earnedAt });

describe("pickRecentBadges", () => {
  it("returns the n newest badges, newest first", () => {
    const badges = [
      mk("a", "2026-07-01T10:00:00.000Z"),
      mk("b", "2026-07-08T10:00:00.000Z"),
      mk("c", "2026-07-05T10:00:00.000Z"),
      mk("d", "2026-07-02T10:00:00.000Z"),
    ];
    expect(pickRecentBadges(badges, 3).map((b) => b.id)).toEqual(["b", "c", "d"]);
  });

  it("caps at n even when more are available", () => {
    const badges = [
      mk("a", "2026-07-01T10:00:00.000Z"),
      mk("b", "2026-07-02T10:00:00.000Z"),
      mk("c", "2026-07-03T10:00:00.000Z"),
    ];
    expect(pickRecentBadges(badges, 2)).toHaveLength(2);
  });

  it("returns all when fewer than n exist", () => {
    const badges = [mk("a", "2026-07-01T10:00:00.000Z")];
    expect(pickRecentBadges(badges, 3).map((b) => b.id)).toEqual(["a"]);
  });

  it("returns [] for empty or undefined input", () => {
    expect(pickRecentBadges([], 3)).toEqual([]);
    expect(pickRecentBadges(undefined, 3)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const badges = [
      mk("a", "2026-07-01T10:00:00.000Z"),
      mk("b", "2026-07-08T10:00:00.000Z"),
    ];
    const snapshot = badges.map((b) => b.id);
    pickRecentBadges(badges, 2);
    expect(badges.map((b) => b.id)).toEqual(snapshot);
  });
});
