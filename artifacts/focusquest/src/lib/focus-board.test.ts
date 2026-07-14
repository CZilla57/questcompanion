import { describe, it, expect } from "vitest";
import { focusBoardState } from "./focus-board";
import type { Task } from "@workspace/api-client-react";

const TODAY = "2026-07-13";

function make(over: Partial<Task>): Task {
  const base = {
    id: 1, title: "Quest", completed: false,
    isDailyFocus: false, focusDate: null,
  };
  return { ...base, ...over } as Task;
}

describe("focusBoardState", () => {
  it("is empty with no tasks at all", () => {
    expect(focusBoardState([], TODAY)).toEqual({ kind: "empty" });
  });

  it("ignores pins from another day and non-pinned tasks", () => {
    const tasks = [
      make({ id: 1, isDailyFocus: true, focusDate: "2026-07-12" }),
      make({ id: 2, isDailyFocus: false, focusDate: TODAY }),
    ];
    expect(focusBoardState(tasks, TODAY)).toEqual({ kind: "empty" });
  });

  it("is active with open pinned quests, counting completed ones", () => {
    const open = make({ id: 1, isDailyFocus: true, focusDate: TODAY });
    const done = make({ id: 2, isDailyFocus: true, focusDate: TODAY, completed: true });
    const state = focusBoardState([open, done], TODAY);
    expect(state).toEqual({ kind: "active", focusTasks: [open], completedCount: 1, totalPinned: 2 });
  });

  it("is all-done when every pinned quest is complete", () => {
    const tasks = [
      make({ id: 1, isDailyFocus: true, focusDate: TODAY, completed: true }),
      make({ id: 2, isDailyFocus: true, focusDate: TODAY, completed: true }),
    ];
    expect(focusBoardState(tasks, TODAY)).toEqual({ kind: "all-done" });
  });
});
