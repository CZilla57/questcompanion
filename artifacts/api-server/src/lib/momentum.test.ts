import { describe, it, expect } from "vitest";
import { rankMomentum, type MomentumTask, type MomentumContext } from "./momentum";

const NOW = new Date("2026-07-14T19:00:00Z"); // 14:00 Chicago — afternoon (no TOD boost)
const TODAY = "2026-07-14";

let nextId = 1;
function task(overrides: Partial<MomentumTask> = {}): MomentumTask {
  return {
    id: nextId++,
    title: "generic quest",
    priority: "medium",
    category: "admin",
    difficulty: "medium",
    estimatedMinutes: null,
    createdAt: new Date("2026-07-14T08:00:00Z"), // today — no queue-age boost
    dueDate: null,
    isAnchored: false,
    isDailyFocus: false,
    focusDate: null,
    stepsDone: 0,
    stepsOpen: 0,
    ...overrides,
  };
}

function ctx(overrides: Partial<MomentumContext> = {}): MomentumContext {
  return {
    mode: "neutral",
    now: NOW,
    localHour: 14,
    todayStr: TODAY,
    // Every category "already completed" so the variety boost is silent unless a test opts in.
    completedTodayCategories: new Set(["admin", "health", "deep_work", "self_care", "errands", "household", "learning", "finance", "social", "creative", "travel", "default"]),
    ...overrides,
  };
}

describe("rankMomentum", () => {
  it("returns empty for no candidates", () => {
    expect(rankMomentum([], ctx())).toEqual([]);
  });

  it("pinned-today quests dominate (absorption guarantee)", () => {
    const pinned = task({ isDailyFocus: true, focusDate: TODAY });
    const urgent = task({ priority: "high", dueDate: "2026-07-01" });
    const ranked = rankMomentum([urgent, pinned], ctx());
    expect(ranked[0]!.taskId).toBe(pinned.id);
    expect(ranked[0]!.reason).toBe("You picked this one for today — still a good call.");
  });

  it("minutes fit boosts fitting quests and soft-excludes overshoots", () => {
    const fits = task({ estimatedMinutes: 10 });
    const overshoot = task({ estimatedMinutes: 45 });
    const noEstimate = task();
    const ranked = rankMomentum([overshoot, noEstimate, fits], ctx({ minutes: 12 }));
    expect(ranked[0]!.taskId).toBe(fits.id);
    expect(ranked[0]!.reason).toBe("Fits the 12 minutes you've got.");
    expect(ranked[2]!.taskId).toBe(overshoot.id); // −40 sinks it below no-estimate (−5)
  });

  it("distracted mode prefers tiny wins", () => {
    const tiny = task({ estimatedMinutes: 5 });
    const meaty = task({ estimatedMinutes: 60, priority: "high" });
    const ranked = rankMomentum([meaty, tiny], ctx({ mode: "distracted" }));
    expect(ranked[0]!.taskId).toBe(tiny.id);
    expect(ranked[0]!.reason).toBe("Tiny win: about 5 minutes, easy to grab.");
  });

  it("frozen mode de-prioritizes high priority and rewards existing steps", () => {
    const smallStepped = task({ estimatedMinutes: 10, stepsOpen: 3 });
    const bigImportant = task({ priority: "high", estimatedMinutes: 90 });
    const ranked = rankMomentum([bigImportant, smallStepped], ctx({ mode: "frozen" }));
    expect(ranked[0]!.taskId).toBe(smallStepped.id);
    expect(ranked[0]!.reason).toBe("Smallest thing on the list — one step, no pressure.");
    // The high-priority quest scored NEGATIVE relative to a plain quest: pressure off.
    const plain = task();
    const ranked2 = rankMomentum([bigImportant, plain], ctx({ mode: "frozen" }));
    expect(ranked2[0]!.taskId).toBe(plain.id);
  });

  it("focused mode boosts high priority", () => {
    const important = task({ priority: "high" });
    const filler = task({ estimatedMinutes: 5 });
    const ranked = rankMomentum([filler, important], ctx({ mode: "focused" }));
    expect(ranked[0]!.taskId).toBe(important.id);
    expect(ranked[0]!.reason).toBe("Brain's on — this one moves the needle.");
  });

  it("hyperfocus mode prefers continuing an in-progress quest", () => {
    const inProgress = task({ stepsDone: 2, stepsOpen: 1 });
    const coldBig = task({ estimatedMinutes: 45 });
    const ranked = rankMomentum([coldBig, inProgress], ctx({ mode: "hyperfocus" }));
    expect(ranked[0]!.taskId).toBe(inProgress.id);
    expect(ranked[0]!.reason).toBe("You're mid-flow on this one — ride it.");
  });

  it("morning boosts focus categories; evening boosts wind-down categories", () => {
    const deepWork = task({ category: "deep_work" });
    const admin = task({ category: "admin" });
    const morning = rankMomentum([admin, deepWork], ctx({ localHour: 8 }));
    expect(morning[0]!.taskId).toBe(deepWork.id);

    const household = task({ category: "household" });
    const evening = rankMomentum([admin, household], ctx({ localHour: 19 }));
    expect(evening[0]!.taskId).toBe(household.id);
  });

  it("waiting quests get a gentle age boost with anti-shame copy", () => {
    const old = task({ createdAt: new Date("2026-07-10T08:00:00Z") }); // 4 days
    const fresh = task();
    const ranked = rankMomentum([fresh, old], ctx());
    expect(ranked[0]!.taskId).toBe(old.id);
    expect(ranked[0]!.reason).toBe("This one's been waiting patiently.");
  });

  it("past-due (non-anchored) gets a gentle boost; anchored never does", () => {
    const pastDue = task({ dueDate: "2026-07-10" });
    const anchoredPast = task({ dueDate: "2026-07-10", isAnchored: true });
    const fresh = task();
    const ranked = rankMomentum([fresh, anchoredPast, pastDue], ctx());
    expect(ranked[0]!.taskId).toBe(pastDue.id);
    expect(ranked[0]!.reason).toBe("It's ready when you are — the date slipped by.");
  });

  it("variety boost fires for an untouched category", () => {
    const fresh = task({ category: "health" });
    const done = task({ category: "admin" });
    const ranked = rankMomentum([done, fresh], ctx({ completedTodayCategories: new Set(["admin"]) }));
    expect(ranked[0]!.taskId).toBe(fresh.id);
  });

  it("falls back to assignPoints category when stored category is 'default'", () => {
    // "write report" → deep_work via assignPoints; morning boost should apply.
    const legacy = task({ title: "write report", category: "default" });
    const admin = task({ category: "admin" });
    const ranked = rankMomentum([admin, legacy], ctx({ localHour: 8 }));
    expect(ranked[0]!.taskId).toBe(legacy.id);
  });

  it("ties break on older createdAt, then lower id", () => {
    const a = task({ createdAt: new Date("2026-07-14T09:00:00Z") });
    const b = task({ createdAt: new Date("2026-07-14T07:00:00Z") });
    const ranked = rankMomentum([a, b], ctx());
    expect(ranked[0]!.taskId).toBe(b.id);
  });

  it("gives the generic reason when nothing stands out", () => {
    const plain = task();
    expect(rankMomentum([plain], ctx())[0]!.reason).toBe("A solid next step to keep things moving.");
  });
});

describe("pinned structural precedence (absorption override)", () => {
  it("an unestimated pin still outranks a fitting past-due quest when minutes are given", () => {
    const pinned = task({ isDailyFocus: true, focusDate: TODAY }); // no estimate
    const fitting = task({ estimatedMinutes: 20, dueDate: "2026-07-10" });
    const ranked = rankMomentum([fitting, pinned], ctx({ minutes: 30 }));
    expect(ranked[0]!.taskId).toBe(pinned.id);
  });

  it("a pin that overshoots the time budget loses precedence and its boost", () => {
    const bigPin = task({ isDailyFocus: true, focusDate: TODAY, estimatedMinutes: 60 });
    const tinyFit = task({ estimatedMinutes: 5 });
    const ranked = rankMomentum([bigPin, tinyFit], ctx({ minutes: 5 }));
    expect(ranked[0]!.taskId).toBe(tinyFit.id);
  });

  it("frozen mode disqualifies big or unestimated pins in favor of tiny wins", () => {
    const bigPin = task({ isDailyFocus: true, focusDate: TODAY, estimatedMinutes: 60 });
    const unestimatedPin = task({ isDailyFocus: true, focusDate: TODAY });
    const tiny = task({ estimatedMinutes: 5 });
    const ranked = rankMomentum([bigPin, unestimatedPin, tiny], ctx({ mode: "frozen" }));
    expect(ranked[0]!.taskId).toBe(tiny.id);
  });

  it("distracted mode keeps a genuinely tiny pin on top", () => {
    const tinyPin = task({ isDailyFocus: true, focusDate: TODAY, estimatedMinutes: 10 });
    const tinier = task({ estimatedMinutes: 5 });
    const ranked = rankMomentum([tinier, tinyPin], ctx({ mode: "distracted" }));
    expect(ranked[0]!.taskId).toBe(tinyPin.id);
  });

  it("two eligible pins order by score between themselves", () => {
    const pinA = task({ isDailyFocus: true, focusDate: TODAY, estimatedMinutes: 10 });
    const pinB = task({ isDailyFocus: true, focusDate: TODAY });
    const ranked = rankMomentum([pinB, pinA], ctx({ minutes: 15 }));
    expect(ranked[0]!.taskId).toBe(pinA.id); // fit boost outranks noEstimate penalty within pins
  });
});

describe("power window steering", () => {
  const REASON = "You're usually strongest right now — good time for a big swing.";

  it("boosts a big swing over a small quest inside the window", () => {
    const big = task({ estimatedMinutes: 45 });
    const small = task({ estimatedMinutes: 5 });
    const ranked = rankMomentum([small, big], ctx({ powerHours: [14] }));
    expect(ranked[0]!.taskId).toBe(big.id);
    expect(ranked[0]!.reason).toBe(REASON);
  });

  it("all three big-swing qualifiers trigger the boost", () => {
    for (const overrides of [
      { difficulty: "hard" },
      { priority: "high" },
      { estimatedMinutes: 25 },
    ]) {
      const big = task(overrides);
      const inWindow = rankMomentum([big], ctx({ powerHours: [14] }))[0]!.score;
      const outside = rankMomentum([big], ctx())[0]!.score;
      expect(inWindow).toBe(outside + 15);
    }
  });

  it("no boost outside the window — and no penalty either (boost-only)", () => {
    const big = task({ estimatedMinutes: 45 });
    const inOther = rankMomentum([big], ctx({ powerHours: [9] }))[0]!.score; // now is 14
    const without = rankMomentum([big], ctx())[0]!.score;
    expect(inOther).toBe(without);
  });

  it("never pressures frozen or distracted brains", () => {
    const big = task({ estimatedMinutes: 45, priority: "high", difficulty: "hard" });
    for (const mode of ["frozen", "distracted"] as const) {
      const withWindow = rankMomentum([big], ctx({ mode, powerHours: [14] }))[0]!;
      const without = rankMomentum([big], ctx({ mode }))[0]!;
      expect(withWindow.score).toBe(without.score);
      expect(withWindow.reason).not.toBe(REASON);
    }
  });

  it("boost applies in focused mode too", () => {
    const big = task({ estimatedMinutes: 45 });
    const inWindow = rankMomentum([big], ctx({ mode: "focused", powerHours: [14] }))[0]!.score;
    const outside = rankMomentum([big], ctx({ mode: "focused" }))[0]!.score;
    expect(inWindow).toBe(outside + 15);
  });

  it("an eligible pin still structurally outranks a boosted big swing", () => {
    const pinned = task({ isDailyFocus: true, focusDate: TODAY, estimatedMinutes: 5 });
    const big = task({ estimatedMinutes: 45, priority: "high" });
    const ranked = rankMomentum([big, pinned], ctx({ powerHours: [14] }));
    expect(ranked[0]!.taskId).toBe(pinned.id);
  });

  it("undefined powerHours means no signal (route passes [] below confidence)", () => {
    const big = task({ estimatedMinutes: 45 });
    const a = rankMomentum([big], ctx({ powerHours: [] }))[0]!.score;
    const b = rankMomentum([big], ctx())[0]!.score;
    expect(a).toBe(b);
  });
});
