// Act VI Quest Campaigns: the tier above questlines. Thin orchestration — every
// decision lives in lib/campaigns.ts, lib/campaign-arc.ts, lib/ai/campaign-arc.ts.
// Chapters are ORDERED BUT NEVER GATED: nothing here hides or blocks a quest.
import { Router, type IRouter } from "express";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  db, campaignsTable, questlinesTable, tasksTable, usersTable, activityTable,
  type Campaign,
} from "@workspace/db";
import {
  computeCampaignProgress, isCampaignReadyToClaim, computeCampaignRewardXp,
  nextChapter, renumber,
} from "../lib/campaigns";
import { curatedArc, MIN_CHAPTERS, MAX_CHAPTERS } from "../lib/campaign-arc";
import { suggestCampaignArc, CampaignArcParseError } from "../lib/ai/campaign-arc";
import { computeProgress } from "../lib/questlines";
import { getLevelInfo } from "../lib/gamification";
import { newlyUnlocked, type FeatureKey } from "../lib/feature-gates";
import { assignPoints } from "../lib/auto-points";
import { isAiConfigured, generateJson, AiClientError } from "../lib/ai/client";
import { suggestCooldown } from "../lib/ai/suggest-cooldown";
import { sanitizeQuestTitles } from "../lib/ai/questline-quests";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Postgres unique-violation, walked through the driver's cause chain — the
 * same technique lib/rename.ts uses. Our only unique index is the
 * one-running-campaign-per-user partial index. */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e === "object" && (e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export function formatCampaign(row: Campaign, progress: { total: number; done: number }) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    arcPremise: row.arcPremise,
    endingBeat: row.endingBeat,
    storySource: row.storySource,
    status: row.status,
    total: progress.total,
    done: progress.done,
    ready: isCampaignReadyToClaim(row, progress),
    rewardXpAwarded: row.rewardXpAwarded ?? null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(s ?? "", 10);
  return isNaN(id) ? null : id;
}

/** Chapters of one campaign, ordered, with each chapter's own quest progress. */
async function loadChapters(campaignId: number, userId: number) {
  const rows = await db.select().from(questlinesTable)
    .where(and(eq(questlinesTable.campaignId, campaignId), eq(questlinesTable.userId, userId)))
    .orderBy(asc(questlinesTable.chapterOrder), asc(questlinesTable.id));

  const ids = rows.map((r) => r.id);
  const quests = ids.length
    ? await db.select({ questlineId: tasksTable.questlineId, completed: tasksTable.completed })
        .from(tasksTable).where(inArray(tasksTable.questlineId, ids))
    : [];

  const byQuestline = new Map<number, { completed: boolean }[]>();
  for (const q of quests) {
    if (q.questlineId == null) continue;
    const arr = byQuestline.get(q.questlineId) ?? [];
    arr.push({ completed: q.completed });
    byQuestline.set(q.questlineId, arr);
  }

  return rows.map((r) => {
    const p = computeProgress(byQuestline.get(r.id) ?? []);
    return {
      questlineId: r.id,
      title: r.title,
      chapterOrder: r.chapterOrder,
      chapterBeat: r.chapterBeat,
      status: r.status,
      total: p.total,
      done: p.done,
    };
  });
}

// List campaigns with derived chapter progress. One extra query pulls all
// chapters, then progress is grouped in-memory (no N+1).
router.get("/campaigns", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const rows = await db.select().from(campaignsTable)
    .where(eq(campaignsTable.userId, userId))
    .orderBy(desc(campaignsTable.createdAt));

  const ids = rows.map((r) => r.id);
  const chapters = ids.length
    ? await db.select({ campaignId: questlinesTable.campaignId, status: questlinesTable.status })
        .from(questlinesTable).where(inArray(questlinesTable.campaignId, ids))
    : [];

  const byCampaign = new Map<number, { status: string }[]>();
  for (const c of chapters) {
    if (c.campaignId == null) continue;
    const arr = byCampaign.get(c.campaignId) ?? [];
    arr.push({ status: c.status });
    byCampaign.set(c.campaignId, arr);
  }

  res.json(rows.map((r) => formatCampaign(r, computeCampaignProgress(byCampaign.get(r.id) ?? []))));
});

// Create a campaign and (optionally) its chapter questlines + quests, atomically.
// Zero chapters is legal: that is the adopt-only path.
router.post("/campaigns", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, arcPremise, endingBeat, storySource, chapters } = req.body as {
    title?: string; arcPremise?: string | null; endingBeat?: string | null;
    storySource?: string;
    chapters?: { title?: string; beat?: string | null; questTitles?: string[] }[];
  };
  if (!title || !title.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const cleanChapters = (Array.isArray(chapters) ? chapters : [])
    .map((c) => ({
      title: typeof c.title === "string" ? c.title.trim() : "",
      beat: typeof c.beat === "string" ? c.beat : null,
      questTitles: Array.isArray(c.questTitles) ? sanitizeQuestTitles(c.questTitles) : [],
    }))
    .filter((c) => c.title.length > 0)
    .slice(0, MAX_CHAPTERS);

  try {
    const created = await db.transaction(async (tx) => {
      // Only one campaign runs at a time: stand the current one down first.
      // The partial unique index is the real guard; this keeps it from firing.
      await tx.update(campaignsTable)
        .set({ status: "set_aside", setAsideAt: new Date() })
        .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));

      const [campaign] = await tx.insert(campaignsTable).values({
        userId,
        title: title.trim(),
        arcPremise: arcPremise ?? null,
        endingBeat: endingBeat ?? null,
        storySource: storySource === "ai" ? "ai" : "curated",
      }).returning();

      for (const [i, ch] of cleanChapters.entries()) {
        const [questline] = await tx.insert(questlinesTable).values({
          userId,
          title: ch.title,
          description: null,
          color: null,
          campaignId: campaign.id,
          chapterOrder: i,
          chapterBeat: ch.beat,
        }).returning();

        if (ch.questTitles.length) {
          await tx.insert(tasksTable).values(
            ch.questTitles.map((t) => {
              const ap = assignPoints(t, "medium");
              return {
                userId, title: t, points: ap.points, category: ap.category,
                priority: "medium", dueDate: null, isAnchored: true,
                questlineId: questline.id,
              };
            }),
          );
        }
      }

      return campaign;
    });

    res.status(201).json(formatCampaign(created, { total: cleanChapters.length, done: 0 }));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Another campaign is already running" });
      return;
    }
    throw err;
  }
});

// One campaign with its ordered chapters.
router.get("/campaigns/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));
  if (!row) { res.status(404).json({ error: "Campaign not found" }); return; }

  const chapters = await loadChapters(id, userId);
  const current = nextChapter(chapters);

  res.json({
    campaign: formatCampaign(row, computeCampaignProgress(chapters)),
    chapters,
    currentChapterId: current ? current.questlineId : null,
  });
});

// Edit title/story, or move between running and set aside.
router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { title, arcPremise, endingBeat, status } = req.body as {
    title?: string; arcPremise?: string | null; endingBeat?: string | null; status?: string;
  };
  if (status != null && status !== "running" && status !== "set_aside") {
    res.status(400).json({ error: "status must be running or set_aside" });
    return;
  }

  const updates: Partial<typeof campaignsTable.$inferInsert> = {};
  if (title != null) {
    if (!title.trim()) { res.status(400).json({ error: "title cannot be empty" }); return; }
    updates.title = title.trim();
  }
  if (arcPremise !== undefined) updates.arcPremise = arcPremise;
  if (endingBeat !== undefined) updates.endingBeat = endingBeat;
  if (status != null) {
    updates.status = status;
    updates.setAsideAt = status === "set_aside" ? new Date() : null;
  }

  try {
    const row = await db.transaction(async (tx) => {
      // Resuming stands down whatever else was running (one at a time).
      if (status === "running") {
        await tx.update(campaignsTable)
          .set({ status: "set_aside", setAsideAt: new Date() })
          .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));
      }
      const [updated] = await tx.update(campaignsTable).set(updates)
        .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
        .returning();
      return updated;
    });
    if (!row) { res.status(404).json({ error: "Campaign not found" }); return; }

    const chapters = await loadChapters(id, userId);
    res.json(formatCampaign(row, computeCampaignProgress(chapters)));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Another campaign is already running" });
      return;
    }
    throw err;
  }
});

// Delete a campaign; the FK's ON DELETE SET NULL unlinks its chapters.
// The questlines and all their quests survive.
router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.delete(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Campaign not found" }); return; }

  res.sendStatus(204);
});

// Set the full ordered chapter list. Omitted questlines are detached — one
// write per row, from one computed sequence, so nothing can disagree on order.
router.patch("/campaigns/:id/chapters", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { questlineIds } = req.body as { questlineIds?: unknown };
  if (!Array.isArray(questlineIds) || questlineIds.some((q) => typeof q !== "number")) {
    res.status(400).json({ error: "questlineIds must be an array of integers" });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  // Only questlines this user actually owns may become chapters.
  const owned = questlineIds.length
    ? await db.select({ id: questlinesTable.id }).from(questlinesTable)
        .where(and(inArray(questlinesTable.id, questlineIds as number[]), eq(questlinesTable.userId, userId)))
    : [];
  const ownedIds = new Set(owned.map((o) => o.id));
  const ordered = renumber((questlineIds as number[]).filter((q) => ownedIds.has(q)));

  await db.transaction(async (tx) => {
    // Detach everything currently attached, then re-attach the new sequence.
    await tx.update(questlinesTable)
      .set({ campaignId: null, chapterOrder: null })
      .where(and(eq(questlinesTable.campaignId, id), eq(questlinesTable.userId, userId)));

    for (const { id: questlineId, chapterOrder } of ordered) {
      await tx.update(questlinesTable)
        .set({ campaignId: id, chapterOrder })
        .where(and(eq(questlinesTable.id, questlineId), eq(questlinesTable.userId, userId)));
    }
  });

  const chapters = await loadChapters(id, userId);
  const current = nextChapter(chapters);
  res.json({
    campaign: formatCampaign(campaign, computeCampaignProgress(chapters)),
    chapters,
    currentChapterId: current ? current.questlineId : null,
  });
});

// Claim the one-time reward for a campaign whose chapters are all complete.
// Same lock order as the questline claim: user row, then the campaign row.
router.post("/campaigns/:id/claim", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  type Outcome =
    | { status: "not_found" }
    | { status: "not_ready" }
    | { status: "ok"; row: Campaign; progress: { total: number; done: number }; xp: number;
        totalPoints: number; level: number; levelName: string; leveledUp: boolean;
        unlockedByAward: FeatureKey[] };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [row] = await tx.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
      .for("update");
    if (!row) return { status: "not_found" };

    const chapters = await tx.select({ status: questlinesTable.status }).from(questlinesTable)
      .where(and(eq(questlinesTable.campaignId, id), eq(questlinesTable.userId, userId)));
    const progress = computeCampaignProgress(chapters);

    if (!isCampaignReadyToClaim(row, progress)) return { status: "not_ready" };

    const xp = computeCampaignRewardXp(progress.total);
    const newTotal = user.totalPoints + xp;
    const beforeLevel = getLevelInfo(user.totalPoints).level;
    const afterLevel = getLevelInfo(newTotal);
    const unlockedByAward = newlyUnlocked(user, beforeLevel, afterLevel.level);

    await tx.update(usersTable).set({
      totalPoints: newTotal,
      weeklyPoints: user.weeklyPoints + xp,
      currentLevel: afterLevel.level,
    }).where(eq(usersTable.id, userId));

    const [updated] = await tx.update(campaignsTable).set({
      status: "completed",
      completedAt: new Date(),
      rewardXpAwarded: xp,
    }).where(eq(campaignsTable.id, id)).returning();

    await tx.insert(activityTable).values({
      userId,
      type: "campaign_complete",
      description: `Completed campaign · ${row.title}`,
      points: xp,
    });

    return {
      status: "ok", row: updated, progress, xp, totalPoints: newTotal,
      level: afterLevel.level, levelName: afterLevel.name,
      leveledUp: afterLevel.level > beforeLevel, unlockedByAward,
    };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Campaign not found" }); return; }
  if (outcome.status === "not_ready") { res.status(409).json({ error: "Campaign is not ready to claim" }); return; }

  res.status(200).json({
    campaign: formatCampaign(outcome.row, outcome.progress),
    endingBeat: outcome.row.endingBeat,
    xpAwarded: outcome.xp,
    totalPoints: outcome.totalPoints,
    currentLevel: outcome.level,
    levelName: outcome.levelName,
    leveledUp: outcome.leveledUp,
    newlyUnlocked: outcome.unlockedByAward,
  });
});

// Draft an arc for a goal. Side-effect-free, and it ALWAYS returns an arc:
// when the model is unavailable the curated fallback answers instead, so
// campaign creation can never be blocked by the AI.
router.post("/campaigns/suggest-arc", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) { res.status(400).json({ error: "goal is required" }); return; }
  if (goal.length > 200) { res.status(400).json({ error: "goal is too long" }); return; }

  const fallback = () => {
    const arc = curatedArc(MIN_CHAPTERS, goal.length);
    res.json({
      arcPremise: arc.arcPremise,
      endingBeat: arc.endingBeat,
      source: "curated",
      chapters: arc.chapterBeats.map((beat) => ({ title: "", beat })),
    });
  };

  if (!isAiConfigured() || !suggestCooldown.tryAcquire(userId)) { fallback(); return; }

  try {
    const arc = await suggestCampaignArc(goal, generateJson);
    res.json({
      arcPremise: arc.arcPremise,
      endingBeat: arc.endingBeat,
      source: "ai",
      chapters: arc.chapters,
    });
  } catch (err) {
    if (err instanceof AiClientError || err instanceof CampaignArcParseError) {
      logger.warn({ err }, "campaign arc suggestion failed — serving curated arc");
      fallback();
      return;
    }
    throw err;
  }
});

export default router;
