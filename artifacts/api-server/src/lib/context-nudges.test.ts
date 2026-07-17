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
