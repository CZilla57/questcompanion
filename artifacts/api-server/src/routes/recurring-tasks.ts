import { Router, type IRouter } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db, recurringTasksTable, tasksTable, habitStreaksTable, usersTable } from "@workspace/db";
import { assignPoints, CATEGORY_LABELS, VALID_CATEGORIES } from "../lib/auto-points";
import { getHabitStreak, EMPTY_STREAK } from "../lib/habit-streaks";
import { occurrencesInWindow, describeRule } from "../lib/recurrence";
import { spawnWindow, ruleFromTemplate, parseDays } from "../lib/spawn-window";
import { validateRecurrenceInput, streakUnitFor, mergeRecurrenceUpdate } from "../lib/recurrence-validation";
import { resolveTimeZone, localDateKey } from "../lib/date-buckets";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * An edited or paused template must not leave orphaned future quests that no
 * longer match its rule: editing a monthly template from the 15th to the
 * 20th mid-window would otherwise leave the already-spawned 15th AND spawn
 * the 20th (two quests, one occurrence), and pausing a template would leave
 * its future quests sitting in the log even though "Paused" is supposed to
 * mean nothing more comes from it. The next scheduler tick re-spawns from
 * whatever rule is now live, so no re-spawn logic is needed here.
 *
 * Only strictly future, still-incomplete quests are removed: completed
 * quests are history (deleting them would silently rewrite the user's
 * record and their streaks), and today's/past quests are left alone.
 */
async function deleteFutureIncompleteSpawns(recurringTaskId: number, userId: number): Promise<void> {
  const [owner] = await db
    .select({ timezone: usersTable.timezone })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const tz = resolveTimeZone(owner?.timezone ?? null);
  const today = localDateKey(new Date(), tz);

  await db
    .delete(tasksTable)
    .where(and(
      // Ownership is already verified by the callers, which scope their
      // template lookup to this user — but this is a DELETE, so it carries
      // its own guard rather than trusting the caller to keep doing that.
      eq(tasksTable.userId, userId),
      eq(tasksTable.recurringTaskId, recurringTaskId),
      eq(tasksTable.completed, false),
      gt(tasksTable.dueDate, today),
    ));
}

/** Schedule-bearing columns: a change to any of these invalidates already-spawned
 *  future quests. Everything else (title, description, priority, category,
 *  timeOfDay) is cosmetic and must leave spawned quests untouched. */
const SCHEDULE_FIELDS = [
  "frequency",
  "monthlyMode",
  "dayOfMonth",
  "weekOfMonth",
  "monthOfYear",
  "startDate",
  "endDate",
  "leadDays",
  "isActive",
] as const satisfies readonly (keyof typeof recurringTasksTable.$inferInsert)[];

/**
 * True only when a PATCH actually changes the template's schedule — not merely
 * when a schedule field is present in the request body. The official client
 * PATCHes the whole recurrence payload on every edit (including a title-only
 * edit), so a presence check would fire every time and be equivalent to the
 * unconditional delete this replaces. Comparing VALUES is what lets a cosmetic
 * edit leave already-spawned, still-workable quests (and the task_steps,
 * focus_sessions, questline assignment, etc. attached to them) alone.
 *
 * `daysOfWeek` is stored as CSV and submitted as a number array, so it can't be
 * compared with `===`; both sides are normalised through `parseDays` (and
 * order-independently, since only the set of active weekdays is meaningful)
 * before comparing.
 */
function scheduleChanged(
  existing: typeof recurringTasksTable.$inferSelect,
  updates: Partial<typeof recurringTasksTable.$inferInsert>,
): boolean {
  for (const field of SCHEDULE_FIELDS) {
    if (field in updates && updates[field] !== existing[field]) return true;
  }

  if ("daysOfWeek" in updates) {
    const before = parseDays(existing.daysOfWeek).slice().sort((a, b) => a - b);
    const after = parseDays(updates.daysOfWeek as string).slice().sort((a, b) => a - b);
    if (before.length !== after.length || before.some((d, i) => d !== after[i])) return true;
  }

  return false;
}

async function formatRecurring(r: typeof recurringTasksTable.$inferSelect) {
  const days = parseDays(r.daysOfWeek);
  const ap = assignPoints(r.title, r.priority);
  const streak = await getHabitStreak(r.userId, r.id);
  const rule = ruleFromTemplate(r);
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    description: r.description,
    priority: r.priority,
    category: r.category,
    categoryLabel: CATEGORY_LABELS[r.category] ?? CATEGORY_LABELS.default,
    daysOfWeek: days,
    timeOfDay: r.timeOfDay,
    startDate: r.startDate,
    endDate: r.endDate,
    isActive: r.isActive,
    frequency: rule.frequency,
    monthlyMode: r.monthlyMode,
    dayOfMonth: r.dayOfMonth,
    weekOfMonth: r.weekOfMonth,
    monthOfYear: r.monthOfYear,
    leadDays: r.leadDays,
    // Server owns the phrasing so client and server can't describe the same
    // rule differently.
    scheduleLabel: describeRule(rule),
    streakUnit: streakUnitFor(rule.frequency),
    estimatedPoints: ap.points,
    currentStreak: streak?.currentStreak ?? EMPTY_STREAK.currentStreak,
    longestStreak: streak?.longestStreak ?? EMPTY_STREAK.longestStreak,
    totalCompletions: streak?.totalCompletions ?? EMPTY_STREAK.totalCompletions,
    lastCompletedDate: streak?.lastCompletedDate ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/recurring-tasks", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const tasks = await db
    .select()
    .from(recurringTasksTable)
    .where(eq(recurringTasksTable.userId, userId));
  const formatted = await Promise.all(tasks.map(formatRecurring));
  res.json(formatted);
});

router.post("/recurring-tasks", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const {
    title,
    description,
    priority = "medium",
    daysOfWeek,
    timeOfDay = "08:00",
    startDate,
    endDate,
    category,
    frequency = "weekly",
    monthlyMode,
    dayOfMonth,
    weekOfMonth,
    monthOfYear,
    leadDays = 0,
  } = req.body as {
    title?: string;
    description?: string;
    priority?: string;
    daysOfWeek?: number[];
    timeOfDay?: string;
    startDate?: string;
    endDate?: string;
    category?: string;
    frequency?: string;
    monthlyMode?: string;
    dayOfMonth?: number;
    weekOfMonth?: number;
    monthOfYear?: number;
    leadDays?: number;
  };

  if (!title || !startDate) {
    res.status(400).json({ error: "title and startDate are required" });
    return;
  }

  const ruleError = validateRecurrenceInput({
    frequency, daysOfWeek, monthlyMode, dayOfMonth, weekOfMonth, monthOfYear, leadDays,
  });
  if (ruleError) { res.status(400).json({ error: ruleError }); return; }

  const autoPoint = assignPoints(title, priority);
  const resolvedCategory = category && VALID_CATEGORIES.has(category) ? category : autoPoint.category;

  const [task] = await db
    .insert(recurringTasksTable)
    .values({
      userId,
      title,
      description,
      priority,
      category: resolvedCategory,
      daysOfWeek: (daysOfWeek ?? []).join(","),
      timeOfDay,
      startDate,
      endDate: endDate ?? null,
      isActive: true,
      // Destructuring defaults only fire on `undefined` — an explicit
      // `null` in the body (e.g. `"frequency": null`) sails past them and
      // would otherwise hit the NOT NULL columns as a 500. Coerce here too.
      frequency: frequency ?? "weekly",
      monthlyMode: monthlyMode ?? null,
      dayOfMonth: dayOfMonth ?? null,
      weekOfMonth: weekOfMonth ?? null,
      monthOfYear: monthOfYear ?? null,
      leadDays: leadDays ?? 0,
    })
    .returning();

  res.status(201).json(await formatRecurring(task));
});

router.get("/recurring-tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db
    .select()
    .from(recurringTasksTable)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, userId)));
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  res.json(await formatRecurring(task));
});

router.patch("/recurring-tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

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
    category,
    frequency,
    monthlyMode,
    dayOfMonth,
    weekOfMonth,
    monthOfYear,
    leadDays,
  } = req.body as {
    title?: string;
    description?: string;
    priority?: string;
    daysOfWeek?: number[];
    timeOfDay?: string;
    startDate?: string;
    endDate?: string | null;
    isActive?: boolean;
    category?: string;
    frequency?: string;
    monthlyMode?: string;
    dayOfMonth?: number;
    weekOfMonth?: number;
    monthOfYear?: number;
    leadDays?: number;
  };

  const [existing] = await db
    .select()
    .from(recurringTasksTable)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  // The state we validate must be exactly the state we write: mergeRecurrenceUpdate
  // uses PRESENCE semantics (a key in the body wins even as `null`), matching the
  // `updates` block below field-for-field so a PATCH can't validate one rule and
  // store a different one.
  const merged = mergeRecurrenceUpdate(
    {
      frequency: existing.frequency,
      daysOfWeek: parseDays(existing.daysOfWeek),
      monthlyMode: existing.monthlyMode,
      dayOfMonth: existing.dayOfMonth,
      weekOfMonth: existing.weekOfMonth,
      monthOfYear: existing.monthOfYear,
      leadDays: existing.leadDays,
    },
    req.body as Record<string, unknown>,
  );
  const ruleError = validateRecurrenceInput(merged);
  if (ruleError) { res.status(400).json({ error: ruleError }); return; }

  const updates: Partial<typeof recurringTasksTable.$inferInsert> = {};
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
  if (priority != null) updates.priority = priority;
  if (daysOfWeek != null) updates.daysOfWeek = daysOfWeek.join(",");
  if (timeOfDay != null) updates.timeOfDay = timeOfDay;
  if (startDate != null) updates.startDate = startDate;
  if ("endDate" in req.body) updates.endDate = endDate ?? null;
  if (isActive != null) updates.isActive = isActive;
  if (category != null && VALID_CATEGORIES.has(category)) updates.category = category;
  if (frequency != null) updates.frequency = frequency;
  if ("monthlyMode" in req.body) updates.monthlyMode = monthlyMode ?? null;
  if ("dayOfMonth" in req.body) updates.dayOfMonth = dayOfMonth ?? null;
  if ("weekOfMonth" in req.body) updates.weekOfMonth = weekOfMonth ?? null;
  if ("monthOfYear" in req.body) updates.monthOfYear = monthOfYear ?? null;
  if (leadDays != null) updates.leadDays = leadDays;

  // Decide before writing: `updates` is exactly what's about to change, and
  // `existing` is exactly what's about to be overwritten — the only point
  // where "before" and "after" are both cheaply in hand.
  const shouldClearSpawns = scheduleChanged(existing, updates);

  const [task] = await db
    .update(recurringTasksTable)
    .set(updates)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, userId)))
    .returning();
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  // The edited rule no longer matches whatever future quests were spawned
  // under the old one — clear them so the next tick spawns fresh from the
  // new rule instead of leaving a stale, mismatched quest behind. A purely
  // cosmetic edit (title, description, priority, category, timeOfDay) must
  // NOT reach here — see scheduleChanged for why.
  if (shouldClearSpawns) {
    await deleteFutureIncompleteSpawns(id, userId);
  }

  res.json(await formatRecurring(task));
});

router.delete("/recurring-tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db
    .delete(habitStreaksTable)
    .where(
      and(
        eq(habitStreaksTable.userId, userId),
        eq(habitStreaksTable.recurringTaskId, id),
      ),
    );

  const [task] = await db
    .delete(recurringTasksTable)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, userId)))
    .returning();
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  res.sendStatus(204);
});

router.post("/recurring-tasks/:id/toggle", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select()
    .from(recurringTasksTable)
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [task] = await db
    .update(recurringTasksTable)
    .set({ isActive: !existing.isActive })
    .where(and(eq(recurringTasksTable.id, id), eq(recurringTasksTable.userId, userId)))
    .returning();
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  // Toggling to INACTIVE ("Paused") must mean nothing more comes from this
  // template — including quests it already spawned into the future. Toggling
  // back on is not a resurrection: the next tick spawns fresh from the rule.
  if (existing.isActive && !task.isActive) {
    await deleteFutureIncompleteSpawns(id, userId);
  }

  res.json(await formatRecurring(task));
});

/**
 * Called by the scheduler — creates upcoming quests from active recurring
 * templates for all users.
 *
 * Each template is evaluated over `[today, today + leadDays]` **in its owner's
 * timezone**, and every occurrence in that window is inserted carrying the true
 * occurrence date as its due date. A quest can therefore appear days early
 * without pretending to be due early: nudges key off `due_date <= today`, so an
 * early quest waits quietly until its day.
 *
 * Weekly templates have leadDays 0, collapsing the window to a single day —
 * the pre-cadence behavior, now in the user's own calendar.
 *
 * The unique constraint on (user_id, recurring_task_id, due_date) is the
 * authoritative guard against duplicates across concurrent scheduler instances.
 * onConflictDoNothing turns a constraint violation into a silent no-op, which
 * is also what makes re-evaluating the same window every minute free.
 *
 * The whole function is a no-throw boundary: tick() runs this pass first and
 * unguarded, and a throw out of here — whether from the initial template
 * query or from one template's own processing below — would otherwise skip
 * the body-double sweep, notifications, weekly recaps, and the heartbeat for
 * every user, every minute. Both the outer query and the per-template loop
 * body are caught and logged rather than allowed to propagate.
 */
export async function spawnRecurringTasksForToday(): Promise<number> {
  const now = new Date();

  let rows: { tmpl: typeof recurringTasksTable.$inferSelect; timezone: string | null }[];
  try {
    rows = await db
      .select({ tmpl: recurringTasksTable, timezone: usersTable.timezone })
      .from(recurringTasksTable)
      .innerJoin(usersTable, eq(recurringTasksTable.userId, usersTable.id))
      .where(eq(recurringTasksTable.isActive, true));
  } catch (err) {
    logger.error({ err }, "Failed to load recurring task templates for spawn");
    return 0;
  }

  let created = 0;
  for (const { tmpl, timezone } of rows) {
    // Per-template, not per-tick: this loop now does an innerJoin, spans up
    // to a 61-day window, and can issue up to 61 sequential inserts for one
    // template. tick() runs this pass first and unguarded — a throw here
    // would otherwise skip the body-double sweep, notifications, weekly
    // recaps, and the heartbeat for every user, every minute. One bad
    // template must not cost every other user their day's quests.
    try {
      const { from, to } = spawnWindow(now, timezone, tmpl.leadDays);
      const dates = occurrencesInWindow(ruleFromTemplate(tmpl), from, to);
      if (dates.length === 0) continue;

      const ap = assignPoints(tmpl.title, tmpl.priority);
      for (const dueDate of dates) {
        const [inserted] = await db.insert(tasksTable).values({
          userId: tmpl.userId,
          recurringTaskId: tmpl.id,
          title: tmpl.title,
          description: tmpl.description,
          points: ap.points,
          dueDate,
          priority: tmpl.priority,
          category: tmpl.category,
        }).onConflictDoNothing().returning({ id: tasksTable.id });
        if (inserted) created++;
      }
    } catch (err) {
      logger.error({ err, templateId: tmpl.id, userId: tmpl.userId }, "Spawn failed for template");
    }
  }

  return created;
}

export default router;
