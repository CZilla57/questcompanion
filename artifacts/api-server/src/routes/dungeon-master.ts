import { Router, type IRouter } from "express";
import { and, eq, gte, asc } from "drizzle-orm";
import {
  db, tasksTable, focusSessionsTable, usersTable, campaignsTable, questlinesTable,
  dmBeatsTable, type DmBeat, type DmBeatKind,
} from "@workspace/db";
import { localDateKey, localDayStartUtc } from "../lib/date-buckets";
import { resolveUserTimeZone } from "./patterns";
import { buildBeatFacts, beatHasSubstance } from "../lib/dungeon-master";
import { draftBeat } from "../lib/ai/dungeon-master";
import { generateJson, isAiConfigured } from "../lib/ai/client";
import type { DmBeatFacts } from "@workspace/db";

const router: IRouter = Router();

const BEAT_KINDS: readonly DmBeatKind[] = ["morning", "camp"];

function serialize(row: DmBeat) {
  return {
    kind: row.kind,
    localDate: row.localDate,
    narrative: row.narrative,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

async function cachedBeat(userId: number, localDate: string, kind: DmBeatKind): Promise<DmBeat | undefined> {
  const [row] = await db.select().from(dmBeatsTable)
    .where(and(
      eq(dmBeatsTable.userId, userId),
      eq(dmBeatsTable.localDate, localDate),
      eq(dmBeatsTable.kind, kind),
    ));
  return row;
}

/** The active campaign's current (first not-yet-completed) chapter beat, or null. */
async function currentChapterBeat(userId: number): Promise<string | null> {
  const [campaign] = await db.select({ id: campaignsTable.id }).from(campaignsTable)
    .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));
  if (!campaign) return null;
  const chapters = await db
    .select({ status: questlinesTable.status, chapterBeat: questlinesTable.chapterBeat })
    .from(questlinesTable)
    .where(eq(questlinesTable.campaignId, campaign.id))
    .orderBy(asc(questlinesTable.id));
  const current = chapters.find((c) => c.status !== "completed") ?? chapters[chapters.length - 1];
  return current?.chapterBeat ?? null;
}

/** Gather the day's strengths-only grounding facts for a beat. */
async function assembleFacts(
  userId: number, timeZone: string, localDate: string,
): Promise<DmBeatFacts> {
  const dayStart = localDayStartUtc(localDate, timeZone);

  const completedToday = await db
    .select({ title: tasksTable.title, category: tasksTable.category })
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true), gte(tasksTable.completedAt, dayStart)));

  const plannedToday = await db
    .select({ title: tasksTable.title })
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, false), eq(tasksTable.dueDate, localDate)));

  const focusToday = await db
    .select({ focusedSeconds: focusSessionsTable.focusedSeconds })
    .from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), gte(focusSessionsTable.startedAt, dayStart)));

  const [user] = await db.select({ streakDays: usersTable.streakDays }).from(usersTable).where(eq(usersTable.id, userId));

  // Kingdom-growth grounding needs a per-day per-kingdom points ledger we don't
  // keep yet, so it is left empty here rather than risk claiming a tier advance
  // that didn't happen (no-fabrication law). The fact-builder supports it for
  // when that ledger lands; the beat still grounds on real quests + focus + streak.
  return buildBeatFacts({
    completedToday,
    plannedToday,
    lifetimeBeforeToday: {},
    pointsToday: {},
    focusMinutes: Math.round(focusToday.reduce((s, f) => s + f.focusedSeconds, 0) / 60),
    streakDays: user?.streakDays ?? 0,
    chapterBeat: await currentChapterBeat(userId),
  });
}

/** Draft today's beat from assembled facts and cache it; race-safe via the
 * unique constraint. */
async function draftAndCache(
  userId: number, localDate: string, kind: DmBeatKind, facts: DmBeatFacts,
): Promise<DmBeat> {
  const { narrative, source } = await draftBeat(
    kind, facts, userId, localDate, isAiConfigured() ? generateJson : null,
  );

  const [inserted] = await db.insert(dmBeatsTable)
    .values({ userId, localDate, kind, narrative, source, facts })
    .onConflictDoNothing()
    .returning();
  // Lost the race to a concurrent first-open — the winner's row is today's beat.
  return inserted ?? (await cachedBeat(userId, localDate, kind))!;
}

/**
 * GET the Dungeon Master's beat for today. `kind` is "morning" (the quest board)
 * or "camp" (the evening make-camp). Returns { beat: null } when the day has
 * nothing real to narrate — the DM stays quiet rather than inventing a scene.
 * Generated once per (day, kind) and cached; the model never blocks the screen.
 */
router.get("/dm/beat", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const kind = String(req.query.kind ?? "") as DmBeatKind;
  if (!BEAT_KINDS.includes(kind)) {
    res.status(400).json({ error: "kind must be 'morning' or 'camp'" });
    return;
  }

  const now = new Date();
  const timeZone = await resolveUserTimeZone(userId, req.query.tz);
  const localDate = localDateKey(now, timeZone);

  const existing = await cachedBeat(userId, localDate, kind);
  if (existing) { res.json({ beat: serialize(existing) }); return; }

  // Nothing generated yet: only draft (and spend a model call) if the day
  // actually has substance to narrate — otherwise the DM stays quiet.
  const facts = await assembleFacts(userId, timeZone, localDate);
  if (!beatHasSubstance(kind, facts)) { res.json({ beat: null }); return; }

  const drafted = await draftAndCache(userId, localDate, kind, facts);
  res.json({ beat: serialize(drafted) });
});

export default router;
