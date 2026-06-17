import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, usersTable, tasksTable, badgesTable, userBadgesTable, activityTable } from "@workspace/db";
import { getLevelInfo, getPointsToNextLevel, DAILY_BONUS_POINTS } from "../lib/gamification";
import { assignPoints } from "../lib/auto-points";
import { advanceHabitStreak } from "../lib/habit-streaks";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const DEFAULT_USER_ID = 1;

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
  const { date, completed } = req.query;

  const conditions = [eq(tasksTable.userId, DEFAULT_USER_ID)];
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
  const { title, description, points = 10, dueDate, priority = "medium" } = req.body as {
    title?: string;
    description?: string;
    points?: number;
    dueDate?: string;
    priority?: string;
  };

  if (!title || !dueDate) {
    res.status(400).json({ error: "title and dueDate are required" });
    return;
  }

  const autoPoint = assignPoints(title, priority);

  const [task] = await db.insert(tasksTable).values({
    userId: DEFAULT_USER_ID,
    title,
    description,
    points: autoPoint.points,
    dueDate,
    priority,
  }).returning();

  res.status(201).json(formatTask(task));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.select().from(tasksTable).where(and(eq(tasksTable.id, id), eq(tasksTable.userId, DEFAULT_USER_ID)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.json(formatTask(task));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { title, description, points, dueDate, priority } = req.body as {
    title?: string;
    description?: string;
    points?: number;
    dueDate?: string;
    priority?: string;
  };

  const updates: Partial<typeof tasksTable.$inferInsert> = {};
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
  if (points != null) updates.points = Math.min(100, Math.max(1, points));
  if (dueDate != null) updates.dueDate = dueDate;
  if (priority != null) updates.priority = priority;

  const [task] = await db.update(tasksTable).set(updates)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, DEFAULT_USER_ID)))
    .returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.json(formatTask(task));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.delete(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, DEFAULT_USER_ID)))
    .returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.sendStatus(204);
});

router.post("/tasks/:id/complete", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, DEFAULT_USER_ID)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (task.completed) {
    // Return current state without changes
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, DEFAULT_USER_ID));
    const lvl = getLevelInfo(user!.totalPoints);
    res.json({
      task: formatTask(task),
      pointsAwarded: 0,
      bonusAwarded: false,
      bonusPoints: 0,
      newTotalPoints: user!.totalPoints,
      newLevel: lvl.level,
      leveledUp: false,
      newBadges: [],
    });
    return;
  }

  const now = new Date();
  const [completedTask] = await db.update(tasksTable)
    .set({ completed: true, completedAt: now })
    .where(eq(tasksTable.id, id))
    .returning();

  // Advance per-template habit streak if this task came from a recurring template
  let habitBadges: typeof badgesTable.$inferSelect[] = [];
  if (task.recurringTaskId) {
    const completionDate = now.toISOString().split("T")[0];
    const result = await advanceHabitStreak(DEFAULT_USER_ID, task.recurringTaskId, completionDate);
    habitBadges = result.newBadges;
  }

  // Award points to user
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, DEFAULT_USER_ID));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const oldLevel = getLevelInfo(user.totalPoints);
  let pointsToAdd = task.points;

  // Log activity
  await db.insert(activityTable).values({
    userId: DEFAULT_USER_ID,
    type: "task_completed",
    description: `Completed "${task.title}"`,
    points: task.points,
  });

  // Check if all tasks for today are done after this completion
  const today = now.toISOString().split("T")[0];
  const todayTasks = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.userId, DEFAULT_USER_ID), eq(tasksTable.dueDate, today)));

  const allDone = todayTasks.every((t) => t.id === id || t.completed);
  let bonusAwarded = false;

  if (allDone && todayTasks.length > 0) {
    // Check if we already gave the bonus today
    const recentBonus = await db.select().from(activityTable)
      .where(and(eq(activityTable.userId, DEFAULT_USER_ID), eq(activityTable.type, "all_day_bonus")))
      .orderBy(desc(activityTable.createdAt))
      .limit(1);

    const alreadyGaveBonus = recentBonus.length > 0 &&
      recentBonus[0].createdAt.toISOString().split("T")[0] === today;

    if (!alreadyGaveBonus) {
      bonusAwarded = true;
      pointsToAdd += DAILY_BONUS_POINTS;
      await db.insert(activityTable).values({
        userId: DEFAULT_USER_ID,
        type: "all_day_bonus",
        description: "Completed all tasks for today! Daily bonus earned.",
        points: DAILY_BONUS_POINTS,
      });
    }
  }

  // Update streak
  const lastActive = user.lastActiveDate;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  let newStreak = user.streakDays;
  if (lastActive !== today) {
    if (lastActive === yesterdayStr) {
      newStreak = user.streakDays + 1;
    } else {
      newStreak = 1;
    }
  }

  const newTotalPoints = user.totalPoints + pointsToAdd;
  const newWeeklyPoints = user.weeklyPoints + pointsToAdd;
  const newLevel = getLevelInfo(newTotalPoints);
  const leveledUp = newLevel.level > oldLevel.level;
  const newLongestStreak = Math.max(user.longestStreak, newStreak);

  await db.update(usersTable).set({
    totalPoints: newTotalPoints,
    weeklyPoints: newWeeklyPoints,
    currentLevel: newLevel.level,
    streakDays: newStreak,
    longestStreak: newLongestStreak,
    lastActiveDate: today,
  }).where(eq(usersTable.id, DEFAULT_USER_ID));

  if (leveledUp) {
    await db.insert(activityTable).values({
      userId: DEFAULT_USER_ID,
      type: "level_up",
      description: `Reached Level ${newLevel.level}: ${newLevel.name}!`,
      points: 0,
    });
  }

  // Check streak milestone
  if (newStreak > user.streakDays && (newStreak === 3 || newStreak === 7 || newStreak === 14 || newStreak === 30 || newStreak % 30 === 0)) {
    await db.insert(activityTable).values({
      userId: DEFAULT_USER_ID,
      type: "streak_milestone",
      description: `${newStreak}-day streak! Keep it up!`,
      points: 0,
    });
  }

  // Check for new badges
  const allBadges = await db.select().from(badgesTable);
  const earnedBadgeIds = (await db.select().from(userBadgesTable).where(eq(userBadgesTable.userId, DEFAULT_USER_ID))).map((ub) => ub.badgeId);

  const updatedUser = { ...user, totalPoints: newTotalPoints, streakDays: newStreak };
  const totalCompleted = (await db.select().from(tasksTable)
    .where(and(eq(tasksTable.userId, DEFAULT_USER_ID), eq(tasksTable.completed, true)))).length;

  const newBadges: typeof badgesTable.$inferSelect[] = [];
  for (const badge of allBadges) {
    if (earnedBadgeIds.includes(badge.id)) continue;
    let qualifies = false;
    if (badge.category === "streak" && newStreak >= badge.requirement) qualifies = true;
    if (badge.category === "tasks" && totalCompleted >= badge.requirement) qualifies = true;
    if (badge.category === "points" && newTotalPoints >= badge.requirement) qualifies = true;
    if (badge.category === "level" && newLevel.level >= badge.requirement) qualifies = true;
    if (qualifies) {
      await db.insert(userBadgesTable).values({ userId: DEFAULT_USER_ID, badgeId: badge.id });
      await db.insert(activityTable).values({
        userId: DEFAULT_USER_ID,
        type: "badge_earned",
        description: `Earned badge: ${badge.name}`,
        points: 0,
      });
      newBadges.push(badge);
    }
  }

  const allNewBadges = [...newBadges, ...habitBadges];

  res.json({
    task: formatTask(completedTask),
    pointsAwarded: task.points,
    bonusAwarded,
    bonusPoints: bonusAwarded ? DAILY_BONUS_POINTS : 0,
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
  });
});

router.post("/tasks/:id/uncomplete", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, DEFAULT_USER_ID)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  if (task.completed) {
    // Deduct points
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, DEFAULT_USER_ID));
    if (user) {
      await db.update(usersTable).set({
        totalPoints: Math.max(0, user.totalPoints - task.points),
        weeklyPoints: Math.max(0, user.weeklyPoints - task.points),
      }).where(eq(usersTable.id, DEFAULT_USER_ID));
    }
  }

  const [updated] = await db.update(tasksTable)
    .set({ completed: false, completedAt: null })
    .where(eq(tasksTable.id, id))
    .returning();

  res.json(formatTask(updated));
});

export default router;
