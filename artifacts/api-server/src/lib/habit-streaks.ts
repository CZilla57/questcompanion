import { eq, and, lte } from "drizzle-orm";
import { db, habitStreaksTable, badgesTable, userBadgesTable, activityTable } from "@workspace/db";
import { awardStreakGear, getHabitGearRarity, isHabitGearMilestone, type GearRewardInfo } from "./gear-rewards";

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

export interface HabitStreakPreviousState {
  /** null means the row did not exist before (new insert); reverse by deleting it */
  prevCurrentStreak: number | null;
  prevLongestStreak: number | null;
  prevTotalCompletions: number | null;
  prevLastCompletedDate: string | null;
  wasNew: boolean;
  badgesGrantedIds: number[];
}

/** Advance the streak and award any newly unlocked habit-streak milestone badges and gear.
 *  Returns { streak, newBadges, gearReward, previousState } so the caller can surface them
 *  to the client and store the previousState for later rollback on uncomplete. */
export async function advanceHabitStreak(
  userId: number,
  recurringTaskId: number,
  completionDate: string,
  userLevel: number,
): Promise<{
  streak: typeof habitStreaksTable.$inferSelect;
  newBadges: typeof badgesTable.$inferSelect[];
  gearReward: GearRewardInfo | null;
  previousState: HabitStreakPreviousState;
}> {
  const existing = await getHabitStreak(userId, recurringTaskId);

  let streak: typeof habitStreaksTable.$inferSelect;
  let previousState: HabitStreakPreviousState;

  if (existing) {
    // Already counted today — return unchanged with no new badges or gear
    if (existing.lastCompletedDate === completionDate) {
      return {
        streak: existing,
        newBadges: [],
        gearReward: null,
        previousState: {
          prevCurrentStreak: existing.currentStreak,
          prevLongestStreak: existing.longestStreak,
          prevTotalCompletions: existing.totalCompletions,
          prevLastCompletedDate: existing.lastCompletedDate,
          wasNew: false,
          badgesGrantedIds: [],
        },
      };
    }

    previousState = {
      prevCurrentStreak: existing.currentStreak,
      prevLongestStreak: existing.longestStreak,
      prevTotalCompletions: existing.totalCompletions,
      prevLastCompletedDate: existing.lastCompletedDate ?? null,
      wasNew: false,
      badgesGrantedIds: [],
    };

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
    previousState = {
      prevCurrentStreak: null,
      prevLongestStreak: null,
      prevTotalCompletions: null,
      prevLastCompletedDate: null,
      wasNew: true,
      badgesGrantedIds: [],
    };

    // The unique constraint on (user_id, recurring_task_id) ensures that even if two
    // concurrent first-time completions race here, only one insert succeeds.
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
      .onConflictDoNothing()
      .returning();

    if (!created) {
      // Another concurrent request won the insert race; fetch the row it created.
      const [raced] = await db
        .select()
        .from(habitStreaksTable)
        .where(
          and(
            eq(habitStreaksTable.userId, userId),
            eq(habitStreaksTable.recurringTaskId, recurringTaskId),
          ),
        );
      if (!raced) {
        return {
          streak: { id: 0, userId, recurringTaskId, currentStreak: 1, longestStreak: 1, totalCompletions: 1, lastCompletedDate: completionDate, createdAt: new Date() },
          newBadges: [],
          gearReward: null,
          previousState,
        };
      }
      streak = raced;
    } else {
      streak = created;
    }
  }

  // Award any habit_streak milestone badges the user hasn't earned yet
  const { awarded: newBadges, badgeIds } = await checkAndAwardHabitBadges(userId, streak.currentStreak);
  previousState.badgesGrantedIds = badgeIds;

  // Award gear for habit completion milestones (5, 15, 30, 60, 100 completions, then every 50)
  let gearReward: GearRewardInfo | null = null;
  if (isHabitGearMilestone(streak.totalCompletions)) {
    const targetRarity = getHabitGearRarity(streak.totalCompletions);
    gearReward = await awardStreakGear(
      userId,
      userLevel,
      targetRarity,
      `${streak.totalCompletions}-completion habit milestone`,
    );
  }

  return { streak, newBadges, gearReward, previousState };
}

/** Reverse a previously applied habit streak advancement using a stored previousState snapshot. */
export async function reverseHabitStreak(
  userId: number,
  recurringTaskId: number,
  previousState: HabitStreakPreviousState,
): Promise<void> {
  if (previousState.wasNew) {
    // The row was created by this completion; delete it entirely
    await db
      .delete(habitStreaksTable)
      .where(
        and(
          eq(habitStreaksTable.userId, userId),
          eq(habitStreaksTable.recurringTaskId, recurringTaskId),
        ),
      );
  } else if (previousState.prevCurrentStreak !== null) {
    // Restore the row to its pre-completion state
    const [existing] = await db
      .select({ id: habitStreaksTable.id })
      .from(habitStreaksTable)
      .where(
        and(
          eq(habitStreaksTable.userId, userId),
          eq(habitStreaksTable.recurringTaskId, recurringTaskId),
        ),
      );
    if (existing) {
      await db
        .update(habitStreaksTable)
        .set({
          currentStreak: previousState.prevCurrentStreak,
          longestStreak: previousState.prevLongestStreak!,
          totalCompletions: previousState.prevTotalCompletions!,
          lastCompletedDate: previousState.prevLastCompletedDate,
        })
        .where(eq(habitStreaksTable.id, existing.id));
    }
  }

  // Revoke habit-streak badges granted by this completion
  for (const badgeId of previousState.badgesGrantedIds) {
    await db
      .delete(userBadgesTable)
      .where(
        and(
          eq(userBadgesTable.userId, userId),
          eq(userBadgesTable.badgeId, badgeId),
        ),
      );
  }
}

async function checkAndAwardHabitBadges(
  userId: number,
  currentStreak: number,
): Promise<{ awarded: typeof badgesTable.$inferSelect[]; badgeIds: number[] }> {
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

  if (eligible.length === 0) return { awarded: [], badgeIds: [] };

  // Which ones does the user already own?
  const owned = await db
    .select({ badgeId: userBadgesTable.badgeId })
    .from(userBadgesTable)
    .where(eq(userBadgesTable.userId, userId));
  const ownedIds = new Set(owned.map((r) => r.badgeId));

  const toAward = eligible.filter((b) => !ownedIds.has(b.id));
  if (toAward.length === 0) return { awarded: [], badgeIds: [] };

  const awarded: typeof badgesTable.$inferSelect[] = [];
  const badgeIds: number[] = [];
  for (const badge of toAward) {
    // onConflictDoNothing prevents duplicate badge rows from concurrent completions
    const [inserted] = await db.insert(userBadgesTable)
      .values({ userId, badgeId: badge.id })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await db.insert(activityTable).values({
        userId,
        type: "badge_earned",
        description: `Earned habit badge: ${badge.name}`,
        points: 0,
      });
      awarded.push(badge);
      badgeIds.push(badge.id);
    }
  }

  return { awarded, badgeIds };
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
