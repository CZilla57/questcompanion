import type { MomentumSuggestion, Task } from "@workspace/api-client-react";

// Successor of focus-board.ts: the Today's Focus board becomes the momentum
// surface (spec: momentum absorbs Pick Three; pinning survives as override).
export type MomentumBoardState =
  | { kind: "empty" }
  | { kind: "suggesting"; suggestion: MomentumSuggestion | null; pinned: Task[]; completedCount: number; totalPinned: number }
  | { kind: "all-done"; suggestion: MomentumSuggestion | null };

export function momentumBoardState(
  tasks: Task[],
  suggestions: MomentumSuggestion[],
  todayStr: string,
): MomentumBoardState {
  const pinnedToday = tasks.filter((t) => t.isDailyFocus && t.focusDate === todayStr);
  const openPins = pinnedToday.filter((t) => !t.completed);

  // The authoritative completion view is the freshly-fetched task list, not the
  // suggestion's own snapshot. The momentum endpoint is heavier (patterns, brain
  // state, difficulty offers) so its cache lags the task list after a completion:
  // a suggestion can still carry `completed: false` for a quest the task list
  // already reports done. Trust the task list and never surface such a quest.
  const completedIds = new Set(tasks.filter((t) => t.completed).map((t) => t.id));
  const isOpen = (s: MomentumSuggestion) => !s.task.completed && !completedIds.has(s.task.id);
  const suggestion =
    suggestions.find((s) => s.kind === "primary" && isOpen(s)) ??
    suggestions.find(isOpen) ??
    null;

  if (pinnedToday.length > 0 && openPins.length === 0) {
    // Victory state — the optional extra win must never point at a completed pin.
    return { kind: "all-done", suggestion };
  }
  if (pinnedToday.length === 0 && !suggestion) return { kind: "empty" };

  // The primary suggestion owns its card; drop it from the pinned list (no dupes).
  const pinned = openPins.filter((t) => t.id !== suggestion?.task.id);
  return {
    kind: "suggesting",
    suggestion,
    pinned,
    completedCount: pinnedToday.length - openPins.length,
    totalPinned: pinnedToday.length,
  };
}
