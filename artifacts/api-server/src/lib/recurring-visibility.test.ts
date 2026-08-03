import { describe, it, expect } from "vitest";
import { dropStaleRecurringInstances, type RecurringInstanceRef } from "./recurring-visibility";

const TODAY = "2026-08-03";

let nextId = 1;
function inst(overrides: Partial<RecurringInstanceRef> = {}): RecurringInstanceRef {
  return { id: nextId++, recurringTaskId: null, dueDate: null, ...overrides };
}

describe("dropStaleRecurringInstances", () => {
  it("keeps non-recurring quests untouched, including future deadlines", () => {
    const backlog = inst();
    const deadline = inst({ dueDate: "2026-08-31" });
    const pastDue = inst({ dueDate: "2026-07-20" });
    const open = [backlog, deadline, pastDue];
    expect(dropStaleRecurringInstances(open, open, TODAY)).toEqual(open);
  });

  it("drops yesterday's open instance when today's is already completed", () => {
    // Daily ritual: today's instance completed (open list omits it), Aug 1 stale copy open.
    const stale = inst({ recurringTaskId: 1, dueDate: "2026-08-01" });
    const doneToday = inst({ recurringTaskId: 1, dueDate: TODAY });
    expect(dropStaleRecurringInstances([stale], [stale, doneToday], TODAY)).toEqual([]);
  });

  it("keeps only today's instance when older open copies exist", () => {
    const stale1 = inst({ recurringTaskId: 3, dueDate: "2026-07-30" });
    const stale2 = inst({ recurringTaskId: 3, dueDate: "2026-08-01" });
    const today = inst({ recurringTaskId: 3, dueDate: TODAY });
    const open = [stale1, stale2, today];
    expect(dropStaleRecurringInstances(open, open, TODAY)).toEqual([today]);
  });

  it("keeps a past-due instance that is still the template's latest occurrence", () => {
    // Weekly trash-out spawned Thursday, still open Friday — nothing newer shadows it.
    const thursday = inst({ recurringTaskId: 6, dueDate: "2026-07-30" });
    const doneLastWeek = inst({ recurringTaskId: 6, dueDate: "2026-07-23" });
    expect(dropStaleRecurringInstances([thursday], [thursday, doneLastWeek], TODAY)).toEqual([thursday]);
  });

  it("drops lead-time instances that are not due yet", () => {
    const today = inst({ recurringTaskId: 2, dueDate: TODAY });
    const tomorrow = inst({ recurringTaskId: 2, dueDate: "2026-08-04" });
    const open = [today, tomorrow];
    expect(dropStaleRecurringInstances(open, open, TODAY)).toEqual([today]);
  });

  it("drops everything from a template whose instances are all in the future", () => {
    const nextWeek = inst({ recurringTaskId: 4, dueDate: "2026-08-10" });
    expect(dropStaleRecurringInstances([nextWeek], [nextWeek], TODAY)).toEqual([]);
  });

  it("keeps legacy recurring instances without a due date", () => {
    const legacy = inst({ recurringTaskId: 5, dueDate: null });
    expect(dropStaleRecurringInstances([legacy], [legacy], TODAY)).toEqual([legacy]);
  });
});
