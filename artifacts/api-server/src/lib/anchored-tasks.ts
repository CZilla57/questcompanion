/** The UTC calendar-date portion (YYYY-MM-DD) of a timestamp. */
export function utcDateString(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

/**
 * Whether an anchored task should withhold the daily "all done" bonus today.
 * Anchored tasks gate starting the day AFTER they are created (a one-day grace),
 * so a task created today never blocks the bonus.
 */
export function anchoredTaskGatesBonus(
  task: { isAnchored: boolean; createdAt: Date },
  today: string,
): boolean {
  return task.isAnchored && utcDateString(task.createdAt) < today;
}

/**
 * Whether a task belongs to today's daily-bonus gating set: due today, or an
 * anchored task past its one-day grace period.
 */
export function isBonusGatingTask(
  task: { dueDate: string | null; isAnchored: boolean; createdAt: Date },
  today: string,
): boolean {
  return task.dueDate === today || anchoredTaskGatesBonus(task, today);
}

/**
 * Whether a completed task counts as "activity today" for streak-restore
 * accounting: a task due today, or an anchored task completed today.
 */
export function countsAsTodayCompletion(
  task: { dueDate: string | null; isAnchored: boolean; completedAt: Date | null },
  today: string,
): boolean {
  if (task.dueDate === today) return true;
  return task.isAnchored && task.completedAt != null && utcDateString(task.completedAt) === today;
}
