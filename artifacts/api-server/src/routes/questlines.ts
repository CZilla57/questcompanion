import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, questlinesTable, tasksTable, taskStepsTable, usersTable, activityTable, type Questline } from "@workspace/db";
import { computeProgress, isReadyToClaim, computeRewardXp } from "../lib/questlines";
import { getLevelInfo } from "../lib/gamification";
import { formatTask } from "./tasks";
import { assignPoints } from "../lib/auto-points";
import { isAiConfigured, generateJson, AiClientError } from "../lib/ai/client";
import { suggestQuestlineQuests, sanitizeQuestTitles, QuestlineQuestsParseError } from "../lib/ai/questline-quests";
import { suggestCooldown } from "../lib/ai/suggest-cooldown";
import { logger } from "../lib/logger";

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

// Update title/description/color.
router.patch("/questlines/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { title, description, color } = req.body as {
    title?: string; description?: string | null; color?: string | null;
  };
  const updates: Partial<typeof questlinesTable.$inferInsert> = {};
  if (title != null) {
    if (!title.trim()) { res.status(400).json({ error: "title cannot be empty" }); return; }
    updates.title = title.trim();
  }
  if (description !== undefined) updates.description = description;
  if (color !== undefined) updates.color = color;

  const [row] = await db.update(questlinesTable).set(updates)
    .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Questline not found" }); return; }

  const members = await db.select({ completed: tasksTable.completed }).from(tasksTable)
    .where(and(eq(tasksTable.questlineId, id), eq(tasksTable.userId, userId)));
  res.json(formatQuestline(row, computeProgress(members)));
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
    | { status: "ok"; row: Questline; progress: { total: number; done: number }; xp: number; totalPoints: number; level: number; levelName: string; leveledUp: boolean };

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

    await tx.update(usersTable).set({
      totalPoints: newTotal,
      weeklyPoints: user.weeklyPoints + xp,
      currentLevel: afterLevel.level,
    }).where(eq(usersTable.id, userId));

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
