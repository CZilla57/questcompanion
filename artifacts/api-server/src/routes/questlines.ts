import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, questlinesTable, tasksTable, taskStepsTable, type Questline } from "@workspace/db";
import { computeProgress, isReadyToClaim } from "../lib/questlines";
import { formatTask } from "./tasks";

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

// Create a questline.
router.post("/questlines", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, description, color } = req.body as {
    title?: string; description?: string | null; color?: string | null;
  };
  if (!title || !title.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const [row] = await db.insert(questlinesTable).values({
    userId,
    title: title.trim(),
    description: description ?? null,
    color: color ?? null,
  }).returning();

  res.status(201).json(formatQuestline(row, { total: 0, done: 0 }));
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

export default router;
