import { eq, and } from "drizzle-orm";
import { db, habitStreaksTable } from "@workspace/db";

export async function getHabitStreak(userId: number, recurringTaskId: number) {
  const [row] = await db
    .select()
    .from(habitStreaksTable)
    .where(
      and(
        eq(habitStreaksTable.userId, userId),
        eq(habitStreaksTable.recurringTaskId, recurringTaskId),
      ),
    );
  return row ?? null;
}

export async function advanceHabitStreak(
  userId: number,
  recurringTaskId: number,
  completionDate: string,
): Promise<typeof habitStreaksTable.$inferSelect> {
  const existing = await getHabitStreak(userId, recurringTaskId);

  if (existing) {
    // Already counted today — return unchanged
    if (existing.lastCompletedDate === completionDate) return existing;

    const yesterday = getPreviousDay(completionDate);
    const newStreak =
      existing.lastCompletedDate === yesterday ? existing.currentStreak + 1 : 1;
    const newLongest = Math.max(existing.longestStreak, newStreak);

    const [updated] = await db
      .update(habitStreaksTable)
      .set({
        currentStreak: newStreak,
        longestStreak: newLongest,
        totalCompletions: existing.totalCompletions + 1,
        lastCompletedDate: completionDate,
      })
      .where(eq(habitStreaksTable.id, existing.id))
      .returning();
    return updated;
  }

  // First ever completion
  const [created] = await db
    .insert(habitStreaksTable)
    .values({
      userId,
      recurringTaskId,
      currentStreak: 1,
      longestStreak: 1,
      totalCompletions: 1,
      lastCompletedDate: completionDate,
    })
    .returning();
  return created;
}

function getPreviousDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

export const EMPTY_STREAK = {
  currentStreak: 0,
  longestStreak: 0,
  totalCompletions: 0,
  lastCompletedDate: null as string | null,
};
