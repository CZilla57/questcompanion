import { Router, type IRouter } from "express";
import { desc, eq, and, isNotNull } from "drizzle-orm";
import { db, usersTable, tasksTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";

const router: IRouter = Router();

router.get("/leaderboard", async (req, res): Promise<void> => {
  const period = req.query.period === "weekly" ? "weekly" : "alltime";

  const users = await db.select().from(usersTable)
    .where(isNotNull(usersTable.replitId))
    .orderBy(period === "weekly" ? desc(usersTable.weeklyPoints) : desc(usersTable.totalPoints));

  const entries = await Promise.all(users.map(async (u, idx) => {
    const completedTasks = await db.select().from(tasksTable)
      .where(and(eq(tasksTable.userId, u.id), eq(tasksTable.completed, true)));
    const lvl = getLevelInfo(u.totalPoints);
    return {
      rank: idx + 1,
      user: {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarColor: u.avatarColor,
        currentLevel: lvl.level,
        levelName: lvl.name,
        totalPoints: u.totalPoints,
        streakDays: u.streakDays,
      },
      points: period === "weekly" ? u.weeklyPoints : u.totalPoints,
      tasksCompleted: completedTasks.length,
    };
  }));

  res.json(entries);
});

export default router;
