import { Router, type IRouter } from "express";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import {
  db, tasksTable, focusSessionsTable, brainCheckinsTable, reflectionsTable, usersTable,
} from "@workspace/db";
import { derivePatterns, PATTERN_WINDOW_DAYS, type PatternInputs } from "../lib/patterns";
import { resolveTimeZone } from "../lib/date-buckets";

const router: IRouter = Router();

/** Load the four 28-day row sets derivePatterns needs. Exported for reflections.ts. */
export async function loadPatternInputs(userId: number, timeZone: string, now: Date): Promise<PatternInputs> {
  const cutoff = new Date(now.getTime() - PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const completions = await db
    .select({
      completedAt: tasksTable.completedAt,
      category: tasksTable.category,
      estimatedMinutes: tasksTable.estimatedMinutes,
      actualMinutes: tasksTable.actualMinutes,
    })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId),
      eq(tasksTable.completed, true),
      isNotNull(tasksTable.completedAt),
      gte(tasksTable.completedAt, cutoff),
    ));

  const focusSessions = await db
    .select({ startedAt: focusSessionsTable.startedAt, focusedSeconds: focusSessionsTable.focusedSeconds })
    .from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), gte(focusSessionsTable.startedAt, cutoff)));

  const checkins = await db
    .select({ mode: brainCheckinsTable.mode, createdAt: brainCheckinsTable.createdAt })
    .from(brainCheckinsTable)
    .where(and(eq(brainCheckinsTable.userId, userId), gte(brainCheckinsTable.createdAt, cutoff)));

  const answered = await db
    .select({ chips: reflectionsTable.chips })
    .from(reflectionsTable)
    .where(and(
      eq(reflectionsTable.userId, userId),
      isNotNull(reflectionsTable.answeredAt),
      gte(reflectionsTable.createdAt, cutoff),
    ));

  return {
    now,
    timeZone,
    completions: completions.map((c) => ({ ...c, completedAt: c.completedAt! })),
    focusSessions,
    checkins,
    reflections: answered.map((r) => ({ chips: r.chips })),
  };
}

/** users.timezone beats the query param beats UTC (spec §3). */
export async function resolveUserTimeZone(userId: number, queryTz: unknown): Promise<string> {
  const [u] = await db.select({ tz: usersTable.timezone }).from(usersTable).where(eq(usersTable.id, userId));
  return resolveTimeZone(u?.tz ?? (typeof queryTz === "string" ? queryTz : undefined));
}

router.get("/users/me/patterns", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const timeZone = await resolveUserTimeZone(userId, req.query.tz);
  const inputs = await loadPatternInputs(userId, timeZone, new Date());
  res.json(derivePatterns(inputs));
});

export default router;
