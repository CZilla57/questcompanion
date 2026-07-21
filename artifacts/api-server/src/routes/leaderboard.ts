import { Router, type IRouter } from "express";
import { desc, eq, and, gt, gte, lt, isNotNull, sql } from "drizzle-orm";
import { db, usersTable, tasksTable, activityTable, focusSessionsTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { resolveTimeZone } from "../lib/date-buckets";
import { comparisonWindows, type Window } from "../lib/self-week";

const router: IRouter = Router();

// Windowed sums for the self-comparison. Same grammars as the recap loader:
// quests = completed tasks by completedAt; xp = positive activity points;
// focus = focused seconds (>0 filters opened-and-abandoned sessions).
async function totalsInWindow(userId: number, w: Window) {
  const [q] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId), eq(tasksTable.completed, true),
      isNotNull(tasksTable.completedAt),
      gte(tasksTable.completedAt, w.start), lt(tasksTable.completedAt, w.end),
    ));
  const [x] = await db
    .select({ n: sql<number>`coalesce(sum(${activityTable.points}), 0)`.mapWith(Number) })
    .from(activityTable)
    .where(and(
      eq(activityTable.userId, userId), gt(activityTable.points, 0),
      gte(activityTable.createdAt, w.start), lt(activityTable.createdAt, w.end),
    ));
  const [f] = await db
    .select({ n: sql<number>`coalesce(sum(${focusSessionsTable.focusedSeconds}), 0)`.mapWith(Number) })
    .from(focusSessionsTable)
    .where(and(
      eq(focusSessionsTable.userId, userId), gt(focusSessionsTable.focusedSeconds, 0),
      gte(focusSessionsTable.startedAt, w.start), lt(focusSessionsTable.startedAt, w.end),
    ));
  return {
    quests: q?.n ?? 0,
    xp: x?.n ?? 0,
    focusMinutes: Math.round((f?.n ?? 0) / 60),
  };
}

router.get("/leaderboard/my-week", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const tz = resolveTimeZone(user?.timezone);
  const windows = comparisonWindows(new Date(), tz);

  const [current, samePoint, lastWeek] = await Promise.all([
    totalsInWindow(userId, windows.current),
    totalsInWindow(userId, windows.samePoint),
    totalsInWindow(userId, windows.lastWeek),
  ]);

  res.json({
    timezone: tz,
    weekStartDateKey: windows.weekStartDateKey,
    quests: { current: current.quests, samePointLastWeek: samePoint.quests, lastWeekTotal: lastWeek.quests },
    xp: { current: current.xp, samePointLastWeek: samePoint.xp, lastWeekTotal: lastWeek.xp },
    focusMinutes: { current: current.focusMinutes, samePointLastWeek: samePoint.focusMinutes, lastWeekTotal: lastWeek.focusMinutes },
  });
});

router.get("/leaderboard", async (req, res): Promise<void> => {
  const period = req.query.period === "weekly" ? "weekly" : "alltime";

  const users = await db.select().from(usersTable)
    .where(isNotNull(usersTable.externalId))
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
