import { Router, type IRouter } from "express";
import { and, eq, gte, isNull } from "drizzle-orm";
import {
  db, reflectionsTable, tasksTable, focusSessionsTable, brainCheckinsTable,
  rescueEventsTable, usersTable, activityTable, type Reflection,
} from "@workspace/db";
import { localDateKey, localDayStartUtc } from "../lib/date-buckets";
import { derivePatterns } from "../lib/patterns";
import { buildDaySummary, draftQuestion, draftAck, fallbackQuestion } from "../lib/ai/reflection";
import { validateAnswer, REFLECTION_XP } from "../lib/reflections";
import { generateJson, isAiConfigured } from "../lib/ai/client";
import { getLevelInfo } from "../lib/gamification";
import { loadPatternInputs, resolveUserTimeZone } from "./patterns";

const router: IRouter = Router();

function serialize(r: Reflection) {
  return {
    id: r.id,
    localDate: r.localDate,
    prompt: r.prompt,
    promptSource: r.promptSource,
    chips: r.chips,
    freeText: r.freeText,
    ack: r.ack,
    answeredAt: r.answeredAt ? r.answeredAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function todayRow(userId: number, localDate: string): Promise<Reflection | undefined> {
  const [row] = await db.select().from(reflectionsTable)
    .where(and(eq(reflectionsTable.userId, userId), eq(reflectionsTable.localDate, localDate)));
  return row;
}

/** Draft today's question and insert the row; race-safe via the unique constraint. */
async function draftToday(userId: number, timeZone: string, localDate: string, now: Date): Promise<Reflection> {
  const dayStart = localDayStartUtc(localDate, timeZone);

  const completedToday = await db
    .select({ title: tasksTable.title, category: tasksTable.category, completedAt: tasksTable.completedAt })
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true), gte(tasksTable.completedAt, dayStart)));

  const focusToday = await db
    .select({ focusedSeconds: focusSessionsTable.focusedSeconds })
    .from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), gte(focusSessionsTable.startedAt, dayStart)));

  const checkinsToday = await db
    .select({ mode: brainCheckinsTable.mode, createdAt: brainCheckinsTable.createdAt })
    .from(brainCheckinsTable)
    .where(and(eq(brainCheckinsTable.userId, userId), gte(brainCheckinsTable.createdAt, dayStart)));

  const rescuesToday = await db
    .select({ id: rescueEventsTable.id })
    .from(rescueEventsTable)
    .where(and(eq(rescueEventsTable.userId, userId), gte(rescueEventsTable.createdAt, dayStart)));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  const day = buildDaySummary({
    completedToday: completedToday.map((t) => ({ ...t, completedAt: t.completedAt! })),
    focusSecondsToday: focusToday.reduce((s, f) => s + f.focusedSeconds, 0),
    checkinsToday,
    rescueCountToday: rescuesToday.length,
    streakDays: user?.streakDays ?? 0,
    timeZone,
  });
  const patterns = derivePatterns(await loadPatternInputs(userId, timeZone, now));

  const { question, source } = await draftQuestion(
    day, patterns, userId, localDate,
    isAiConfigured() ? generateJson : null,
  );

  const [inserted] = await db.insert(reflectionsTable)
    .values({ userId, localDate, prompt: question, promptSource: source, chips: [] })
    .onConflictDoNothing()
    .returning();
  // Lost the race to a concurrent first-open — the winner's row is today's row.
  return inserted ?? (await todayRow(userId, localDate))!;
}

router.get("/reflections/today", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const now = new Date();
  const timeZone = await resolveUserTimeZone(userId, req.query.tz);
  const localDate = localDateKey(now, timeZone);

  const existing = await todayRow(userId, localDate);
  if (existing) { res.json({ reflection: serialize(existing) }); return; }

  if (String(req.query.draft ?? "") !== "true") {
    res.json({ reflection: null });
    return;
  }
  res.json({ reflection: serialize(await draftToday(userId, timeZone, localDate, now)) });
});

router.post("/reflections/today", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const v = validateAnswer(req.body);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }

  const now = new Date();
  const timeZone = await resolveUserTimeZone(userId, req.body?.tz);
  const localDate = localDateKey(now, timeZone);

  let row = await todayRow(userId, localDate);
  if (!row) {
    const [inserted] = await db.insert(reflectionsTable)
      .values({ userId, localDate, prompt: fallbackQuestion(userId, localDate), promptSource: "fallback", chips: [] })
      .onConflictDoNothing()
      .returning();
    row = inserted ?? (await todayRow(userId, localDate))!;
  }
  const rowId = row.id;

  let xpAwarded = 0;
  await db.transaction(async (tx) => {
    // First-answer claim: atomic via the answered_at IS NULL predicate.
    const claimed = await tx.update(reflectionsTable)
      .set({ answeredAt: now })
      .where(and(eq(reflectionsTable.id, rowId), isNull(reflectionsTable.answeredAt)))
      .returning({ id: reflectionsTable.id });

    await tx.update(reflectionsTable)
      .set({ chips: v.chips, freeText: v.freeText })
      .where(eq(reflectionsTable.id, rowId));

    if (claimed.length > 0) {
      // Content-free activity row — the fact of reflecting is shame-safe; the
      // content never leaves the reflections table (spec §1).
      await tx.insert(activityTable).values({
        userId, type: "reflection", description: "Evening reflection", points: REFLECTION_XP,
      });
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
      if (user) {
        const newTotal = user.totalPoints + REFLECTION_XP;
        await tx.update(usersTable).set({
          totalPoints: newTotal,
          weeklyPoints: user.weeklyPoints + REFLECTION_XP,
          currentLevel: getLevelInfo(newTotal).level,
          // The Campaign — Phase 3: making camp is the hero's "long rest".
          // The evening reflection restores vitality exactly as feeding does
          // (lastFedAt := now), so a reflective end to the day leaves the hero
          // rested. First-answer-only (inside the XP claim), so re-opening the
          // reflection never re-feeds; anti-shame, upside-only.
          lastFedAt: now,
          hungerNotifiedStage: null,
        }).where(eq(usersTable.id, userId));
      }
      xpAwarded = REFLECTION_XP;
    }
  });

  // Ack AFTER the commit; on model failure the fallback is stored (spec §4).
  const ack = await draftAck(v.chips, v.freeText, userId, localDate, isAiConfigured() ? generateJson : null);
  await db.update(reflectionsTable).set({ ack }).where(eq(reflectionsTable.id, rowId));

  const final = (await todayRow(userId, localDate))!;
  res.json({ reflection: serialize(final), xpAwarded });
});

export default router;
