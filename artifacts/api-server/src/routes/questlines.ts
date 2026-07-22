import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, questlinesTable, tasksTable, taskStepsTable, usersTable, activityTable, campaignsTable, type Questline } from "@workspace/db";
import { computeProgress, isReadyToClaim, computeRewardXp } from "../lib/questlines";
import {
  decideAttachToCampaign, canDetachFromCampaign, validateChapterOrder,
  detachConflictsWithChapterOrder, validateTitle, validateOptionalString,
} from "../lib/campaigns";
import { getLevelInfo } from "../lib/gamification";
import { newlyUnlocked, type FeatureKey } from "../lib/feature-gates";
import { formatTask } from "./tasks";
import { assignPoints } from "../lib/auto-points";
import { isAiConfigured, generateJson, AiClientError } from "../lib/ai/client";
import { suggestQuestlineQuests, sanitizeQuestTitles, QuestlineQuestsParseError } from "../lib/ai/questline-quests";
import { suggestCooldown } from "../lib/ai/suggest-cooldown";
import { logger } from "../lib/logger";
import { awardCoins } from "../lib/award-coins";
import { COIN_EARN } from "../lib/coins";

const router: IRouter = Router();

/** Serialize a questline row plus its derived progress for the client. */
export function formatQuestline(row: Questline, progress: { total: number; done: number }) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    description: row.description,
    color: row.color,
    status: row.status,
    total: progress.total,
    done: progress.done,
    ready: isReadyToClaim(row, progress),
    rewardXpAwarded: row.rewardXpAwarded ?? null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    campaignId: row.campaignId ?? null,
    chapterOrder: row.chapterOrder ?? null,
    chapterBeat: row.chapterBeat ?? null,
  };
}

function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(s ?? "", 10);
  return isNaN(id) ? null : id;
}

// List questlines with derived progress. One extra query pulls all member quests,
// then progress is grouped in-memory (no N+1).
router.get("/questlines", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = statusFilter === "active" || statusFilter === "completed"
    ? and(eq(questlinesTable.userId, userId), eq(questlinesTable.status, statusFilter))
    : eq(questlinesTable.userId, userId);

  const rows = await db.select().from(questlinesTable)
    .where(where)
    .orderBy(desc(questlinesTable.createdAt));

  const ids = rows.map((r) => r.id);
  const members = ids.length
    ? await db.select({ questlineId: tasksTable.questlineId, completed: tasksTable.completed })
        .from(tasksTable)
        .where(inArray(tasksTable.questlineId, ids))
    : [];

  const byQuestline = new Map<number, { completed: boolean }[]>();
  for (const m of members) {
    if (m.questlineId == null) continue;
    const arr = byQuestline.get(m.questlineId) ?? [];
    arr.push({ completed: m.completed });
    byQuestline.set(m.questlineId, arr);
  }

  res.json(rows.map((r) => formatQuestline(r, computeProgress(byQuestline.get(r.id) ?? []))));
});

// Create a questline. Optionally seeds it with anchored quests (questTitles),
// created atomically in one transaction.
router.post("/questlines", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, description, color, questTitles } = req.body as {
    title?: string; description?: string | null; color?: string | null; questTitles?: string[];
  };
  if (!title || !title.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const values = {
    userId,
    title: title.trim(),
    description: description ?? null,
    color: color ?? null,
  };

  const titles = Array.isArray(questTitles) ? sanitizeQuestTitles(questTitles) : [];
  if (titles.length === 0) {
    const [row] = await db.insert(questlinesTable).values(values).returning();
    res.status(201).json(formatQuestline(row, { total: 0, done: 0 }));
    return;
  }

  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(questlinesTable).values(values).returning();
    await tx.insert(tasksTable).values(
      titles.map((t) => {
        const ap = assignPoints(t, "medium");
        return {
          userId,
          title: t,
          points: ap.points,
          category: ap.category,
          priority: "medium",
          dueDate: null,
          isAnchored: true,
          questlineId: created.id,
        };
      }),
    );
    return created;
  });

  res.status(201).json(formatQuestline(row, { total: titles.length, done: 0 }));
});

// One questline with its quests (focus view).
router.get("/questlines/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select().from(questlinesTable)
    .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)));
  if (!row) { res.status(404).json({ error: "Questline not found" }); return; }

  const quests = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.questlineId, id), eq(tasksTable.userId, userId)))
    .orderBy(desc(tasksTable.createdAt));

  const questIds = quests.map((q) => q.id);
  const steps = questIds.length
    ? await db.select().from(taskStepsTable)
        .where(inArray(taskStepsTable.taskId, questIds))
        .orderBy(taskStepsTable.position)
    : [];
  const stepsByTask = new Map<number, (typeof taskStepsTable.$inferSelect)[]>();
  for (const s of steps) {
    const arr = stepsByTask.get(s.taskId) ?? [];
    arr.push(s);
    stepsByTask.set(s.taskId, arr);
  }

  const progress = computeProgress(quests.map((q) => ({ completed: q.completed })));
  res.json({
    questline: formatQuestline(row, progress),
    quests: quests.map((q) => formatTask(q, stepsByTask.get(q.id) ?? [])),
  });
});

// Update title/description/color, or attach/detach as a campaign chapter.
// PATCH /campaigns/:id/chapters is the primary door into campaign membership;
// this route is a SECOND door onto the same state, so it enforces the same
// one-campaign-per-questline-EVER rule: attaching is refused (409) when the
// questline already belongs to a different campaign OR when the target
// campaign is itself completed, and detaching is refused (409) when its
// current campaign is completed — those chapters are part of a claimed
// record and can never be freed up to be claimed again.
router.patch("/questlines/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { title, description, color, campaignId, chapterOrder } = req.body as {
    title?: unknown; description?: unknown; color?: unknown;
    campaignId?: number | null; chapterOrder?: unknown;
  };

  const updates: Partial<typeof questlinesTable.$inferInsert> = {};
  if (title != null) {
    const r = validateTitle(title);
    if (!r.ok) { res.status(400).json({ error: "title cannot be empty" }); return; }
    updates.title = r.value;
  }
  if (description !== undefined) {
    const r = validateOptionalString(description);
    if (!r.ok) { res.status(400).json({ error: "description must be a string or null" }); return; }
    updates.description = r.value;
  }
  if (color !== undefined) {
    const r = validateOptionalString(color);
    if (!r.ok) { res.status(400).json({ error: "color must be a string or null" }); return; }
    updates.color = r.value;
  }

  // A detach (campaignId: null) paired with an explicit chapterOrder is
  // contradictory — rejected outright rather than letting one silently win.
  if (detachConflictsWithChapterOrder(campaignId, chapterOrder as number | null | undefined)) {
    res.status(400).json({ error: "Cannot set chapterOrder while detaching from a campaign" });
    return;
  }

  let validatedChapterOrder: number | null | undefined;
  if (chapterOrder !== undefined) {
    const r = validateChapterOrder(chapterOrder);
    if (!r.ok) { res.status(400).json({ error: "chapterOrder must be a non-negative integer or null" }); return; }
    validatedChapterOrder = r.value;
  }

  if (Object.keys(updates).length === 0 && campaignId === undefined && chapterOrder === undefined) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  type Outcome =
    | { kind: "not_found" }
    | { kind: "campaign_not_found" }
    | { kind: "conflict"; error: string }
    | { kind: "ok"; row: Questline };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Peek the questline UNLOCKED first, filtered by ownership, so a request
    // for a nonexistent/foreign questline never touches campaignsTable at
    // all (no lock, no read) on its way to a 404. This also tells us which
    // campaign (if any) needs to be locked BEFORE the questline row itself.
    const [peek] = await tx.select({ id: questlinesTable.id, campaignId: questlinesTable.campaignId })
      .from(questlinesTable)
      .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)));
    if (!peek) return { kind: "not_found" };

    // Lock order: campaign row THEN questline row — outer-to-inner, matching
    // POST /campaigns/:id/claim and PATCH /campaigns/:id/chapters (both lock
    // the campaign before any questline row). Locking in the same order on
    // every door prevents a deadlock between them; locking the campaign row
    // at all (rather than only reading its status) is what closes the
    // original race, where this route read "running" and committed a detach
    // while a claim elsewhere was mid-flight on the same campaign.
    let lockedCampaign: { id: number; status: string } | null = null;
    if (campaignId !== undefined) {
      // Attaching locks the TARGET campaign; detaching locks the questline's
      // CURRENT campaign (from the peek). A bare field edit with no
      // campaignId in the payload touches no campaign row at all.
      const campaignToLock = campaignId != null ? campaignId : peek.campaignId;
      if (campaignToLock != null) {
        const [c] = await tx.select({ id: campaignsTable.id, status: campaignsTable.status })
          .from(campaignsTable)
          .where(and(eq(campaignsTable.id, campaignToLock), eq(campaignsTable.userId, userId)))
          .for("update");
        if (campaignId != null && !c) return { kind: "campaign_not_found" };
        lockedCampaign = c ?? null;
      }
    }

    // NOW lock the questline row, and re-read its campaignId to confirm it
    // is still what the peek saw. If it changed in between (another request
    // attached/detached it while we were locking the campaign above), the
    // campaign row we just locked may no longer be the right one — treat
    // that race as a conflict rather than acting on stale information.
    const [existing] = await tx.select().from(questlinesTable)
      .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)))
      .for("update");
    if (!existing) return { kind: "not_found" };
    if (existing.campaignId !== peek.campaignId) {
      return { kind: "conflict", error: "Questline was changed concurrently — try again" };
    }

    // Campaign membership (Act VI). Attaching an ALREADY-COMPLETED questline is
    // deliberately allowed: if the work is done, the chapter counts. Attaching
    // INTO an already-completed campaign is a different question and is
    // refused below — that campaign's chapters are a claimed record.
    if (campaignId !== undefined) {
      if (campaignId != null) {
        if (!lockedCampaign) return { kind: "campaign_not_found" };

        const decision = decideAttachToCampaign(existing.campaignId, campaignId, lockedCampaign.status);
        if (!decision.ok) {
          const error = decision.reason === "completed_campaign"
            ? "A completed campaign's chapters are part of its record"
            : "A questline can only belong to one campaign";
          return { kind: "conflict", error };
        }
        updates.campaignId = campaignId;
      } else {
        // Detaching clears the chapter's position too — a stray order on an
        // unattached questline would sort wrong if it were ever re-adopted.
        // A missing campaign row fails CLOSED (conflict), not open — the FK
        // makes this unreachable today, but a load-bearing invariant should
        // never default to "permit" when its input is absent.
        if (existing.campaignId != null) {
          if (!lockedCampaign || !canDetachFromCampaign(lockedCampaign.status)) {
            return { kind: "conflict", error: "A completed campaign's chapters are part of its record" };
          }
        }
        updates.campaignId = null;
        updates.chapterOrder = null;
        updates.chapterBeat = null;
      }
    }
    // Safe from the detach-clear above: the early 400 guard already rejected
    // campaignId === null combined with an explicit chapterOrder, so this
    // only ever runs alongside an attach or a bare chapterOrder-only edit.
    if (chapterOrder !== undefined) updates.chapterOrder = validatedChapterOrder;

    const [updated] = await tx.update(questlinesTable).set(updates)
      .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)))
      .returning();
    return { kind: "ok", row: updated! };
  });

  if (outcome.kind === "not_found") { res.status(404).json({ error: "Questline not found" }); return; }
  if (outcome.kind === "campaign_not_found") { res.status(404).json({ error: "Campaign not found" }); return; }
  if (outcome.kind === "conflict") { res.status(409).json({ error: outcome.error }); return; }

  const members = await db.select({ completed: tasksTable.completed }).from(tasksTable)
    .where(and(eq(tasksTable.questlineId, id), eq(tasksTable.userId, userId)));
  res.json(formatQuestline(outcome.row, computeProgress(members)));
});

// Delete a questline; the FK's ON DELETE SET NULL unlinks its quests.
router.delete("/questlines/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.delete(questlinesTable)
    .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Questline not found" }); return; }

  res.sendStatus(204);
});

// Claim the one-time XP reward for a fully-completed questline.
router.post("/questlines/:id/claim", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  type Outcome =
    | { status: "not_found" }
    | { status: "not_ready" }
    | { status: "ok"; row: Questline; progress: { total: number; done: number }; xp: number; totalPoints: number; level: number; levelName: string; leveledUp: boolean; unlockedByAward: FeatureKey[] };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row so concurrent claims can't double-award or read stale totals.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [row] = await tx.select().from(questlinesTable)
      .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)))
      .for("update");
    if (!row) return { status: "not_found" };

    const members = await tx.select({ completed: tasksTable.completed }).from(tasksTable)
      .where(and(eq(tasksTable.questlineId, id), eq(tasksTable.userId, userId)));
    const progress = computeProgress(members);

    if (!isReadyToClaim(row, progress)) return { status: "not_ready" };

    const xp = computeRewardXp(progress.total);
    const newTotal = user.totalPoints + xp;
    const beforeLevel = getLevelInfo(user.totalPoints).level;
    const afterLevel = getLevelInfo(newTotal);
    const unlockedByAward = newlyUnlocked(user, beforeLevel, afterLevel.level);

    await tx.update(usersTable).set({
      totalPoints: newTotal,
      weeklyPoints: user.weeklyPoints + xp,
      currentLevel: afterLevel.level,
    }).where(eq(usersTable.id, userId));

    await awardCoins(tx, userId, COIN_EARN.questlineComplete, "questline_complete");

    const [updated] = await tx.update(questlinesTable).set({
      status: "completed",
      completedAt: new Date(),
      rewardXpAwarded: xp,
    }).where(eq(questlinesTable.id, id)).returning();

    await tx.insert(activityTable).values({
      userId,
      type: "questline_complete",
      description: `Completed questline · ${row.title}`,
      points: xp,
    });

    return {
      status: "ok",
      row: updated,
      progress,
      xp,
      totalPoints: newTotal,
      level: afterLevel.level,
      levelName: afterLevel.name,
      leveledUp: afterLevel.level > beforeLevel,
      unlockedByAward,
    };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Questline not found" }); return; }
  if (outcome.status === "not_ready") { res.status(409).json({ error: "Questline is not ready to claim" }); return; }

  res.status(200).json({
    questline: formatQuestline(outcome.row, outcome.progress),
    xpAwarded: outcome.xp,
    totalPoints: outcome.totalPoints,
    currentLevel: outcome.level,
    levelName: outcome.levelName,
    leveledUp: outcome.leveledUp,
    newlyUnlocked: outcome.unlockedByAward,
  });
});

// Suggest quest titles for a goal (AI). Side-effect-free — creates nothing.
router.post("/questlines/suggest-quests", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) { res.status(400).json({ error: "goal is required" }); return; }
  if (goal.length > 200) { res.status(400).json({ error: "goal is too long" }); return; }

  if (!isAiConfigured()) { res.status(503).json({ error: "AI drafting is not configured" }); return; }
  if (!suggestCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Give it a moment before drafting again." });
    return;
  }

  let quests: string[];
  try {
    quests = await suggestQuestlineQuests(goal, generateJson);
  } catch (err) {
    if (err instanceof AiClientError || err instanceof QuestlineQuestsParseError) {
      logger.warn({ err }, "questline quest suggestion failed");
      res.status(502).json({ error: "Couldn't draft quests — add them manually." });
      return;
    }
    throw err;
  }

  res.json({ quests });
});

export default router;
