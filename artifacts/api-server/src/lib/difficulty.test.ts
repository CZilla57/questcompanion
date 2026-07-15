import { describe, it, expect } from "vitest";
import type { Task } from "@workspace/db";
import {
  assembleLadder,
  snapshotMedium,
  evaluateDifficultyOffer,
  struggleDeltaOnReschedule,
  struggleDeltaOnRescue,
  needsVariantGeneration,
  toOfferInput,
  OFFER_THRESHOLD,
  type OfferInput,
  type OfferContext,
} from "./difficulty";

const NOW = new Date("2026-07-14T19:00:00Z");
const TODAY = "2026-07-14";

function offer(overrides: Partial<OfferInput> = {}): OfferInput {
  return {
    completed: false,
    difficulty: "medium",
    struggleScore: 0,
    dueDate: null,
    isAnchored: false,
    isDailyFocus: false,
    focusDate: null,
    difficultyOfferSnoozedAt: null,
    ...overrides,
  };
}
function ctx(overrides: Partial<OfferContext> = {}): OfferContext {
  return { now: NOW, todayStr: TODAY, mode: "neutral", ...overrides };
}

describe("assembleLadder", () => {
  it("keeps medium as the snapshot and slots in the drafts", () => {
    const medium = { title: "Clean the kitchen", estimatedMinutes: 15, steps: ["a"] };
    const drafts = {
      easy: { title: "Wipe counters", estimatedMinutes: 5, steps: [] },
      hard: { title: "Deep clean", estimatedMinutes: 40, steps: ["x", "y"] },
    };
    expect(assembleLadder(medium, drafts)).toEqual({ easy: drafts.easy, medium, hard: drafts.hard });
  });
});

describe("snapshotMedium", () => {
  it("captures the quest's current title/estimate and step texts", () => {
    expect(snapshotMedium({ title: "T", estimatedMinutes: null }, ["s1", "s2"]))
      .toEqual({ title: "T", estimatedMinutes: null, steps: ["s1", "s2"] });
  });
});

describe("toOfferInput", () => {
  it("copies the eight offer-relevant fields off a task row", () => {
    const snoozedAt = new Date("2026-07-01T00:00:00Z");
    const task = {
      completed: true,
      difficulty: "hard",
      struggleScore: 5,
      dueDate: "2026-07-01",
      isAnchored: true,
      isDailyFocus: true,
      focusDate: "2026-07-09",
      difficultyOfferSnoozedAt: snoozedAt,
    } as Task;

    expect(toOfferInput(task)).toEqual({
      completed: true,
      difficulty: "hard",
      struggleScore: 5,
      dueDate: "2026-07-01",
      isAnchored: true,
      isDailyFocus: true,
      focusDate: "2026-07-09",
      difficultyOfferSnoozedAt: snoozedAt,
    });
  });
});

describe("evaluateDifficultyOffer", () => {
  it("fires when persisted struggle reaches the threshold", () => {
    expect(evaluateDifficultyOffer(offer({ struggleScore: OFFER_THRESHOLD }), ctx())).toBe(true);
    expect(evaluateDifficultyOffer(offer({ struggleScore: OFFER_THRESHOLD - 1 }), ctx())).toBe(false);
  });

  it("adds capped days-past-due, excluding anchored quests", () => {
    // 5 days past due -> capped at +3, meets threshold on its own
    expect(evaluateDifficultyOffer(offer({ dueDate: "2026-07-09" }), ctx())).toBe(true);
    // anchored quest ignores the date entirely
    expect(evaluateDifficultyOffer(offer({ dueDate: "2026-07-09", isAnchored: true }), ctx())).toBe(false);
  });

  it("adds a point for a quest skipped off a past daily board", () => {
    expect(evaluateDifficultyOffer(
      offer({ struggleScore: 2, isDailyFocus: true, focusDate: "2026-07-13" }), ctx(),
    )).toBe(true);
  });

  it("never offers at the easy floor or for completed quests", () => {
    expect(evaluateDifficultyOffer(offer({ struggleScore: 9, difficulty: "easy" }), ctx())).toBe(false);
    expect(evaluateDifficultyOffer(offer({ struggleScore: 9, completed: true }), ctx())).toBe(false);
  });

  it("respects a recent snooze but not an expired one", () => {
    const recent = new Date(NOW.getTime() - 86_400_000); // 1 day ago
    const old = new Date(NOW.getTime() - 5 * 86_400_000); // 5 days ago
    expect(evaluateDifficultyOffer(offer({ struggleScore: 9, difficultyOfferSnoozedAt: recent }), ctx())).toBe(false);
    expect(evaluateDifficultyOffer(offer({ struggleScore: 9, difficultyOfferSnoozedAt: old }), ctx())).toBe(true);
  });

  it("lowers the threshold in frozen mode", () => {
    expect(evaluateDifficultyOffer(offer({ struggleScore: 2 }), ctx())).toBe(false);
    expect(evaluateDifficultyOffer(offer({ struggleScore: 2 }), ctx({ mode: "frozen" }))).toBe(true);
  });
});

describe("struggleDeltaOnReschedule", () => {
  it("returns 1 when rescheduling forward, 0 otherwise", () => {
    expect(struggleDeltaOnReschedule("2026-07-14", "2026-07-20")).toBe(1);
    expect(struggleDeltaOnReschedule("2026-07-14", "2026-07-10")).toBe(0);
    expect(struggleDeltaOnReschedule(null, "2026-07-20")).toBe(0);
  });
});

describe("struggleDeltaOnRescue", () => {
  it("returns 2 for too_big blocker, 1 for others", () => {
    expect(struggleDeltaOnRescue("too_big")).toBe(2);
    expect(struggleDeltaOnRescue("cant_start")).toBe(1);
  });
});

describe("needsVariantGeneration", () => {
  it("returns true only when no variants exist and level is not medium", () => {
    expect(needsVariantGeneration(false, "easy")).toBe(true);
    expect(needsVariantGeneration(false, "medium")).toBe(false);
    expect(needsVariantGeneration(true, "easy")).toBe(false);
  });
});
