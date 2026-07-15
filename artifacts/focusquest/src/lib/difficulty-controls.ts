import type { Task } from "@workspace/api-client-react";

/**
 * Pure derivation of which manual difficulty buttons are enabled for a quest.
 * "easy" is the floor (no easier), "hard" is the ceiling (no harder).
 * Single source of truth — consumed by useDifficulty (Task 8) and unit-tested
 * here so the disabled-state logic isn't duplicated inline.
 */
export function difficultyControlState(task: Pick<Task, "difficulty">) {
  const level = task.difficulty ?? "medium";
  return { canEasier: level !== "easy", canHarder: level !== "hard" };
}
