import { Router, type IRouter } from "express";
import { eq, and, gte, gt, desc } from "drizzle-orm";
import { db, usersTable, tasksTable, activityTable } from "@workspace/db";
import { getLevelInfo, getPointsToNextLevel } from "../lib/gamification";

const router: IRouter = Router();

const DEFAULT_USER_ID = 1;

function formatUser(user: typeof usersTable.$inferSelect) {
  const levelInfo = getLevelInfo(user.totalPoints);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    totalPoints: user.totalPoints,
    weeklyPoints: user.weeklyPoints,
    currentLevel: levelInfo.level,
    levelName: levelInfo.name,
    streakDays: user.streakDays,
    longestStreak: user.longestStreak,
    pointsToNextLevel: getPointsToNextLevel(user.totalPoints),
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/users/me", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, DEFAULT_USER_ID));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

router.patch("/users/me", async (req, res): Promise<void> => {
  const { username, displayName, avatarColor } = req.body as { username?: string; displayName?: string; avatarColor?: string };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (username != null) updates.username = username;
  if (displayName != null) updates.displayName = displayName;
  if (avatarColor != null) updates.avatarColor = avatarColor;

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, DEFAULT_USER_ID)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

router.get("/users/me/stats", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, DEFAULT_USER_ID));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const todayTasks = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.userId, DEFAULT_USER_ID), eq(tasksTable.dueDate, today)));

  const todayCompleted = todayTasks.filter((t) => t.completed);
  const todayPoints = todayCompleted.reduce((sum, t) => sum + t.points, 0);
  const allDayBonusEarned = todayTasks.length > 0 && todayCompleted.length === todayTasks.length;

  const recentActivity = await db.select().from(activityTable)
    .where(eq(activityTable.userId, DEFAULT_USER_ID))
    .orderBy(desc(activityTable.createdAt))
    .limit(10);

  const levelInfo = getLevelInfo(user.totalPoints);

  res.json({
    todayPoints,
    todayTasksTotal: todayTasks.length,
    todayTasksCompleted: todayCompleted.length,
    allDayBonusEarned,
    weeklyPoints: user.weeklyPoints,
    totalPoints: user.totalPoints,
    currentLevel: levelInfo.level,
    levelName: levelInfo.name,
    streakDays: user.streakDays,
    pointsToNextLevel: getPointsToNextLevel(user.totalPoints),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      userId: a.userId,
      username: user.username,
      type: a.type,
      description: a.description,
      points: a.points,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

router.get("/users/me/xp-history", async (req, res): Promise<void> => {
  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? "7"), 10) || 7));

  // Build the last `days` date strings in order (oldest first)
  const today = new Date();
  const dateSlots: { date: string; label: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("en-US", { weekday: "short" });
    dateSlots.push({ date: dateStr, label });
  }

  const earliest = dateSlots[0].date;
  const cutoff = new Date(earliest + "T00:00:00.000Z");

  // Fetch all activity rows with points > 0 in the window
  const rows = await db
    .select()
    .from(activityTable)
    .where(and(eq(activityTable.userId, DEFAULT_USER_ID), gte(activityTable.createdAt, cutoff), gt(activityTable.points, 0)));

  // Group by local date string (YYYY-MM-DD of createdAt in UTC)
  const xpByDate = new Map<string, number>();
  for (const row of rows) {
    const d = row.createdAt.toISOString().split("T")[0];
    xpByDate.set(d, (xpByDate.get(d) ?? 0) + row.points);
  }

  res.json(
    dateSlots.map(({ date, label }) => ({
      date,
      label,
      xp: xpByDate.get(date) ?? 0,
    })),
  );
});

router.get("/users/search", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json([]);
    return;
  }
  const users = await db.select().from(usersTable)
    .where(
      and(
        // Simple LIKE search using raw SQL
      )
    );

  // Do a manual filter since drizzle LIKE requires sql template
  const allUsers = await db.select().from(usersTable);
  const matched = allUsers.filter(
    (u) => u.username.toLowerCase().includes(q.toLowerCase()) && u.id !== DEFAULT_USER_ID
  ).slice(0, 10);

  res.json(matched.map((u) => {
    const lvl = getLevelInfo(u.totalPoints);
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarColor: u.avatarColor,
      currentLevel: lvl.level,
      levelName: lvl.name,
      totalPoints: u.totalPoints,
      streakDays: u.streakDays,
    };
  }));
});

export default router;
