import { describe, it, expect } from "vitest";
import {
  eligibleKinds, selectContextNudge,
  SPACING_MIN,
  type NudgeGateState, type ContextNudgeInputs, type OpenQuestLite,
} from "./context-nudges";

const NOW = new Date("2026-07-16T12:00:00Z"); // wall-clock time is irrelevant; localHour is supplied explicitly
const TODAY = "2026-07-16";
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function gate(over: Partial<NudgeGateState> = {}): NudgeGateState {
  return {
    now: NOW, localHour: 10, localToday: TODAY,
    sentDates: { dueToday: null, powerWindow: null, quickWin: null },
    contextNudgedAt: null,
    ...over,
  };
}

function quest(over: Partial<OpenQuestLite> = {}): OpenQuestLite {
  return {
    id: 1, title: "Pay bills", dueDate: TODAY, category: "errands",
    estimatedMinutes: null, difficulty: "medium", priority: "medium",
    ...over,
  };
}

function inputs(over: Partial<ContextNudgeInputs> = {}): ContextNudgeInputs {
  return { ...gate(), patterns: null, openQuests: [quest()], ...over };
}

describe("eligibleKinds — global envelope", () => {
  it("is empty outside waking hours (6 and 22), non-empty at the 7 and 21 boundaries", () => {
    expect(eligibleKinds(gate({ localHour: 6 }))).toEqual([]);
    expect(eligibleKinds(gate({ localHour: 22 }))).toEqual([]);
    expect(eligibleKinds(gate({ localHour: 7 }))).toContain("power_window");
    expect(eligibleKinds(gate({ localHour: 21 }))).toContain("power_window");
  });

  it("is empty once 2 kinds have been sent today", () => {
    expect(eligibleKinds(gate({
      localHour: 19,
      sentDates: { dueToday: null, powerWindow: TODAY, quickWin: TODAY },
    }))).toEqual([]);
  });

  it("counts only TODAY's sends toward the cap", () => {
    expect(eligibleKinds(gate({
      sentDates: { dueToday: "2026-07-15", powerWindow: "2026-07-15", quickWin: null },
    }))).toContain("power_window");
  });

  it("enforces 90-min spacing: 89 min ago blocks, 91 min ago does not", () => {
    expect(eligibleKinds(gate({ contextNudgedAt: minAgo(SPACING_MIN - 1) }))).toEqual([]);
    expect(eligibleKinds(gate({ contextNudgedAt: minAgo(SPACING_MIN + 1) }))).toContain("power_window");
  });
});

describe("eligibleKinds — per-kind windows and dedup", () => {
  it("due_today only appears at hour 19", () => {
    expect(eligibleKinds(gate({ localHour: 18 }))).not.toContain("due_today");
    expect(eligibleKinds(gate({ localHour: 19 }))).toContain("due_today");
    expect(eligibleKinds(gate({ localHour: 20 }))).not.toContain("due_today");
  });

  it("quick_win only appears in [16, 18)", () => {
    expect(eligibleKinds(gate({ localHour: 15 }))).not.toContain("quick_win");
    expect(eligibleKinds(gate({ localHour: 16 }))).toContain("quick_win");
    expect(eligibleKinds(gate({ localHour: 17 }))).toContain("quick_win");
    expect(eligibleKinds(gate({ localHour: 18 }))).not.toContain("quick_win");
  });

  it("power_window appears at any envelope hour (learned hour unknown pre-patterns)", () => {
    expect(eligibleKinds(gate({ localHour: 7 }))).toContain("power_window");
    expect(eligibleKinds(gate({ localHour: 13 }))).toContain("power_window");
  });

  it("a kind already sent today drops out; others remain", () => {
    const kinds = eligibleKinds(gate({
      localHour: 19,
      sentDates: { dueToday: TODAY, powerWindow: null, quickWin: null },
    }));
    expect(kinds).not.toContain("due_today");
    expect(kinds).toContain("power_window");
  });

  it("returns kinds in priority order due_today > power_window > quick_win", () => {
    // hour 19 can never include quick_win; verify relative order of the other two.
    expect(eligibleKinds(gate({ localHour: 19 }))).toEqual(["due_today", "power_window"]);
    expect(eligibleKinds(gate({ localHour: 16 }))).toEqual(["power_window", "quick_win"]);
  });
});

describe("selectContextNudge — due_today", () => {
  it("fires at 19 with a singular body naming the quest", () => {
    const n = selectContextNudge(inputs({ localHour: 19, openQuests: [quest({ title: "Water plants" })] }));
    expect(n?.kind).toBe("due_today");
    expect(n?.title).toBe("Still time for a win 🌙");
    expect(n?.body).toBe("'Water plants' is due today and still open — one small push keeps the momentum. Daily bonus if you clear it!");
    expect(n?.tag).toBe("context-nudge");
    expect(n?.url).toBe("/");
  });

  it("fires at 19 with a plural count body", () => {
    const n = selectContextNudge(inputs({
      localHour: 19,
      openQuests: [quest({ id: 1 }), quest({ id: 2, title: "Dishes" })],
    }));
    expect(n?.body).toBe("2 quests due today are still open — even one keeps the momentum. Clear them all for the daily bonus!");
  });

  it("ignores anchored (null dueDate) and overdue quests for due_today", () => {
    const n = selectContextNudge(inputs({
      localHour: 19,
      openQuests: [quest({ dueDate: null }), quest({ id: 2, dueDate: "2026-07-15" })],
    }));
    expect(n?.kind).not.toBe("due_today");
  });

  it("returns null with no open quests at all", () => {
    expect(selectContextNudge(inputs({ localHour: 19, openQuests: [] }))).toBeNull();
  });

  it("returns null when spacing blocks, even with due-today quests waiting", () => {
    expect(selectContextNudge(inputs({ localHour: 19, contextNudgedAt: minAgo(30) }))).toBeNull();
  });
});

import type { PatternSummary } from "./patterns";

function patterns(over: Partial<PatternSummary> = {}): PatternSummary {
  return {
    windowDays: 28,
    sampleSize: { completions: 20, focusMinutes: 300, checkins: 5, reflections: 4 },
    confidence: "ok",
    powerHours: [{ hour: 14, score: 8 }, { hour: 9, score: 5 }, { hour: 20, score: 3 }],
    bestDay: null,
    medianQuestMinutes: null,
    categoryMinutes: [],
    modeByBlock: [],
    topHelpers: [],
    topBlockers: [],
    ...over,
  };
}

describe("selectContextNudge — power_window", () => {
  it("fires at the top learned power hour with learned copy at ok confidence", () => {
    const n = selectContextNudge(inputs({ localHour: 14, patterns: patterns() }));
    expect(n?.kind).toBe("power_window");
    expect(n?.title).toBe("Power window open ⚡");
    expect(n?.body).toBe("This is usually your strongest hour. 'Pay bills' would fit great right now.");
  });

  it("does NOT fire at a lower-scored power hour", () => {
    expect(selectContextNudge(inputs({ localHour: 20, patterns: patterns() }))).toBeNull();
  });

  it("falls back to 9:00 default with default copy below ok confidence", () => {
    const low = patterns({ confidence: "low" });
    expect(selectContextNudge(inputs({ localHour: 14, patterns: low }))).toBeNull();
    const n = selectContextNudge(inputs({ localHour: 9, patterns: low }));
    expect(n?.kind).toBe("power_window");
    expect(n?.title).toBe("Fresh start ☀️");
    expect(n?.body).toBe("'Pay bills' is ready when you are — mornings are for momentum.");
  });

  it("falls back to 9:00 default when patterns are null or powerHours empty", () => {
    expect(selectContextNudge(inputs({ localHour: 9, patterns: null }))?.kind).toBe("power_window");
    const empty = patterns({ powerHours: [] });
    expect(selectContextNudge(inputs({ localHour: 9, patterns: empty }))?.kind).toBe("power_window");
  });

  it("skips an out-of-envelope top hour and uses the next-best in-envelope power hour, still learned", () => {
    const night = patterns({ powerHours: [{ hour: 23, score: 9 }, { hour: 10, score: 4 }] });
    const n = selectContextNudge(inputs({ localHour: 10, patterns: night }));
    expect(n?.kind).toBe("power_window");
    expect(n?.title).toBe("Power window open ⚡");
    expect(selectContextNudge(inputs({ localHour: 23, patterns: night }))).toBeNull(); // envelope
  });

  it("uses the 9:00 default when ALL power hours are out of envelope", () => {
    const allNight = patterns({ powerHours: [{ hour: 23, score: 9 }, { hour: 2, score: 4 }] });
    const n = selectContextNudge(inputs({ localHour: 9, patterns: allNight }));
    expect(n?.title).toBe("Fresh start ☀️");
  });

  it("prefers the big-swing quest (hard difficulty), tie-broken by lowest id", () => {
    const quests = [
      quest({ id: 3, title: "Fold laundry" }),
      quest({ id: 5, title: "Write report", difficulty: "hard" }),
      quest({ id: 9, title: "Tax forms", difficulty: "hard" }),
    ];
    const n = selectContextNudge(inputs({ localHour: 14, patterns: patterns(), openQuests: quests }));
    expect(n?.body).toContain("'Write report'");
  });

  it("treats high priority and ≥25-min estimates as big swings too", () => {
    const byPriority = [quest({ id: 2 }), quest({ id: 4, title: "Call landlord", priority: "high" })];
    expect(selectContextNudge(inputs({ localHour: 14, patterns: patterns(), openQuests: byPriority }))?.body)
      .toContain("'Call landlord'");
    const byEstimate = [quest({ id: 2 }), quest({ id: 4, title: "Deep clean", estimatedMinutes: 30 })];
    expect(selectContextNudge(inputs({ localHour: 14, patterns: patterns(), openQuests: byEstimate }))?.body)
      .toContain("'Deep clean'");
  });

  it("falls back to the lowest-id open quest when nothing is a big swing", () => {
    const quests = [quest({ id: 7, title: "Water plants" }), quest({ id: 3, title: "Dishes" })];
    const n = selectContextNudge(inputs({ localHour: 14, patterns: patterns(), openQuests: quests }));
    expect(n?.body).toContain("'Dishes'");
  });

  it("counts anchored (null dueDate) quests as nudgeable", () => {
    const n = selectContextNudge(inputs({
      localHour: 14, patterns: patterns(),
      openQuests: [quest({ dueDate: null })],
    }));
    expect(n?.kind).toBe("power_window");
  });
});

describe("selectContextNudge — quick_win", () => {
  const fastErrands = patterns({
    powerHours: [{ hour: 9, score: 5 }], // keep power_window away from hours 16–17
    categoryMinutes: [{ category: "errands", medianActual: 6, count: 4 }],
  });

  it("fires in [16,18) with learned category-median copy", () => {
    const n = selectContextNudge(inputs({ localHour: 16, patterns: fastErrands }));
    expect(n?.kind).toBe("quick_win");
    expect(n?.title).toBe("Quick win nearby ⏱️");
    expect(n?.body).toBe("'Pay bills' — errands quests usually take you ~6 min. Sneak it in before dinner?");
  });

  it("requires count ≥ 3: a 2-sample category falls through to the estimate branch", () => {
    const thin = patterns({
      powerHours: [{ hour: 9, score: 5 }],
      categoryMinutes: [{ category: "errands", medianActual: 6, count: 2 }],
    });
    const n = selectContextNudge(inputs({
      localHour: 16, patterns: thin,
      openQuests: [quest({ estimatedMinutes: 8 })],
    }));
    expect(n?.body).toBe("'Pay bills' is only ~8 min by your estimate. Sneak it in before dinner?");
  });

  it("requires median ≤ 10: a slow category does not qualify", () => {
    const slow = patterns({
      powerHours: [{ hour: 9, score: 5 }],
      categoryMinutes: [{ category: "errands", medianActual: 11, count: 5 }],
    });
    expect(selectContextNudge(inputs({ localHour: 16, patterns: slow }))).toBeNull();
  });

  it("picks the smallest category median across quests, tie-broken by lowest id", () => {
    const two = patterns({
      powerHours: [{ hour: 9, score: 5 }],
      categoryMinutes: [
        { category: "errands", medianActual: 6, count: 4 },
        { category: "self_care", medianActual: 4, count: 3 },
      ],
    });
    const n = selectContextNudge(inputs({
      localHour: 16, patterns: two,
      openQuests: [quest({ id: 1 }), quest({ id: 2, title: "Stretch break", category: "self_care" })],
    }));
    expect(n?.body).toContain("'Stretch break'");
    expect(n?.body).toContain("~4 min");
    // Pins the CATEGORY_LABELS rendering: self_care → "self-care", never the raw token.
    expect(n?.body).toContain("self-care quests");
  });

  it("equal medians tie-break by lowest quest id", () => {
    const tied = patterns({
      powerHours: [{ hour: 9, score: 5 }],
      categoryMinutes: [
        { category: "errands", medianActual: 5, count: 4 },
        { category: "self_care", medianActual: 5, count: 3 },
      ],
    });
    const n = selectContextNudge(inputs({
      localHour: 16, patterns: tied,
      openQuests: [quest({ id: 8, category: "self_care", title: "Stretch break" }), quest({ id: 3 })],
    }));
    expect(n?.body).toContain("'Pay bills'");
  });

  it("estimate branch: fires only for estimates ≤ 10, lowest id first", () => {
    const none = patterns({ powerHours: [{ hour: 9, score: 5 }], categoryMinutes: [] });
    expect(selectContextNudge(inputs({
      localHour: 16, patterns: none,
      openQuests: [quest({ estimatedMinutes: 15 })],
    }))).toBeNull();
    const n = selectContextNudge(inputs({
      localHour: 16, patterns: none,
      openQuests: [quest({ id: 4, estimatedMinutes: 9 }), quest({ id: 2, title: "Take out trash", estimatedMinutes: 5 })],
    }));
    expect(n?.body).toBe("'Take out trash' is only ~5 min by your estimate. Sneak it in before dinner?");
  });

  it("null patterns → estimate branch still works", () => {
    const n = selectContextNudge(inputs({
      localHour: 17, patterns: null,
      openQuests: [quest({ estimatedMinutes: 7 })],
    }));
    expect(n?.kind).toBe("quick_win");
  });

  it("silent when neither branch qualifies", () => {
    expect(selectContextNudge(inputs({ localHour: 16, patterns: null }))).toBeNull();
  });

  it("learned branch has NO confidence gate: fires at low confidence (count>=3 is the reliability gate)", () => {
    const lowConfidenceErrands = patterns({
      confidence: "low",
      powerHours: [{ hour: 9, score: 5 }], // low confidence falls back to hour 9, so power_window can't shadow quick_win at 16
      categoryMinutes: [{ category: "errands", medianActual: 6, count: 4 }],
    });
    const n = selectContextNudge(inputs({ localHour: 16, patterns: lowConfidenceErrands }));
    expect(n?.kind).toBe("quick_win");
    expect(n?.body).toBe("'Pay bills' — errands quests usually take you ~6 min. Sneak it in before dinner?");
  });
});

describe("selectContextNudge — cross-kind priority and spacing", () => {
  it("hour 19 collision: due_today beats a learned power hour of 19", () => {
    const nineteen = patterns({ powerHours: [{ hour: 19, score: 9 }] });
    const n = selectContextNudge(inputs({ localHour: 19, patterns: nineteen }));
    expect(n?.kind).toBe("due_today");
  });

  it("hour 19 with no due-today quests falls through to a learned power hour of 19", () => {
    const nineteen = patterns({ powerHours: [{ hour: 19, score: 9 }] });
    const n = selectContextNudge(inputs({
      localHour: 19, patterns: nineteen,
      openQuests: [quest({ dueDate: null })],
    }));
    expect(n?.kind).toBe("power_window");
  });

  it("power_window beats quick_win when the learned hour is 16", () => {
    const sixteen = patterns({
      powerHours: [{ hour: 16, score: 9 }],
      categoryMinutes: [{ category: "errands", medianActual: 6, count: 4 }],
    });
    const n = selectContextNudge(inputs({ localHour: 16, patterns: sixteen }));
    expect(n?.kind).toBe("power_window");
  });
});
