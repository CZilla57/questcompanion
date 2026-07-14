import { describe, it, expect } from "vitest";
import type { MomentumSuggestion, Task } from "@workspace/api-client-react";
import { momentumBoardState } from "./momentum-board";

const TODAY = "2026-07-14";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: Math.floor(Math.random() * 100000),
    title: "quest",
    completed: false,
    isDailyFocus: false,
    focusDate: null,
    ...overrides,
  } as Task;
}

function sugg(t: Task): MomentumSuggestion {
  return { task: t, reason: "why not", kind: "primary" } as MomentumSuggestion;
}

describe("momentumBoardState", () => {
  it("is empty with no pins and no suggestions", () => {
    expect(momentumBoardState([], [], TODAY)).toEqual({ kind: "empty" });
    expect(momentumBoardState([task()], [], TODAY)).toEqual({ kind: "empty" }); // unpinned + no suggestion
  });

  it("suggests when there are candidates but no pins", () => {
    const t = task();
    const s = momentumBoardState([t], [sugg(t)], TODAY);
    expect(s.kind).toBe("suggesting");
    if (s.kind === "suggesting") {
      expect(s.suggestion?.task.id).toBe(t.id);
      expect(s.pinned).toEqual([]);
      expect(s.totalPinned).toBe(0);
    }
  });

  it("dedupes: a pinned primary appears only in the suggestion slot", () => {
    const pinnedA = task({ isDailyFocus: true, focusDate: TODAY });
    const pinnedB = task({ isDailyFocus: true, focusDate: TODAY });
    const s = momentumBoardState([pinnedA, pinnedB], [sugg(pinnedA)], TODAY);
    expect(s.kind).toBe("suggesting");
    if (s.kind === "suggesting") {
      expect(s.suggestion?.task.id).toBe(pinnedA.id);
      expect(s.pinned.map((t) => t.id)).toEqual([pinnedB.id]); // no duplicate row
      expect(s.totalPinned).toBe(2);
      expect(s.completedCount).toBe(0);
    }
  });

  it("counts completed pins and keeps open ones listed", () => {
    const done = task({ isDailyFocus: true, focusDate: TODAY, completed: true });
    const open = task({ isDailyFocus: true, focusDate: TODAY });
    const other = task();
    const s = momentumBoardState([done, open], [sugg(other)], TODAY);
    expect(s.kind).toBe("suggesting");
    if (s.kind === "suggesting") {
      expect(s.completedCount).toBe(1);
      expect(s.totalPinned).toBe(2);
      expect(s.pinned.map((t) => t.id)).toEqual([open.id]);
    }
  });

  it("is all-done when every pin is complete — optional extra win offered", () => {
    const done = task({ isDailyFocus: true, focusDate: TODAY, completed: true });
    const extra = task();
    const s = momentumBoardState([done, extra], [sugg(extra)], TODAY);
    expect(s).toEqual({ kind: "all-done", suggestion: expect.objectContaining({ kind: "primary" }) });
    // …and with nothing else to offer, suggestion is null (still celebratory, never pushy).
    expect(momentumBoardState([done], [], TODAY)).toEqual({ kind: "all-done", suggestion: null });
  });

  it("never offers a completed quest as the suggestion (stale cache guard)", () => {
    const done = task({ isDailyFocus: true, focusDate: TODAY, completed: true });
    const s = momentumBoardState([done], [sugg(done)], TODAY);
    expect(s).toEqual({ kind: "all-done", suggestion: null });
  });

  it("suggesting with pins but exhausted suggestions keeps the pinned list", () => {
    const open = task({ isDailyFocus: true, focusDate: TODAY });
    const s = momentumBoardState([open], [], TODAY);
    expect(s.kind).toBe("suggesting");
    if (s.kind === "suggesting") {
      expect(s.suggestion).toBeNull();
      expect(s.pinned.map((t) => t.id)).toEqual([open.id]);
    }
  });

  it("ignores pins from other days", () => {
    const stale = task({ isDailyFocus: true, focusDate: "2026-07-13" });
    expect(momentumBoardState([stale], [], TODAY)).toEqual({ kind: "empty" });
  });
});
