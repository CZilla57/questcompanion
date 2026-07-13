/** Roll up quest completion counts for a questline. */
export function computeProgress(quests: { completed: boolean }[]): { total: number; done: number } {
  const total = quests.length;
  const done = quests.reduce((n, q) => n + (q.completed ? 1 : 0), 0);
  return { total, done };
}

/**
 * A questline is claimable only while still active, holding at least one quest,
 * with every quest completed. The "ready" state is derived, never stored.
 */
export function isReadyToClaim(
  questline: { status: string },
  progress: { total: number; done: number },
): boolean {
  return questline.status === "active" && progress.total >= 1 && progress.done === progress.total;
}

/** One-time XP payout: 25 per quest, capped at 8 quests (200 XP). */
export function computeRewardXp(total: number): number {
  return Math.min(total, 8) * 25;
}

/** Only one-off quests may join a questline; recurring-spawned quests never finish. */
export function isQuestlineAssignable(task: { recurringTaskId: number | null }): boolean {
  return task.recurringTaskId == null;
}
