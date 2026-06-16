import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, recurringTasksTable, tasksTable, habitStreaksTable } from "@workspace/db";
import { assignPoints } from "../lib/auto-points";
import { getHabitStreak, EMPTY_STREAK } from "../lib/habit-streaks";

const router: IRouter = Router();
const DEFAULT_USER_ID = 1;

function parseDays(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 0 && n <= 6);
}

async function formatRecurring(r: typeof recurringTasksTable.$inferSelect) {
  const days = parseDays(r.daysOfWeek);
  const ap = assignPoints(r.title, r.priority);
  const streak = await getHabitStreak(r.userId, r.id);
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    description: r.description,
    priority: r.priority,
    daysOfWeek: days,
    timeOfDay: r.timeOfDay,
    startDate: r.startDate,
    endDate: r.endDate,
    isActive: r.isActive,
    estimatedPoints: ap.points,
    categoryLabel: ap.categoryLabel,
    currentStreak: streak?.currentStreak ?? EMPTY_STREAK.currentStreak,
    longestStreak: streak?.longestStreak ?? EMPTY_STREAK.longestStreak,
    totalCompletions: streak?.totalCompletions ?? EMPTY_STREAK.totalCompletions,
    lastCompletedDate: streak?.lastCompletedDate ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/recurring-tasks", async (_req, res): Promise<void> => {
  const tasks = await db
    .select()
    .from(recurringTasksTable)
    .where(eq(recurringTasksTable.userId, DEFAULT_USER_ID));
  const formatted = await Promise.all(tasks.map(formatRecurring));
  res.json(formatted);
});

router.post("/recurring-tasks", async (req, res): Promise<void> => {
  const {
    title,
    description,
    priority = "medium",
    daysOfWeek,
    timeOfDay = "08:00",
    startDate,
    endDate,
  } = req.body as {
    title?: string;
    description?: string;
    priority?: string;
    daysOfWeek?: number[];
    timeOfDay?: string;
    startDate?: string;
    endDate?: string;
  };

  if (!title || !daysOfWeek?.length || !startDate) {
    res.status(400).json({ error: "title, daysOfWeek, and startDate are required" });
    return;
  }

  const [task] = await db
    .insert(recurringTasksTable)
    .values({
      userId: DEFAULT_USER_ID,
      title,
      description,
      priority,
      daysOfWeek: daysOfWeek.join(","),
      timeOfDay,
      startDate,
      endDate: endDate ?? null,
      isActive: true,
    })
    .returning();

  res.status(201).json(await formatRecurring(task));
});

router.get("/recurring-tasks/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db
    .select()
    .from(recurringTasksTable)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, DEFAULT_USER_ID)));
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  res.json(await formatRecurring(task));
});

router.patch("/recurring-tasks/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const {
    title,
    description,
    priority,
    daysOfWeek,
    timeOfDay,
    startDate,
    endDate,
    isActive,
  } = req.body as {
    title?: string;
    description?: string;
    priority?: string;
    daysOfWeek?: number[];
    timeOfDay?: string;
    startDate?: string;
    endDate?: string | null;
    isActive?: boolean;
  };

  const updates: Partial<typeof recurringTasksTable.$inferInsert> = {};
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
  if (priority != null) updates.priority = priority;
  if (daysOfWeek != null) updates.daysOfWeek = daysOfWeek.join(",");
  if (timeOfDay != null) updates.timeOfDay = timeOfDay;
  if (startDate != null) updates.startDate = startDate;
  if ("endDate" in req.body) updates.endDate = endDate ?? null;
  if (isActive != null) updates.isActive = isActive;

  const [task] = await db
    .update(recurringTasksTable)
    .set(updates)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, DEFAULT_USER_ID)))
    .returning();
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  res.json(await formatRecurring(task));
});

router.delete("/recurring-tasks/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Clean up streak record first
  await db
    .delete(habitStreaksTable)
    .where(
      and(
        eq(habitStreaksTable.userId, DEFAULT_USER_ID),
        eq(habitStreaksTable.recurringTaskId, id),
      ),
    );

  const [task] = await db
    .delete(recurringTasksTable)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, DEFAULT_USER_ID)))
    .returning();
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  res.sendStatus(204);
});

router.post("/recurring-tasks/:id/toggle", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(recurringTasksTable)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, DEFAULT_USER_ID)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [task] = await db
    .update(recurringTasksTable)
    .set({ isActive: !existing.isActive })
    .where(eq(recurringTasksTable.id, id))
    .returning();

  res.json(await formatRecurring(task));
});

/** Called by the scheduler — creates today's tasks from active recurring templates */
export async function spawnRecurringTasksForToday(): Promise<number> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const dayOfWeek = today.getDay();

  const templates = await db
    .select()
    .from(recurringTasksTable)
    .where(and(eq(recurringTasksTable.userId, DEFAULT_USER_ID), eq(recurringTasksTable.isActive, true)));

  let created = 0;
  for (const tmpl of templates) {
    const days = parseDays(tmpl.daysOfWeek);
    if (!days.includes(dayOfWeek)) continue;
    if (tmpl.startDate > todayStr) continue;
    if (tmpl.endDate && tmpl.endDate < todayStr) continue;

    // Skip if task already exists for this template today
    const existing = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.userId, DEFAULT_USER_ID),
          eq(tasksTable.dueDate, todayStr),
          eq(tasksTable.recurringTaskId, tmpl.id),
        ),
      );
    if (existing.length > 0) continue;

    const ap = assignPoints(tmpl.title, tmpl.priority);
    await db.insert(tasksTable).values({
      userId: DEFAULT_USER_ID,
      recurringTaskId: tmpl.id,
      title: tmpl.title,
      description: tmpl.description,
      points: ap.points,
      dueDate: todayStr,
      priority: tmpl.priority,
    });
    created++;
  }

  return created;
}

export default router;
