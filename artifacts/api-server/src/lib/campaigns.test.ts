import { describe, it, expect } from "vitest";
import {
  computeCampaignProgress,
  isCampaignReadyToClaim,
  computeCampaignRewardXp,
  nextChapter,
  renumber,
} from "./campaigns";

describe("computeCampaignProgress", () => {
  it("counts chapters and completed chapters", () => {
    expect(computeCampaignProgress([{ status: "completed" }, { status: "active" }, { status: "completed" }]))
      .toEqual({ total: 3, done: 2 });
  });
  it("returns zeros for a chapter-less campaign", () => {
    expect(computeCampaignProgress([])).toEqual({ total: 0, done: 0 });
  });
});

describe("isCampaignReadyToClaim", () => {
  it("is ready when running with >=1 chapter, all completed", () => {
    expect(isCampaignReadyToClaim({ status: "running" }, { total: 3, done: 3 })).toBe(true);
  });
  it("is not ready while chapters remain", () => {
    expect(isCampaignReadyToClaim({ status: "running" }, { total: 3, done: 2 })).toBe(false);
  });
  it("is not ready when chapter-less", () => {
    expect(isCampaignReadyToClaim({ status: "running" }, { total: 0, done: 0 })).toBe(false);
  });
  it("is not ready when set aside", () => {
    expect(isCampaignReadyToClaim({ status: "set_aside" }, { total: 2, done: 2 })).toBe(false);
  });
  it("is not ready when already completed", () => {
    expect(isCampaignReadyToClaim({ status: "completed" }, { total: 2, done: 2 })).toBe(false);
  });
});

describe("computeCampaignRewardXp", () => {
  it("pays 50 per chapter", () => {
    expect(computeCampaignRewardXp(3)).toBe(150);
  });
  it("caps at 5 chapters (250 XP)", () => {
    expect(computeCampaignRewardXp(9)).toBe(250);
  });
  it("pays nothing for a chapter-less campaign", () => {
    expect(computeCampaignRewardXp(0)).toBe(0);
  });
  it("never returns a negative payout", () => {
    expect(computeCampaignRewardXp(-4)).toBe(0);
  });
});

describe("nextChapter", () => {
  const ch = (id: number, order: number | null, status = "active") => ({ id, chapterOrder: order, status });

  it("returns the first incomplete chapter by order, not by array position", () => {
    expect(nextChapter([ch(3, 2), ch(1, 0, "completed"), ch(2, 1)])?.id).toBe(2);
  });
  it("returns null when every chapter is completed", () => {
    expect(nextChapter([ch(1, 0, "completed"), ch(2, 1, "completed")])).toBeNull();
  });
  it("returns null for no chapters", () => {
    expect(nextChapter([])).toBeNull();
  });
  it("sorts null order last so an unordered chapter never hijacks the pointer", () => {
    expect(nextChapter([ch(9, null), ch(4, 1)])?.id).toBe(4);
  });
});

describe("renumber", () => {
  it("assigns dense zero-based order in the given sequence", () => {
    expect(renumber([7, 3, 9])).toEqual([
      { id: 7, chapterOrder: 0 },
      { id: 3, chapterOrder: 1 },
      { id: 9, chapterOrder: 2 },
    ]);
  });
  it("drops duplicate ids, keeping first position", () => {
    expect(renumber([5, 5, 8])).toEqual([
      { id: 5, chapterOrder: 0 },
      { id: 8, chapterOrder: 1 },
    ]);
  });
  it("returns an empty list unchanged", () => {
    expect(renumber([])).toEqual([]);
  });
});
