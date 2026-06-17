import { eq, and, lte } from "drizzle-orm";
import { db, habitStreaksTable, badgesTable, userBadgesTable, activityTable } from "@workspace/db";

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

/** Advance the streak and award any newly unlocked habit-streak milestone badges.
 *  Returns { streak, newBadges } so the caller can surface them to the client. */
export async function advanceHabitStreak(
  userId: number,
  recurringTaskId: number,
  completionDate: string,
): Promise<{
  streak: typeof habitStreaksTable.$inferSelect;
  newBadges: typeof badgesTable.$inferSelect[];
}> {
  const existing = await getHabitStreak(userId, recurringTaskId);

  let streak: typeof habitStreaksTable.$inferSelect;

  if (existing) {
    // Already counted today — return unchanged with no new badges
    if (existing.lastCompletedDate === completionDate) {
      return { streak: existing, newBadges: [] };
    }

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
    streak = updated;
  } else {
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
    streak = created;
  }

  // Award any habit_streak milestone badges the user hasn't earned yet
  const newBadges = await checkAndAwardHabitBadges(userId, streak.currentStreak);

  return { streak, newBadges };
}

async function checkAndAwardHabitBadges(
  userId: number,
  currentStreak: number,
): Promise<typeof badgesTable.$inferSelect[]> {
  // All habit_streak badges reachable at this streak level
  const eligible = await db
    .select()
    .from(badgesTable)
    .where(
      and(
        eq(badgesTable.category, "habit_streak"),
        lte(badgesTable.requirement, currentStreak),
      ),
    );

  if (eligible.length === 0) return [];

  // Which ones does the user already own?
  const owned = await db
    .select({ badgeId: userBadgesTable.badgeId })
    .from(userBadgesTable)
    .where(eq(userBadgesTable.userId, userId));
  const ownedIds = new Set(owned.map((r) => r.badgeId));

  const toAward = eligible.filter((b) => !ownedIds.has(b.id));
  if (toAward.length === 0) return [];

  for (const badge of toAward) {
    await db.insert(userBadgesTable).values({ userId, badgeId: badge.id });
    await db.insert(activityTable).values({
      userId,
      type: "badge_earned",
      description: `Earned habit badge: ${badge.name}`,
      points: 0,
    });
  }

  return toAward;
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
