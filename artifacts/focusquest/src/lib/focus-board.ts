import type { Task } from "@workspace/api-client-react";

export type FocusBoardState =
  | { kind: "empty" }
  | { kind: "active"; focusTasks: Task[]; completedCount: number; totalPinned: number }
  | { kind: "all-done" };

/** State of the Today's Focus board for the given local day (yyyy-MM-dd). */
export function focusBoardState(tasks: Task[], todayStr: string): FocusBoardState {
  const pinnedToday = tasks.filter((t) => t.isDailyFocus && t.focusDate === todayStr);
  if (pinnedToday.length === 0) return { kind: "empty" };
  const open = pinnedToday.filter((t) => !t.completed);
  if (open.length === 0) return { kind: "all-done" };
  return {
    kind: "active",
    focusTasks: open,
    completedCount: pinnedToday.length - open.length,
    totalPinned: pinnedToday.length,
  };
}
