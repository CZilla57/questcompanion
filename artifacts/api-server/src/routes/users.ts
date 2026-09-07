import { Router, type IRouter } from "express";
import { eq, and, gte, gt, desc } from "drizzle-orm";
import { db, usersTable, tasksTable, activityTable, kingdomPointsTable, focusSessionsTable } from "@workspace/db";
import { getLevelInfo, getPointsToNextLevel, getPointsIntoLevel } from "../lib/gamification";
import { CATEGORY_LABELS } from "../lib/auto-points";
import { resolveTimeZone, localDateKey, buildDayDates, buildDaySlots, localHour } from "../lib/date-buckets";
import { hungerStage, moodFor } from "../lib/hero-care";
import { currentVignette } from "../lib/hero-flavor";
import { bondTier, dayGap, deriveCompanionBeat } from "../lib/companion";
import { companionLine } from "../lib/companion-copy";
import {
  kingdomForCategory, deriveNeglectInvitation, isWorldResting, kingdomStates,
  LIVELINESS_WINDOW_DAYS, type KingdomId,
} from "../lib/kingdoms";
import { unlockedFeatures } from "../lib/feature-gates";
import { characterSheet } from "../lib/character-sheet";
import { buildHeroLook } from "./avatar";
import { decideRename, isUniqueViolation, renameAvailableAt } from "../lib/rename";

const router: IRouter = Router();

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
    renameAvailableAt: renameAvailableAt(user.usernameChangedAt, new Date()),
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/users/me", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

router.patch("/users/me", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { username, displayName, avatarColor } = req.body as { username?: string; displayName?: string; avatarColor?: string };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (displayName != null) updates.displayName = displayName;
  if (avatarColor != null) updates.avatarColor = avatarColor;

  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!current) { res.status(404).json({ error: "User not found" }); return; }

  if (username != null) {
    const decision = decideRename({
      current: current.username,
      requested: username,
      onboardingComplete: current.onboardingComplete,
      usernameChangedAt: current.usernameChangedAt,
      now: new Date(),
    });
    if (decision.kind === "invalid_format") {
      res.status(400).json({ error: "Hero names are 3–20 characters: letters, numbers, and underscores." });
      return;
    }
    if (decision.kind === "cooldown") {
      res.status(429).json({
        error: "Hero names can change once a week.",
        renameAvailableAt: decision.renameAvailableAt.toISOString(),
      });
      return;
    }
    if (decision.kind === "ok") {
      updates.username = username.trim();
      updates.onboardingComplete = true;
      // The onboarding set is free; only real renames start the 7-day clock.
      if (!decision.isOnboardingSet) updates.usernameChangedAt = new Date();
    }
    // "noop": same name — fall through without username updates.
  }

  if (Object.keys(updates).length === 0) {
    res.json(formatUser(current));
    return;
  }

  try {
    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(formatUser(user));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "That hero name is already taken. Try another." });
      return;
    }
    throw err;
  }
});

router.put("/users/me/timezone", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const tz = String((req.body as { tz?: unknown }).tz ?? "");
  if (!tz) { res.status(400).json({ error: "tz is required" }); return; }
  // Reject a bogus zone rather than silently storing garbage.
  try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); }
  catch { res.status(400).json({ error: "invalid IANA timezone" }); return; }

  await db.update(usersTable).set({ timezone: tz }).where(eq(usersTable.id, userId));
  res.json({ ok: true });
});

router.post("/users/me/hyperfocus/pause", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const minutes = Number((req.body as { minutes?: unknown }).minutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    res.status(400).json({ error: "minutes must be between 0 and 1440" });
    return;
  }
  const pausedUntil = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  await db.update(usersTable).set({ hyperfocusPausedUntil: pausedUntil }).where(eq(usersTable.id, userId));
  res.json({ pausedUntil: pausedUntil ? pausedUntil.toISOString() : null });
});

router.get("/users/me/stats", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);
  // Task dueDates are the user's local calendar dates, so "today" must be too.
  const today = localDateKey(new Date(), timeZone);
  const todayTasks = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.dueDate, today)));

  const todayCompleted = todayTasks.filter((t) => t.completed);
  const todayPoints = todayCompleted.reduce((sum, t) => sum + t.points, 0);
  const allDayBonusEarned = todayTasks.length > 0 && todayCompleted.length === todayTasks.length;

  const recentActivity = await db.select().from(activityTable)
    .where(eq(activityTable.userId, userId))
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
    streakFreezes: user.streakFreezes,
    onboardingComplete: user.onboardingComplete,
    pointsToNextLevel: getPointsToNextLevel(user.totalPoints),
    pointsIntoLevel: getPointsIntoLevel(user.totalPoints),
    unlockedFeatures: unlockedFeatures(user),
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

router.get("/users/me/hero-status", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const now = new Date();
  const stage = hungerStage(user.lastFedAt, now);
  const vignette = currentVignette(user.id, stage, user.avatarClass, now);

  const tier = bondTier(user.bondQuestsCompleted);
  // lastActiveDate is written on a UTC calendar-day basis (see the completion
  // path in tasks.ts, which uses now.toISOString().split("T")[0]), and the
  // whole streak subsystem is UTC-based. Compare against UTC "today" here too
  // rather than a tz-local date key — otherwise a positive-offset user
  // (Asia/Australia/NZ) reading this in their local morning would see the
  // local date already rolled over a day ahead of UTC, producing a dayGap of
  // 1 and misreading an actively-questing user as resting.
  const beat = deriveCompanionBeat({
    streakDays: user.streakDays,
    dayGap: dayGap(user.lastActiveDate, now.toISOString().split("T")[0]!),
    hungerStage: stage,
    bondTier: tier.tier,
  });

  res.json({
    stage,
    mood: moodFor(stage),
    lastFedAt: user.lastFedAt.toISOString(),
    activity: { id: vignette.id, text: vignette.text },
    companion: {
      beat: beat.kind,
      line: companionLine(beat, { userId: user.id, now }),
      bondTier: tier.tier,
      bondTierName: tier.name,
      bondQuestsCompleted: user.bondQuestsCompleted,
    },
  });
});

router.get("/users/me/kingdoms", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  // Lifetime (persisted, monotonic).
  const rows = await db.select().from(kingdomPointsTable).where(eq(kingdomPointsTable.userId, userId));
  const lifetimeByKingdom: Partial<Record<KingdomId, number>> = {};
  for (const r of rows) lifetimeByKingdom[r.kingdomId as KingdomId] = r.lifetimePoints;

  // Recent (derived): base points of quests completed inside the window.
  const windowStart = new Date(Date.now() - LIVELINESS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentTasks = await db
    .select({ category: tasksTable.category, points: tasksTable.points })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId),
      eq(tasksTable.completed, true),
      gte(tasksTable.completedAt, windowStart),
    ));

  const recentByKingdom: Partial<Record<KingdomId, number>> = {};
  for (const t of recentTasks) {
    const id = kingdomForCategory(t.category);
    recentByKingdom[id] = (recentByKingdom[id] ?? 0) + t.points;
  }

  res.json({
    worldResting: isWorldResting(recentByKingdom),
    kingdoms: kingdomStates(lifetimeByKingdom, recentByKingdom),
    invitation: deriveNeglectInvitation({ lifetimeByKingdom, recentByKingdom }),
  });
});

// The Campaign — Phase 0: the derived Character Sheet. Six ability scores read
// from the same kingdom lifetime points the map shows, plus Finesse from focus
// discipline, plus a proficiency bonus from the capital tier. Nothing new is
// stored — this is a re-reading of existing signals (see lib/character-sheet).
router.get("/users/me/character-sheet", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  // Five ability sources: lifetime kingdom points (persisted, monotonic).
  const kingdomRows = await db.select().from(kingdomPointsTable).where(eq(kingdomPointsTable.userId, userId));
  const lifetimeByKingdom: Partial<Record<KingdomId, number>> = {};
  for (const r of kingdomRows) lifetimeByKingdom[r.kingdomId as KingdomId] = r.lifetimePoints;

  // Finesse's source: lifetime completed focus intervals across all sessions.
  const focusRows = await db
    .select({ completedIntervals: focusSessionsTable.completedIntervals })
    .from(focusSessionsTable)
    .where(eq(focusSessionsTable.userId, userId));
  const completedIntervals = focusRows.reduce((sum, r) => sum + r.completedIntervals, 0);

  // Class / level / battle power belong to the avatar system — reuse its assembly
  // rather than recomputing battle power here.
  const hero = await buildHeroLook(userId);
  if (!hero) { res.status(404).json({ error: "User not found" }); return; }

  res.json(characterSheet({
    lifetimeByKingdom,
    focus: { completedIntervals },
    heroClass: hero.avatarClass,
    level: hero.level,
    battlePower: hero.battlePower,
  }));
});

router.get("/users/me/xp-history", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? "7"), 10) || 7));
  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);

  // Bucket by the user's local calendar day so the chart matches what they (and
  // the rest of the app) call "today" instead of the server's UTC day.
  const dateSlots = buildDaySlots(new Date(), days, timeZone);

  // Widen the query by a day so no row belonging to the earliest local day is
  // missed due to the UTC↔local offset; out-of-range rows bucket to unused keys.
  const cutoff = new Date(dateSlots[0]!.date + "T00:00:00.000Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);

  const rows = await db
    .select()
    .from(activityTable)
    .where(and(eq(activityTable.userId, userId), gte(activityTable.createdAt, cutoff), gt(activityTable.points, 0)));

  const xpByDate = new Map<string, number>();
  for (const row of rows) {
    const key = localDateKey(row.createdAt, timeZone);
    xpByDate.set(key, (xpByDate.get(key) ?? 0) + row.points);
  }

  res.json(
    dateSlots.map(({ date, label }) => ({
      date,
      label,
      xp: xpByDate.get(date) ?? 0,
    })),
  );
});

router.get("/users/me/insights", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const days = Math.min(90, Math.max(7, parseInt(String(req.query.days ?? "30"), 10) || 30));
  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);

  // Day/hour bucketing follows the user's local calendar, matching the rest of
  // the app; day arithmetic uses UTC anchors so it's stable across DST.
  const dates = buildDayDates(new Date(), days, timeZone);
  const dateSlots = dates.map((date) => ({
    date,
    label: new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  }));

  // Widen the window by a day so no boundary row is missed due to the tz offset.
  const cutoff = new Date(dates[0]! + "T00:00:00.000Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);

  const activityRows = await db
    .select()
    .from(activityTable)
    .where(and(eq(activityTable.userId, userId), gte(activityTable.createdAt, cutoff), gt(activityTable.points, 0)));

  const xpByDate = new Map<string, number>();
  for (const row of activityRows) {
    const key = localDateKey(row.createdAt, timeZone);
    xpByDate.set(key, (xpByDate.get(key) ?? 0) + row.points);
  }
  const xpHistory = dateSlots.map(({ date, label }) => ({ date, label, xp: xpByDate.get(date) ?? 0 }));

  // ── Fetch tasks for the period ────────────────────────────────────────────
  const allTasks = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), gte(tasksTable.createdAt, cutoff)));

  // ── Category breakdown ────────────────────────────────────────────────────
  type CatStat = { category: string; label: string; completed: number; total: number; xpEarned: number };
  const catMap = new Map<string, CatStat>();
  for (const task of allTasks) {
    const key = task.category;
    if (!catMap.has(key)) {
      catMap.set(key, { category: key, label: CATEGORY_LABELS[key] ?? CATEGORY_LABELS.default, completed: 0, total: 0, xpEarned: 0 });
    }
    const stat = catMap.get(key)!;
    stat.total++;
    if (task.completed) {
      stat.completed++;
      stat.xpEarned += task.pointsAwarded ?? task.points;
    }
  }
  const categoryBreakdown = Array.from(catMap.values())
    .filter(s => s.total > 0)
    .sort((a, b) => b.completed - a.completed);

  // ── Day-of-week stats (0=Sun … 6=Sat, using dueDate) ────────────────────
  const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const dowStats = DOW_LABELS.map((label, day) => ({ day, label, completed: 0, total: 0 }));
  for (const task of allTasks) {
    // Anchored quests have no due date, so they don't belong to any weekday bucket.
    if (!task.dueDate) continue;
    const dow = new Date(task.dueDate + "T12:00:00Z").getUTCDay();
    dowStats[dow]!.total++;
    if (task.completed) dowStats[dow]!.completed++;
  }

  // ── Hourly stats (hour 0–23 from completedAt, in the user's timezone) ─────
  const hourStats: { hour: number; label: string; completed: number }[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`,
    completed: 0,
  }));
  for (const task of allTasks) {
    if (task.completed && task.completedAt) {
      const h = localHour(task.completedAt, timeZone);
      hourStats[h]!.completed++;
    }
  }

  // ── Period-of-day summary (group hours into 4 buckets) ───────────────────
  const periods = [
    { key: "morning",   label: "Morning",   range: "6am–12pm",  hours: [6,7,8,9,10,11] },
    { key: "afternoon", label: "Afternoon", range: "12pm–5pm",  hours: [12,13,14,15,16] },
    { key: "evening",   label: "Evening",   range: "5pm–9pm",   hours: [17,18,19,20] },
    { key: "night",     label: "Night",     range: "9pm–6am",   hours: [21,22,23,0,1,2,3,4,5] },
  ];
  const periodStats = periods.map(p => ({
    key: p.key,
    label: p.label,
    range: p.range,
    completed: p.hours.reduce((sum, h) => sum + (hourStats[h]?.completed ?? 0), 0),
  }));

  res.json({
    days,
    xpHistory,
    categoryBreakdown,
    dayOfWeekStats: dowStats,
    periodStats,
  });
});

router.get("/users/search", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json([]);
    return;
  }

  const allUsers = await db.select().from(usersTable);
  const matched = allUsers.filter(
    (u) => u.username.toLowerCase().includes(q.toLowerCase()) && u.id !== userId
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
