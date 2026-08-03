/** The fields of a task row this filter needs. */
export interface RecurringInstanceRef {
  id: number;
  recurringTaskId: number | null;
  dueDate: string | null;
}

/**
 * A recurring template's only *actionable-now* instance is its current
 * occurrence: the one with the latest dueDate ≤ today, completed or not.
 *
 * The spawner leaves missed occurrences open forever, so a daily ritual that
 * skips a day accumulates stale open copies — and once today's copy is done,
 * an older one would resurface as if the ritual hadn't happened ("take
 * medication" suggested again tonight). Worse, while today's copy is still
 * open, a stale one can outrank it and steal the completion, breaking the
 * cadence streak. Lead-time instances (dueDate > today) aren't due yet.
 *
 * `all` must include completed instances: today's completed occurrence is
 * exactly what shadows yesterday's open copy. One-off quests and legacy
 * instances without a due date pass through untouched — a future due date on
 * a one-off is a deadline, not a schedule.
 */
export function dropStaleRecurringInstances<T extends RecurringInstanceRef>(
  open: readonly T[],
  all: readonly RecurringInstanceRef[],
  todayStr: string,
): T[] {
  const latestByTemplate = new Map<number, string>();
  for (const t of all) {
    if (t.recurringTaskId === null || t.dueDate === null || t.dueDate > todayStr) continue;
    const latest = latestByTemplate.get(t.recurringTaskId);
    if (latest === undefined || t.dueDate > latest) {
      latestByTemplate.set(t.recurringTaskId, t.dueDate);
    }
  }

  return open.filter(
    (t) =>
      t.recurringTaskId === null ||
      t.dueDate === null ||
      t.dueDate === latestByTemplate.get(t.recurringTaskId),
  );
}
