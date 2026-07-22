import { describe, it, expect } from "vitest";
import {
  computeCampaignProgress,
  isCampaignReadyToClaim,
  computeCampaignRewardXp,
  nextChapter,
  renumber,
  canTransition,
  clampString,
  validateStringOrNull,
  validateQuestlineIds,
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
  it("is ready when running with >=1 chapter, all completed, never claimed", () => {
    expect(isCampaignReadyToClaim({ status: "running", rewardXpAwarded: null }, { total: 3, done: 3 })).toBe(true);
  });
  it("is not ready while chapters remain", () => {
    expect(isCampaignReadyToClaim({ status: "running", rewardXpAwarded: null }, { total: 3, done: 2 })).toBe(false);
  });
  it("is not ready when chapter-less", () => {
    expect(isCampaignReadyToClaim({ status: "running", rewardXpAwarded: null }, { total: 0, done: 0 })).toBe(false);
  });
  it("is not ready when set aside", () => {
    expect(isCampaignReadyToClaim({ status: "set_aside", rewardXpAwarded: null }, { total: 2, done: 2 })).toBe(false);
  });
  it("is not ready when already completed", () => {
    expect(isCampaignReadyToClaim({ status: "completed", rewardXpAwarded: null }, { total: 2, done: 2 })).toBe(false);
  });
  it("is not ready once a reward has already been recorded — belt-and-braces against a reopened-then-reclaimed campaign", () => {
    expect(isCampaignReadyToClaim({ status: "running", rewardXpAwarded: 150 }, { total: 3, done: 3 })).toBe(false);
  });
  it("is not ready with a zero-valued prior reward (0 is still 'already awarded', not null)", () => {
    expect(isCampaignReadyToClaim({ status: "running", rewardXpAwarded: 0 }, { total: 0, done: 0 })).toBe(false);
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

describe("canTransition", () => {
  it("allows running -> set_aside", () => {
    expect(canTransition("running", "set_aside")).toBe(true);
  });
  it("allows set_aside -> running", () => {
    expect(canTransition("set_aside", "running")).toBe(true);
  });
  it("allows a no-op transition to the same status, for every known status", () => {
    expect(canTransition("running", "running")).toBe(true);
    expect(canTransition("set_aside", "set_aside")).toBe(true);
    expect(canTransition("completed", "completed")).toBe(true);
  });
  it("blocks every transition out of completed — it is terminal", () => {
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("completed", "set_aside")).toBe(false);
  });
  it("blocks transitioning directly into completed via this predicate", () => {
    expect(canTransition("running", "completed")).toBe(false);
    expect(canTransition("set_aside", "completed")).toBe(false);
  });
  it("rejects an unknown 'from' status", () => {
    expect(canTransition("bogus", "running")).toBe(false);
  });
  it("rejects an unknown 'to' status", () => {
    expect(canTransition("running", "bogus")).toBe(false);
  });
  it("rejects when both sides are unknown", () => {
    expect(canTransition("bogus", "bogus")).toBe(false);
  });
});

describe("clampString", () => {
  it("trims surrounding whitespace", () => {
    expect(clampString("  hello  ", 20)).toBe("hello");
  });
  it("leaves a string under the limit untouched (besides trimming)", () => {
    expect(clampString("hello", 20)).toBe("hello");
  });
  it("truncates a string over the limit", () => {
    expect(clampString("a".repeat(10), 5)).toBe("aaaaa");
  });
  it("keeps a string exactly at the limit", () => {
    expect(clampString("a".repeat(5), 5)).toBe("aaaaa");
  });
});

describe("validateStringOrNull", () => {
  it("accepts null as-is", () => {
    expect(validateStringOrNull(null, 10)).toEqual({ ok: true, value: null });
  });
  it("treats undefined as null (field simply not provided)", () => {
    expect(validateStringOrNull(undefined, 10)).toEqual({ ok: true, value: null });
  });
  it("accepts and clamps a string", () => {
    expect(validateStringOrNull("  hello world  ", 5)).toEqual({ ok: true, value: "hello" });
  });
  it("rejects a number — the type-confusion bug this guards against", () => {
    expect(validateStringOrNull(12345, 10)).toEqual({ ok: false });
  });
  it("rejects an object", () => {
    expect(validateStringOrNull({ foo: "bar" }, 10)).toEqual({ ok: false });
  });
  it("rejects an array", () => {
    expect(validateStringOrNull([1, 2, 3], 10)).toEqual({ ok: false });
  });
  it("rejects a boolean", () => {
    expect(validateStringOrNull(true, 10)).toEqual({ ok: false });
  });
});

describe("validateQuestlineIds", () => {
  it("accepts a valid array of positive integers within the cap", () => {
    expect(validateQuestlineIds([1, 2, 3], 5)).toEqual({ ok: true, ids: [1, 2, 3] });
  });
  it("accepts an empty array (detach-all is legal)", () => {
    expect(validateQuestlineIds([], 5)).toEqual({ ok: true, ids: [] });
  });
  it("rejects a non-array", () => {
    expect(validateQuestlineIds("not-an-array", 5)).toEqual({
      ok: false, error: "questlineIds must be an array of integers",
    });
  });
  it("rejects a non-integer number (1.5) — the type-confusion bug this guards against", () => {
    expect(validateQuestlineIds([1, 1.5, 2], 5).ok).toBe(false);
  });
  it("rejects zero", () => {
    expect(validateQuestlineIds([0], 5).ok).toBe(false);
  });
  it("rejects a negative integer", () => {
    expect(validateQuestlineIds([-3], 5).ok).toBe(false);
  });
  it("rejects a string element", () => {
    expect(validateQuestlineIds(["1"], 5).ok).toBe(false);
  });
  it("rejects an array longer than the cap — the unbounded-payload bug this guards against", () => {
    const result = validateQuestlineIds([1, 2, 3, 4, 5, 6], 5);
    expect(result.ok).toBe(false);
  });
  it("accepts an array exactly at the cap", () => {
    expect(validateQuestlineIds([1, 2, 3, 4, 5], 5).ok).toBe(true);
  });
});
