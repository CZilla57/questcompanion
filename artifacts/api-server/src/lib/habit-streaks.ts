import { eq, and, lte } from "drizzle-orm";
import { db, habitStreaksTable, badgesTable, userBadgesTable, activityTable } from "@workspace/db";
import { awardStreakGear, getHabitGearRarity, isHabitGearMilestone, type GearRewardInfo } from "./gear-rewards";
import { nextStreakState } from "./streak-cadence";
import type { Frequency } from "./recurrence";

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
  /** Added with monthly/yearly cadences. Snapshots written before that ship
   *  lack the key entirely — JSON.parse yields undefined, which must be read
   *  as null so old completions stay reversible. */
  prevLastPeriodKey?: string | null;
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
  cadence: { frequency: Frequency; occurrenceDate: string },
): Promise<{
  streak: typeof habitStreaksTable.$inferSelect;
  newBadges: typeof badgesTable.$inferSelect[];
  gearReward: GearRewardInfo | null;
  previousState: HabitStreakPreviousState;
}> {
  const existing = await getHabitStreak(userId, recurringTaskId);

  const decision = nextStreakState({
    frequency: cadence.frequency,
    completionDate,
    occurrenceDate: cadence.occurrenceDate,
    existing: existing
      ? {
          currentStreak: existing.currentStreak,
          longestStreak: existing.longestStreak,
          lastCompletedDate: existing.lastCompletedDate,
          lastPeriodKey: existing.lastPeriodKey,
        }
      : null,
  });

  let streak: typeof habitStreaksTable.$inferSelect;
  let previousState: HabitStreakPreviousState;

  if (existing) {
    previousState = {
      prevCurrentStreak: existing.currentStreak,
      prevLongestStreak: existing.longestStreak,
      prevTotalCompletions: existing.totalCompletions,
      prevLastCompletedDate: existing.lastCompletedDate ?? null,
      prevLastPeriodKey: existing.lastPeriodKey ?? null,
      wasNew: false,
      badgesGrantedIds: [],
    };

    // Already counted for this period — return unchanged, no badges or gear.
    if (decision.status === "already_counted") {
      return { streak: existing, newBadges: [], gearReward: null, previousState };
    }

    const [updated] = await db
      .update(habitStreaksTable)
      .set({
        currentStreak: decision.currentStreak,
        longestStreak: decision.longestStreak,
        totalCompletions: existing.totalCompletions + 1,
        lastCompletedDate: completionDate,
        lastPeriodKey: decision.periodKey,
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
      prevLastPeriodKey: null,
      wasNew: true,
      badgesGrantedIds: [],
    };

    const periodKey = decision.status === "advanced" ? decision.periodKey : null;

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
        lastPeriodKey: periodKey,
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
          streak: {
            id: 0, userId, recurringTaskId,
            currentStreak: 1, longestStreak: 1, totalCompletions: 1,
            lastCompletedDate: completionDate, lastPeriodKey: periodKey,
            createdAt: new Date(),
          },
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

  // habit_streak badge thresholds are days (3, 7, 14, 30). Granting a
  // "7-day streak" badge for seven YEARS of a yearly quest is a mislabel,
  // not a reward — so only the daily-cadence path awards them. Gear keys off
  // totalCompletions, which is cadence-neutral, and stays enabled for all.
  let newBadges: typeof badgesTable.$inferSelect[] = [];
  if (cadence.frequency === "weekly") {
    const result = await checkAndAwardHabitBadges(userId, streak.currentStreak);
    newBadges = result.awarded;
    previousState.badgesGrantedIds = result.badgeIds;
  }

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
          // Absent in snapshots written before cadences shipped — `?? null`
          // is what keeps those old completions reversible.
          lastPeriodKey: previousState.prevLastPeriodKey ?? null,
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

export const EMPTY_STREAK = {
  currentStreak: 0,
  longestStreak: 0,
  totalCompletions: 0,
  lastCompletedDate: null as string | null,
};
