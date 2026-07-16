import { describe, it, expect } from "vitest";
import type { PatternSummary, Task, BrainMode } from "@workspace/api-client-react";
import { nextPowerWindowSlot, inWindowNow, showSteeringChip } from "./steering";

// Wed 2026-07-15, 14:30 local.
const NOW = new Date(2026, 6, 15, 14, 30);
const HOURS = [{ hour: 9 }, { hour: 16 }, { hour: 21 }];

function patterns(overrides: Partial<PatternSummary> = {}): PatternSummary {
  return { confidence: "ok", powerHours: HOURS, ...overrides } as PatternSummary;
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    bigSwing: true,
    completed: false,
    isAnchored: false,
    dueDate: null,
    ...overrides,
  } as Task;
}

describe("nextPowerWindowSlot", () => {
  it("picks the nearest window later today", () => {
    expect(nextPowerWindowSlot(NOW, HOURS)).toEqual({
      dueDate: "2026-07-15",
      dueTime: "16:00",
      label: "4pm",
    });
  });

  it("is strictly after the current hour — 14:30 does not pick a 14 window", () => {
    expect(nextPowerWindowSlot(NOW, [{ hour: 14 }, { hour: 21 }])).toEqual({
      dueDate: "2026-07-15",
      dueTime: "21:00",
      label: "9pm",
    });
  });

  it("rolls over to tomorrow's earliest window when today is exhausted", () => {
    const late = new Date(2026, 6, 15, 22, 5);
    expect(nextPowerWindowSlot(late, HOURS)).toEqual({
      dueDate: "2026-07-16",
      dueTime: "09:00",
      label: "9am tomorrow",
    });
  });

  it("zero-pads morning dueTime", () => {
    const dawn = new Date(2026, 6, 15, 5, 0);
    expect(nextPowerWindowSlot(dawn, HOURS)!.dueTime).toBe("09:00");
  });

  it("null for empty powerHours", () => {
    expect(nextPowerWindowSlot(NOW, [])).toBeNull();
  });
});

describe("inWindowNow", () => {
  it("true when the current local hour is a power hour", () => {
    expect(inWindowNow(new Date(2026, 6, 15, 16, 45), HOURS)).toBe(true);
  });
  it("false otherwise", () => {
    expect(inWindowNow(NOW, HOURS)).toBe(false);
  });
});

describe("showSteeringChip", () => {
  const neutral = "neutral" as BrainMode;

  it("shows for an unscheduled big swing outside the window, confidence ok", () => {
    expect(showSteeringChip(task(), patterns(), NOW, neutral)).toBe(true);
  });

  it("shows for a past-due and a due-today big swing", () => {
    expect(showSteeringChip(task({ dueDate: "2026-07-10" }), patterns(), NOW, neutral)).toBe(true);
    expect(showSteeringChip(task({ dueDate: "2026-07-15" }), patterns(), NOW, neutral)).toBe(true);
  });

  it("never pulls a future-dated quest earlier", () => {
    expect(showSteeringChip(task({ dueDate: "2026-07-20" }), patterns(), NOW, neutral)).toBe(false);
  });

  it("hidden below ok confidence and with empty hours", () => {
    expect(showSteeringChip(task(), patterns({ confidence: "low" }), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task(), patterns({ confidence: "none" }), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task(), patterns({ powerHours: [] }), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task(), undefined, NOW, neutral)).toBe(false);
  });

  it("hidden for non-big-swing, completed, and anchored quests", () => {
    expect(showSteeringChip(task({ bigSwing: false }), patterns(), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task({ completed: true }), patterns(), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task({ isAnchored: true }), patterns(), NOW, neutral)).toBe(false);
  });

  it("hidden inside the window — that's momentum's moment", () => {
    const inWindow = new Date(2026, 6, 15, 16, 10);
    expect(showSteeringChip(task(), patterns(), inWindow, neutral)).toBe(false);
  });

  it("hidden in frozen mode (pressure-free), visible when mode is unknown", () => {
    expect(showSteeringChip(task(), patterns(), NOW, "frozen" as BrainMode)).toBe(false);
    expect(showSteeringChip(task(), patterns(), NOW, undefined)).toBe(true);
  });
});
