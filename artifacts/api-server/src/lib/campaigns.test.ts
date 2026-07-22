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
  decideAttachToCampaign,
  canDetachFromCampaign,
  validateChapterOrder,
  validateCampaignId,
  detachConflictsWithChapterOrder,
  validateTitle,
  validateOptionalString,
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

describe("decideAttachToCampaign", () => {
  it("allows attaching an unclaimed questline to a running campaign", () => {
    expect(decideAttachToCampaign(null, 5, "running")).toEqual({ ok: true });
  });
  it("allows attaching an unclaimed questline to a set-aside campaign", () => {
    expect(decideAttachToCampaign(null, 5, "set_aside")).toEqual({ ok: true });
  });
  it("allows re-sending the campaign the questline is already in (no-op)", () => {
    expect(decideAttachToCampaign(5, 5, "running")).toEqual({ ok: true });
  });
  it("blocks attaching to a different campaign than the one it's already in — the recycle-for-XP exploit this closes", () => {
    expect(decideAttachToCampaign(5, 6, "running")).toEqual({ ok: false, reason: "different_campaign" });
  });
  it("blocks attaching into a completed campaign — mirrors PATCH /campaigns/:id/chapters refusing a completed target", () => {
    expect(decideAttachToCampaign(null, 5, "completed")).toEqual({ ok: false, reason: "completed_campaign" });
  });
  it("blocks even a no-op resend into a campaign that has since completed — no exception for re-sending the same id", () => {
    expect(decideAttachToCampaign(5, 5, "completed")).toEqual({ ok: false, reason: "completed_campaign" });
  });
});

describe("canDetachFromCampaign", () => {
  it("allows detaching from a running campaign", () => {
    expect(canDetachFromCampaign("running")).toBe(true);
  });
  it("allows detaching from a set-aside campaign", () => {
    expect(canDetachFromCampaign("set_aside")).toBe(true);
  });
  it("blocks detaching from a completed campaign — its chapters are part of the record", () => {
    expect(canDetachFromCampaign("completed")).toBe(false);
  });
});

describe("validateChapterOrder", () => {
  it("accepts a non-negative integer", () => {
    expect(validateChapterOrder(0)).toEqual({ ok: true, value: 0 });
    expect(validateChapterOrder(7)).toEqual({ ok: true, value: 7 });
  });
  it("accepts null", () => {
    expect(validateChapterOrder(null)).toEqual({ ok: true, value: null });
  });
  it("rejects a fractional number — the type-confusion bug this guards against", () => {
    expect(validateChapterOrder(1.5)).toEqual({ ok: false });
  });
  it("rejects a negative integer", () => {
    expect(validateChapterOrder(-1)).toEqual({ ok: false });
  });
  it("rejects a string", () => {
    expect(validateChapterOrder("3")).toEqual({ ok: false });
  });
  it("rejects a boolean", () => {
    expect(validateChapterOrder(true)).toEqual({ ok: false });
  });
});

describe("validateCampaignId", () => {
  it("accepts a non-negative integer", () => {
    expect(validateCampaignId(0)).toEqual({ ok: true, value: 0 });
    expect(validateCampaignId(7)).toEqual({ ok: true, value: 7 });
  });
  it("accepts null (detach)", () => {
    expect(validateCampaignId(null)).toEqual({ ok: true, value: null });
  });
  it("rejects a fractional number — the type-confusion bug this guards against", () => {
    expect(validateCampaignId(1.5)).toEqual({ ok: false });
  });
  it("rejects a negative integer", () => {
    expect(validateCampaignId(-1)).toEqual({ ok: false });
  });
  it("rejects a string", () => {
    expect(validateCampaignId("3")).toEqual({ ok: false });
  });
  it("rejects a boolean — the other type-confusion bug this guards against", () => {
    expect(validateCampaignId(true)).toEqual({ ok: false });
  });
});

describe("detachConflictsWithChapterOrder", () => {
  it("flags a detach paired with an explicit chapterOrder", () => {
    expect(detachConflictsWithChapterOrder(null, 7)).toBe(true);
  });
  it("flags a detach paired with an explicit null chapterOrder too", () => {
    expect(detachConflictsWithChapterOrder(null, null)).toBe(true);
  });
  it("does not flag a detach with no chapterOrder field", () => {
    expect(detachConflictsWithChapterOrder(null, undefined)).toBe(false);
  });
  it("does not flag an attach paired with chapterOrder", () => {
    expect(detachConflictsWithChapterOrder(5, 2)).toBe(false);
  });
  it("does not flag a plain field edit with no campaignId at all", () => {
    expect(detachConflictsWithChapterOrder(undefined, 2)).toBe(false);
  });
});

describe("validateTitle", () => {
  it("accepts and trims a valid title", () => {
    expect(validateTitle("  Chapter One  ")).toEqual({ ok: true, value: "Chapter One" });
  });
  it("rejects an empty-after-trim title", () => {
    expect(validateTitle("   ")).toEqual({ ok: false });
  });
  it("rejects a number — the type-confusion bug this guards against (.trim() on a non-string throws)", () => {
    expect(validateTitle(5)).toEqual({ ok: false });
  });
  it("rejects null", () => {
    expect(validateTitle(null)).toEqual({ ok: false });
  });
});

describe("validateOptionalString", () => {
  it("accepts undefined as null (field not provided)", () => {
    expect(validateOptionalString(undefined)).toEqual({ ok: true, value: null });
  });
  it("accepts null as-is", () => {
    expect(validateOptionalString(null)).toEqual({ ok: true, value: null });
  });
  it("accepts a string unchanged, with no trimming or clamping", () => {
    expect(validateOptionalString("  spaced  ")).toEqual({ ok: true, value: "  spaced  " });
  });
  it("accepts an empty string", () => {
    expect(validateOptionalString("")).toEqual({ ok: true, value: "" });
  });
  it("rejects a number — the type-confusion bug this guards against", () => {
    expect(validateOptionalString(5)).toEqual({ ok: false });
  });
  it("rejects an object", () => {
    expect(validateOptionalString({ a: 1 })).toEqual({ ok: false });
  });
});
