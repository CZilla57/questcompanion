// Act VI Quest Campaigns: the tier above questlines. Thin orchestration — every
// decision lives in lib/campaigns.ts, lib/campaign-arc.ts, lib/ai/campaign-arc.ts.
// Chapters are ORDERED BUT NEVER GATED: nothing here hides or blocks a quest.
import { Router, type IRouter } from "express";
import { eq, and, asc, desc, inArray, notInArray } from "drizzle-orm";
import {
  db, campaignsTable, questlinesTable, tasksTable, usersTable, activityTable,
  type Campaign,
} from "@workspace/db";
import {
  computeCampaignProgress, isCampaignReadyToClaim, computeCampaignRewardXp,
  nextChapter, renumber, canTransition, clampString, validateStringOrNull,
  validateQuestlineIds,
} from "../lib/campaigns";
import { curatedArc, MIN_CHAPTERS, MAX_CHAPTERS } from "../lib/campaign-arc";
import {
  suggestCampaignArc, CampaignArcParseError,
  MAX_TITLE_LENGTH, MAX_PREMISE_LENGTH, MAX_BEAT_LENGTH,
} from "../lib/ai/campaign-arc";
import { computeProgress } from "../lib/questlines";
import { getLevelInfo } from "../lib/gamification";
import { newlyUnlocked, type FeatureKey } from "../lib/feature-gates";
import { assignPoints } from "../lib/auto-points";
import { isAiConfigured, generateJson, AiClientError } from "../lib/ai/client";
import { suggestCooldown } from "../lib/ai/suggest-cooldown";
import { sanitizeQuestTitles } from "../lib/ai/questline-quests";
import { isUniqueViolation } from "../lib/rename";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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
    title?: unknown; arcPremise?: unknown; endingBeat?: unknown;
    storySource?: string;
    chapters?: unknown;
  };
  if (typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const cleanTitle = clampString(title, MAX_TITLE_LENGTH);

  const arcPremiseResult = validateStringOrNull(arcPremise, MAX_PREMISE_LENGTH);
  if (!arcPremiseResult.ok) { res.status(400).json({ error: "arcPremise must be a string or null" }); return; }
  const endingBeatResult = validateStringOrNull(endingBeat, MAX_BEAT_LENGTH);
  if (!endingBeatResult.ok) { res.status(400).json({ error: "endingBeat must be a string or null" }); return; }

  // Slice to MAX_CHAPTERS BEFORE mapping/sanitizing, so an oversized payload
  // never gets fully processed just to be thrown away.
  const rawChapters = (Array.isArray(chapters) ? chapters : []).slice(0, MAX_CHAPTERS);
  const cleanChapters: { title: string; beat: string | null; questTitles: string[] }[] = [];
  for (const raw of rawChapters) {
    if (typeof raw !== "object" || raw === null) {
      res.status(400).json({ error: "each chapter must be an object" });
      return;
    }
    const c = raw as { title?: unknown; beat?: unknown; questTitles?: unknown };
    if (typeof c.title !== "string") {
      res.status(400).json({ error: "chapter title must be a string" });
      return;
    }
    const chapterTitle = clampString(c.title, MAX_TITLE_LENGTH);
    if (!chapterTitle) continue; // blank after trim — same silent-skip as before

    const beatResult = validateStringOrNull(c.beat, MAX_BEAT_LENGTH);
    if (!beatResult.ok) { res.status(400).json({ error: "chapter beat must be a string or null" }); return; }

    cleanChapters.push({
      title: chapterTitle,
      beat: beatResult.value,
      questTitles: Array.isArray(c.questTitles) ? sanitizeQuestTitles(c.questTitles as string[]) : [],
    });
  }

  try {
    const created = await db.transaction(async (tx) => {
      // Only one campaign runs at a time: stand the current one down first.
      // The partial unique index is the real guard; this keeps it from firing.
      await tx.update(campaignsTable)
        .set({ status: "set_aside", setAsideAt: new Date() })
        .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));

      const [campaign] = await tx.insert(campaignsTable).values({
        userId,
        title: cleanTitle,
        arcPremise: arcPremiseResult.value,
        endingBeat: endingBeatResult.value,
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
    title?: unknown; arcPremise?: unknown; endingBeat?: unknown; status?: unknown;
  };
  if (status !== undefined && status !== "running" && status !== "set_aside") {
    res.status(400).json({ error: "status must be running or set_aside" });
    return;
  }
  const statusValue = status as "running" | "set_aside" | undefined;

  const updates: Partial<typeof campaignsTable.$inferInsert> = {};
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title cannot be empty" });
      return;
    }
    updates.title = clampString(title, MAX_TITLE_LENGTH);
  }
  if (arcPremise !== undefined) {
    const r = validateStringOrNull(arcPremise, MAX_PREMISE_LENGTH);
    if (!r.ok) { res.status(400).json({ error: "arcPremise must be a string or null" }); return; }
    updates.arcPremise = r.value;
  }
  if (endingBeat !== undefined) {
    const r = validateStringOrNull(endingBeat, MAX_BEAT_LENGTH);
    if (!r.ok) { res.status(400).json({ error: "endingBeat must be a string or null" }); return; }
    updates.endingBeat = r.value;
  }
  if (statusValue !== undefined) {
    updates.status = statusValue;
    updates.setAsideAt = statusValue === "set_aside" ? new Date() : null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  type Outcome =
    | { kind: "not_found" }
    | { kind: "conflict" }
    | { kind: "ok"; row: Campaign };

  try {
    const outcome = await db.transaction(async (tx): Promise<Outcome> => {
      // Lock and read the target FIRST — before any stand-down write — so a
      // request for a nonexistent campaign can never commit a side effect
      // (e.g. standing down the user's actually-running campaign) on its way
      // to a 404.
      const [existing] = await tx.select().from(campaignsTable)
        .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
        .for("update");
      if (!existing) return { kind: "not_found" };

      // completed is terminal: a no-op (status omitted, or echoed back
      // unchanged) is fine, but any real transition out of completed —
      // in particular reopening it to running for a re-claim — is refused.
      const targetStatus = statusValue ?? existing.status;
      if (!canTransition(existing.status, targetStatus)) return { kind: "conflict" };

      // Resuming stands down whatever else was running (one at a time).
      if (statusValue === "running") {
        await tx.update(campaignsTable)
          .set({ status: "set_aside", setAsideAt: new Date() })
          .where(and(eq(campaignsTable.userId, userId), eq(campaignsTable.status, "running")));
      }
      const [updated] = await tx.update(campaignsTable).set(updates)
        .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
        .returning();
      return { kind: "ok", row: updated! };
    });

    if (outcome.kind === "not_found") { res.status(404).json({ error: "Campaign not found" }); return; }
    if (outcome.kind === "conflict") {
      res.status(409).json({ error: "Campaign is already completed" });
      return;
    }

    const chapters = await loadChapters(id, userId);
    res.json(formatCampaign(outcome.row, computeCampaignProgress(chapters)));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Another campaign is already running" });
      return;
    }
    throw err;
  }
});

// Delete a campaign. The questlines and all their quests survive, but they
// must not keep narrating a campaign that no longer exists: the FK's
// ON DELETE SET NULL only clears campaignId, so chapterOrder and (crucially)
// chapterBeat are cleared explicitly here, BEFORE the campaign row is
// deleted — the same three columns the other two detach doors clear (the
// reorder detach above, and PATCH /questlines/:id). Without this, a freed
// questline stays campaignId == null with a stale chapterBeat: the add-a-
// chapter picker offers it, the claim celebration still renders the old
// beat, and adopting it into a NEW campaign would show the old campaign's
// story text as the new campaign's chapter beat. A completed campaign is a
// permanent chronicle entry and may never be deleted — that, together with
// the completed-chapters-never-detach rule above, means a claimed chapter can
// never be freed up to be claimed again in a different campaign.
router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  type Outcome = { kind: "not_found" } | { kind: "completed" } | { kind: "ok" };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [existing] = await tx.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
      .for("update");
    if (!existing) return { kind: "not_found" };
    if (existing.status === "completed") return { kind: "completed" };

    await tx.update(questlinesTable)
      .set({ campaignId: null, chapterOrder: null, chapterBeat: null })
      .where(and(eq(questlinesTable.campaignId, id), eq(questlinesTable.userId, userId)));

    await tx.delete(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)));
    return { kind: "ok" };
  });

  if (outcome.kind === "not_found") { res.status(404).json({ error: "Campaign not found" }); return; }
  if (outcome.kind === "completed") {
    res.status(409).json({ error: "A completed campaign is part of your chronicle" });
    return;
  }
  res.sendStatus(204);
});

// Set the full ordered chapter list. Omitted questlines are detached — one
// write per row, from one computed sequence, so nothing can disagree on order.
// One campaign per questline, EVER: a questline already claimed by a
// different campaign 409s instead of being poached, and a completed
// campaign's chapters can never be detached at all.
router.patch("/campaigns/:id/chapters", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { questlineIds } = req.body as { questlineIds?: unknown };
  const validated = validateQuestlineIds(questlineIds, MAX_CHAPTERS);
  if (!validated.ok) { res.status(400).json({ error: validated.error }); return; }

  type Outcome =
    | { kind: "not_found" }
    | { kind: "completed" }
    | { kind: "conflict" }
    | { kind: "ok"; campaign: Campaign };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [campaign] = await tx.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.userId, userId)))
      .for("update");
    if (!campaign) return { kind: "not_found" };
    if (campaign.status === "completed") return { kind: "completed" };

    // Only questlines this user actually owns may become chapters.
    const owned = validated.ids.length
      ? await tx.select({ id: questlinesTable.id, campaignId: questlinesTable.campaignId })
          .from(questlinesTable)
          .where(and(inArray(questlinesTable.id, validated.ids), eq(questlinesTable.userId, userId)))
          .orderBy(asc(questlinesTable.id))
          .for("update")
      : [];

    // A questline already spoken for by a DIFFERENT campaign may never be
    // poached by reorder — ids already on THIS campaign are the normal case.
    for (const q of owned) {
      if (q.campaignId != null && q.campaignId !== id) return { kind: "conflict" };
    }

    const ownedIds = new Set(owned.map((o) => o.id));
    const ordered = renumber(validated.ids.filter((qId) => ownedIds.has(qId)));
    const orderedIds = ordered.map((o) => o.id);

    // Detach only the chapters that are LEAVING — currently attached to this
    // campaign but absent from the new ordered list. Clearing chapterBeat
    // here is right for THEM: a questline that leaves a campaign must not
    // keep narrating it, matching the other detach door (PATCH
    // /questlines/:id). Chapters that survive the reorder are re-attached
    // below with only campaignId/chapterOrder touched, so a pure reorder (or
    // an append) never wipes the authored story text of a surviving chapter.
    // notInArray([]) compiles to `true` (drizzle special-cases the empty
    // list), so when every current chapter is leaving this still matches all
    // of them rather than silently matching none.
    await tx.update(questlinesTable)
      .set({ campaignId: null, chapterOrder: null, chapterBeat: null })
      .where(and(
        eq(questlinesTable.campaignId, id),
        eq(questlinesTable.userId, userId),
        notInArray(questlinesTable.id, orderedIds),
      ));

    for (const { id: questlineId, chapterOrder } of ordered) {
      await tx.update(questlinesTable)
        .set({ campaignId: id, chapterOrder })
        .where(and(eq(questlinesTable.id, questlineId), eq(questlinesTable.userId, userId)));
    }

    return { kind: "ok", campaign };
  });

  if (outcome.kind === "not_found") { res.status(404).json({ error: "Campaign not found" }); return; }
  if (outcome.kind === "completed") {
    res.status(409).json({ error: "A completed campaign's chapters are part of its record" });
    return;
  }
  if (outcome.kind === "conflict") {
    res.status(409).json({ error: "A questline can only belong to one campaign" });
    return;
  }

  const chapters = await loadChapters(id, userId);
  const current = nextChapter(chapters);
  res.json({
    campaign: formatCampaign(outcome.campaign, computeCampaignProgress(chapters)),
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

    // Lock the chapter rows too — without this, a concurrent PATCH
    // /questlines/:id detach can free a chapter this transaction is about to
    // pay for: it reads "completed" here, computes and commits XP, while the
    // other transaction (which only locked the campaign row, not these rows)
    // detaches the questline in between. Locking the chapters closes that gap.
    const chapters = await tx.select({ status: questlinesTable.status }).from(questlinesTable)
      .where(and(eq(questlinesTable.campaignId, id), eq(questlinesTable.userId, userId)))
      .for("update");
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
