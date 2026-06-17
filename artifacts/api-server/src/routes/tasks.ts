import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { applyMultiplier } from "../lib/xp-multiplier";
import { db, usersTable, tasksTable, badgesTable, userBadgesTable, activityTable } from "@workspace/db";
import { getLevelInfo, getPointsToNextLevel, DAILY_BONUS_POINTS } from "../lib/gamification";
import { assignPoints } from "../lib/auto-points";
import { advanceHabitStreak, reverseHabitStreak, type HabitStreakPreviousState } from "../lib/habit-streaks";
import { awardStreakGear, getStreakGearRarity, type GearRewardInfo } from "../lib/gear-rewards";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function formatTask(task: typeof tasksTable.$inferSelect) {
  return {
    id: task.id,
    userId: task.userId,
    title: task.title,
    description: task.description,
    points: task.points,
    completed: task.completed,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    dueDate: task.dueDate,
    priority: task.priority,
    createdAt: task.createdAt.toISOString(),
  };
}

router.get("/tasks/suggest-points", (req, res): void => {
  const title = String(req.query.title ?? "");
  const priority = String(req.query.priority ?? "medium");
  const result = assignPoints(title, priority);
  res.json(result);
});

router.get("/tasks", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { date, completed } = req.query;

  const conditions = [eq(tasksTable.userId, userId)];
  if (date && typeof date === "string") {
    conditions.push(eq(tasksTable.dueDate, date));
  }
  if (completed !== undefined && completed !== null) {
    conditions.push(eq(tasksTable.completed, completed === "true"));
  }

  const tasks = await db.select().from(tasksTable)
    .where(and(...conditions))
    .orderBy(desc(tasksTable.createdAt));

  res.json(tasks.map(formatTask));
});

router.post("/tasks", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, description, dueDate, priority = "medium" } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    priority?: string;
  };

  if (!title || !dueDate) {
    res.status(400).json({ error: "title and dueDate are required" });
    return;
  }

  const autoPoint = assignPoints(title, priority);

  const [task] = await db.insert(tasksTable).values({
    userId,
    title,
    description,
    points: autoPoint.points,
    dueDate,
    priority,
  }).returning();

  res.status(201).json(formatTask(task));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.select().from(tasksTable).where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.json(formatTask(task));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Fetch task upfront to enforce ownership and block edits on completed tasks.
  const [existing] = await db.select({ completed: tasksTable.completed })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }
  if (existing.completed) { res.status(409).json({ error: "Cannot edit a completed task" }); return; }

  // Points are server-assigned by auto-points logic and are not client-editable.
  const { title, description, dueDate, priority } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    priority?: string;
  };

  const updates: Partial<typeof tasksTable.$inferInsert> = {};
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
  if (dueDate != null) updates.dueDate = dueDate;
  if (priority != null) updates.priority = priority;

  // The WHERE clause re-checks completed=false as a safety guard against a race
  // between the read above and this write.
  const [task] = await db.update(tasksTable).set(updates)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId), eq(tasksTable.completed, false)))
    .returning();
  if (!task) { res.status(409).json({ error: "Cannot edit a completed task" }); return; }

  res.json(formatTask(task));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.delete(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
    .returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.sendStatus(204);
});

router.post("/tasks/:id/complete", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // ─── Critical section ────────────────────────────────────────────────────────
  // Run inside a transaction so the task's completed=true and full snapshot are
  // committed atomically.  No /uncomplete request can ever observe completed=true
  // with a null pointsAwarded after this transaction commits.
  type TxOutcome =
    | { status: "not_found" }
    | { status: "already_completed"; existingTask: typeof tasksTable.$inferSelect; userPoints: number }
    | {
        status: "ok";
        task: typeof tasksTable.$inferSelect;
        boostedBase: number;
        pointsToAdd: number;
        bonusAwarded: boolean;
        streakBonus: number;
        multiplierLabel: string;
        multiplierValue: number;
        newTotalPoints: number;
        newWeeklyPoints: number;
        newLevel: ReturnType<typeof getLevelInfo>;
        leveledUp: boolean;
        newStreak: number;
        oldStreak: number;
        freezeConsumed: boolean;
      };

  const outcome = await db.transaction(async (tx): Promise<TxOutcome> => {
    // Lock the user row for the duration of the transaction to prevent concurrent
    // completions from reading stale point/streak totals.
    const [user] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!user) return { status: "not_found" };

    // Attempt the atomic completed=false → true flip.
    const [task] = await tx.update(tasksTable)
      .set({ completed: true, completedAt: now })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId), eq(tasksTable.completed, false)))
      .returning();

    if (!task) {
      const [existing] = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
      if (!existing) return { status: "not_found" };
      return { status: "already_completed", existingTask: existing, userPoints: user.totalPoints };
    }

    const oldLevel = getLevelInfo(user.totalPoints);
    const { totalPoints: boostedBase, streakBonus, multiplierInfo } = applyMultiplier(task.points, user.streakDays);
    let pointsToAdd = boostedBase;

    // Daily bonus check: read today's tasks inside the transaction for consistency.
    const todayTasks = await tx.select().from(tasksTable)
      .where(and(eq(tasksTable.userId, userId), eq(tasksTable.dueDate, today)));
    const allDone = todayTasks.every((t) => t.id === id || t.completed);
    let bonusAwarded = false;
    if (allDone && todayTasks.length > 0) {
      const recentBonus = await tx.select().from(activityTable)
        .where(and(eq(activityTable.userId, userId), eq(activityTable.type, "all_day_bonus")))
        .orderBy(desc(activityTable.createdAt))
        .limit(1);
      const alreadyGaveBonus = recentBonus.length > 0 &&
        recentBonus[0].createdAt.toISOString().split("T")[0] === today;
      if (!alreadyGaveBonus) {
        bonusAwarded = true;
        pointsToAdd += DAILY_BONUS_POINTS;
      }
    }

    // Streak computation.
    const streakDaysBefore = user.streakDays;
    const longestStreakBefore = user.longestStreak;
    const lastActiveDateBefore = user.lastActiveDate ?? null;
    let newStreak = user.streakDays;
    let freezeConsumed = false;
    if (user.lastActiveDate !== today) {
      if (user.lastActiveDate === yesterdayStr) {
        newStreak = user.streakDays + 1;
      } else if (user.streakFreezes > 0) {
        freezeConsumed = true;
      } else {
        newStreak = 1;
      }
    }

    const newTotalPoints = user.totalPoints + pointsToAdd;
    const newWeeklyPoints = user.weeklyPoints + pointsToAdd;
    const newLevel = getLevelInfo(newTotalPoints);
    const leveledUp = newLevel.level > oldLevel.level;
    const newLongestStreak = Math.max(user.longestStreak, newStreak);

    // Persist user state.
    await tx.update(usersTable).set({
      totalPoints: newTotalPoints,
      weeklyPoints: newWeeklyPoints,
      currentLevel: newLevel.level,
      streakDays: newStreak,
      longestStreak: newLongestStreak,
      lastActiveDate: today,
      ...(freezeConsumed ? { streakFreezes: user.streakFreezes - 1 } : {}),
    }).where(eq(usersTable.id, userId));

    // Write the full completion snapshot onto the task in the same transaction so
    // /uncomplete always sees a consistent state: completed=true ⟹ snapshot present.
    await tx.update(tasksTable).set({
      pointsAwarded: boostedBase,
      dailyBonusAwarded: bonusAwarded,
      streakDaysBefore,
      longestStreakBefore,
      lastActiveDateBefore,
      freezeConsumedOnComplete: freezeConsumed,
    }).where(eq(tasksTable.id, id));

    return {
      status: "ok",
      task,
      boostedBase,
      pointsToAdd,
      bonusAwarded,
      streakBonus,
      multiplierLabel: multiplierInfo.label,
      multiplierValue: multiplierInfo.multiplier,
      newTotalPoints,
      newWeeklyPoints,
      newLevel,
      leveledUp,
      newStreak,
      oldStreak: user.streakDays,
      freezeConsumed,
    };
  });
  // ─────────────────────────────────────────────────────────────────────────────

  if (outcome.status === "not_found") {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (outcome.status === "already_completed") {
    const lvl = getLevelInfo(outcome.userPoints);
    res.json({
      task: formatTask(outcome.existingTask),
      pointsAwarded: 0,
      bonusAwarded: false,
      bonusPoints: 0,
      streakBonus: 0,
      xpMultiplier: 1,
      newTotalPoints: outcome.userPoints,
      newLevel: lvl.level,
      leveledUp: false,
      newBadges: [],
    });
    return;
  }

  const { task, boostedBase, pointsToAdd, bonusAwarded, streakBonus, multiplierLabel, multiplierValue,
    newTotalPoints, newLevel, leveledUp, newStreak, oldStreak, freezeConsumed } = outcome;

  // ─── Post-transaction side effects ───────────────────────────────────────────
  // These run outside the transaction.  Any failure here leaves the user with
  // slightly stale badge/streak state rather than inconsistent XP — an acceptable
  // trade-off.  The unique constraints on user_badges and habit_streaks provide
  // last-resort protection against duplicates.

  let habitBadges: typeof badgesTable.$inferSelect[] = [];
  let habitStreakPreviousState: HabitStreakPreviousState | null = null;
  let habitGearReward: GearRewardInfo | null = null;
  if (task.recurringTaskId) {
    const completionDate = today;
    const result = await advanceHabitStreak(userId, task.recurringTaskId, completionDate, newLevel.level);
    habitBadges = result.newBadges;
    habitStreakPreviousState = result.previousState;
    habitGearReward = result.gearReward;
  }

  await db.insert(activityTable).values({
    userId,
    type: "task_completed",
    description: streakBonus > 0
      ? `Completed "${task.title}" (${multiplierLabel})`
      : `Completed "${task.title}"`,
    points: boostedBase,
  });

  if (bonusAwarded) {
    await db.insert(activityTable).values({
      userId,
      type: "all_day_bonus",
      description: "Completed all tasks for today! Daily bonus earned.",
      points: DAILY_BONUS_POINTS,
    });
  }

  if (freezeConsumed) {
    await db.insert(activityTable).values({
      userId,
      type: "streak_freeze_used",
      description: `Streak Freeze activated! Your ${oldStreak}-day streak is safe.`,
      points: 0,
    });
  }

  if (leveledUp) {
    await db.insert(activityTable).values({
      userId,
      type: "level_up",
      description: `Reached Level ${newLevel.level}: ${newLevel.name}!`,
      points: 0,
    });
  }

  let accountGearReward: GearRewardInfo | null = null;
  if (newStreak > oldStreak && (newStreak === 3 || newStreak === 7 || newStreak === 14 || newStreak === 30 || newStreak % 30 === 0)) {
    await db.insert(activityTable).values({
      userId,
      type: "streak_milestone",
      description: `${newStreak}-day streak! Keep it up!`,
      points: 0,
    });
    const isHighValue = task.points >= 50;
    const targetRarity = getStreakGearRarity(newStreak, isHighValue);
    accountGearReward = await awardStreakGear(
      userId,
      newLevel.level,
      targetRarity,
      `${newStreak}-day streak milestone`,
    );
  }

  // Badge grants.
  const allBadges = await db.select().from(badgesTable);
  const earnedBadgeIds = (await db.select().from(userBadgesTable)
    .where(eq(userBadgesTable.userId, userId))).map((ub) => ub.badgeId);
  const totalCompleted = (await db.select().from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true)))).length;

  const newBadges: typeof badgesTable.$inferSelect[] = [];
  const newBadgeIds: number[] = [];
  for (const badge of allBadges) {
    if (earnedBadgeIds.includes(badge.id)) continue;
    let qualifies = false;
    if (badge.category === "streak" && newStreak >= badge.requirement) qualifies = true;
    if (badge.category === "tasks" && totalCompleted >= badge.requirement) qualifies = true;
    if (badge.category === "points" && newTotalPoints >= badge.requirement) qualifies = true;
    if (badge.category === "level" && newLevel.level >= badge.requirement) qualifies = true;
    if (qualifies) {
      // onConflictDoNothing prevents duplicate badge rows from concurrent completions.
      // Only record activity and snapshot the badge ID if the insert actually succeeded.
      const [inserted] = await db.insert(userBadgesTable)
        .values({ userId, badgeId: badge.id })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        await db.insert(activityTable).values({
          userId,
          type: "badge_earned",
          description: `Earned badge: ${badge.name}`,
          points: 0,
        });
        newBadges.push(badge);
        newBadgeIds.push(badge.id);
      }
    }
  }

  // Append badge IDs and habit-streak snapshot to the task row so /uncomplete can reverse them.
  await db.update(tasksTable).set({
    badgesGrantedIds: newBadgeIds.length > 0 ? JSON.stringify(newBadgeIds) : null,
    habitStreakSnapshot: habitStreakPreviousState
      ? JSON.stringify(habitStreakPreviousState)
      : null,
  }).where(eq(tasksTable.id, id));
  // ─────────────────────────────────────────────────────────────────────────────

  const allNewBadges = [...newBadges, ...habitBadges];

  // Surface the best gear reward (highest rarity wins; habit over account if tied)
  const RARITY_RANK: Record<string, number> = { common: 1, rare: 2, epic: 3, legendary: 4 };
  let gearReward: GearRewardInfo | null = null;
  if (accountGearReward && habitGearReward) {
    gearReward =
      (RARITY_RANK[habitGearReward.rarity] ?? 0) >= (RARITY_RANK[accountGearReward.rarity] ?? 0)
        ? habitGearReward
        : accountGearReward;
  } else {
    gearReward = habitGearReward ?? accountGearReward;
  }

  res.json({
    task: formatTask(task),
    pointsAwarded: pointsToAdd,
    bonusAwarded,
    bonusPoints: bonusAwarded ? DAILY_BONUS_POINTS : 0,
    streakBonus,
    xpMultiplier: multiplierValue,
    newTotalPoints,
    newLevel: newLevel.level,
    leveledUp,
    newBadges: allNewBadges.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      category: b.category,
      requirement: b.requirement,
    })),
    gearReward,
  });
});

router.post("/tasks/:id/uncomplete", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Collect side-effect reversal info before entering the transaction.
  const [taskPre] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!taskPre) { res.status(404).json({ error: "Task not found" }); return; }

  if (!taskPre.completed) {
    res.json(formatTask(taskPre));
    return;
  }

  // Require a valid snapshot.  Without it we cannot safely compute the exact rollback amounts,
  // so we reject the request rather than silently applying an incorrect partial reversal.
  if (taskPre.pointsAwarded === null || taskPre.pointsAwarded === undefined) {
    res.status(409).json({ error: "Task completion snapshot unavailable; cannot uncomplete" });
    return;
  }

  // ─── Transactional rollback ───────────────────────────────────────────────────
  const updatedTask = await db.transaction(async (tx) => {
    // Lock task and user rows to prevent concurrent /complete from racing this rollback.
    const [user] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    const [task] = await tx.select().from(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .for("update");

    if (!task || !user) return null;
    if (!task.completed) return task; // idempotent: already uncompleted

    const baseToReverse = task.pointsAwarded!;
    const bonusToReverse = task.dailyBonusAwarded ? DAILY_BONUS_POINTS : 0;
    const totalToReverse = baseToReverse + bonusToReverse;

    const newTotalPoints = Math.max(0, user.totalPoints - totalToReverse);
    const newWeeklyPoints = Math.max(0, user.weeklyPoints - totalToReverse);
    const newLevel = getLevelInfo(newTotalPoints);

    // Determine whether to restore streak state.
    // Only restore if this task was the sole contributor of today's streak advancement,
    // i.e., no other completed task remains for today.
    const today = new Date().toISOString().split("T")[0];
    const otherCompletedToday = await tx.select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.userId, userId),
        eq(tasksTable.completed, true),
        eq(tasksTable.dueDate, today),
      ));
    const hasOtherCompletedToday = otherCompletedToday.some((t) => t.id !== id);

    let newStreakDays = user.streakDays;
    let newLongestStreak = user.longestStreak;
    let newLastActiveDate: string | null = user.lastActiveDate ?? null;
    let freezesToRestore = 0;

    if (!hasOtherCompletedToday && task.streakDaysBefore !== null && task.streakDaysBefore !== undefined) {
      newStreakDays = task.streakDaysBefore;
      newLongestStreak = task.longestStreakBefore ?? user.longestStreak;
      newLastActiveDate = task.lastActiveDateBefore ?? null;
      if (task.freezeConsumedOnComplete) {
        freezesToRestore = 1;
      }
    }

    await tx.update(usersTable).set({
      totalPoints: newTotalPoints,
      weeklyPoints: newWeeklyPoints,
      currentLevel: newLevel.level,
      streakDays: newStreakDays,
      longestStreak: newLongestStreak,
      lastActiveDate: newLastActiveDate,
      ...(freezesToRestore > 0 ? { streakFreezes: user.streakFreezes + freezesToRestore } : {}),
    }).where(eq(usersTable.id, userId));

    const [updated] = await tx.update(tasksTable)
      .set({
        completed: false,
        completedAt: null,
        pointsAwarded: null,
        dailyBonusAwarded: false,
        streakDaysBefore: null,
        longestStreakBefore: null,
        lastActiveDateBefore: null,
        freezeConsumedOnComplete: false,
        badgesGrantedIds: null,
        habitStreakSnapshot: null,
      })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.completed, true)))
      .returning();

    return updated ?? task;
  });
  // ─────────────────────────────────────────────────────────────────────────────

  if (!updatedTask) { res.status(404).json({ error: "Task not found" }); return; }

  // ─── Post-transaction side effects ───────────────────────────────────────────
  // Revoke task-completion badges and reverse habit streak advancement.
  // These use the snapshot captured before the transaction started; even if they
  // run slightly after the transaction commits, they are idempotent and safe.

  if (taskPre.badgesGrantedIds) {
    const badgeIds = JSON.parse(taskPre.badgesGrantedIds) as number[];
    for (const badgeId of badgeIds) {
      await db.delete(userBadgesTable)
        .where(and(eq(userBadgesTable.userId, userId), eq(userBadgesTable.badgeId, badgeId)));
    }
  }

  if (taskPre.recurringTaskId && taskPre.habitStreakSnapshot) {
    const previousState = JSON.parse(taskPre.habitStreakSnapshot) as HabitStreakPreviousState;
    await reverseHabitStreak(userId, taskPre.recurringTaskId, previousState);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  res.json(formatTask(updatedTask));
});

void getPointsToNextLevel;
void logger;

export default router;
