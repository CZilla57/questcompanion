import { Router, type IRouter } from "express";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/calendar/heatmap", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = req.gameUserId;
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 365);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const startDate = cutoff.toISOString().split("T")[0];

  const rows = await db
    .select({
      date: tasksTable.dueDate,
      totalTasks: count(),
      completedTasks: count(
        sql`CASE WHEN ${tasksTable.completed} = true THEN 1 END`
      ),
      xpEarned: sql<number>`COALESCE(SUM(CASE WHEN ${tasksTable.completed} = true THEN ${tasksTable.pointsAwarded} ELSE 0 END), 0)`,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), gte(tasksTable.dueDate, startDate)))
    .groupBy(tasksTable.dueDate)
    .orderBy(tasksTable.dueDate);

  res.json({
    days: rows.map((r) => ({
      date: r.date,
      totalTasks: Number(r.totalTasks),
      completedTasks: Number(r.completedTasks),
      xpEarned: Number(r.xpEarned),
    })),
  });
});

export default router;
