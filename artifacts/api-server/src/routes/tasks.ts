import { Router, type IRouter } from "express";
import { eq, and, or, desc, count, inArray } from "drizzle-orm";
import { applyMultiplier } from "../lib/xp-multiplier";
import { db, usersTable, tasksTable, badgesTable, userBadgesTable, activityTable, userGearTable, taskStepsTable } from "@workspace/db";
import { getLevelInfo, getPointsToNextLevel, DAILY_BONUS_POINTS } from "../lib/gamification";
import { assignPoints, CATEGORY_LABELS, VALID_CATEGORIES, MORNING_FOCUS_CATEGORIES, EVENING_WINDDOWN_CATEGORIES } from "../lib/auto-points";
import { advanceHabitStreak, reverseHabitStreak, type HabitStreakPreviousState } from "../lib/habit-streaks";
import { awardStreakGear, getStreakGearRarity, type GearRewardInfo } from "../lib/gear-rewards";
import { rollSurpriseReward, type SurpriseRewardResult } from "../lib/surprise-rewards";
import { logger } from "../lib/logger";
import { breakdownTask, BreakdownParseError } from "../lib/ai/task-breakdown";
import { generateJson, isAiConfigured, AiClientError } from "../lib/ai/client";
import { breakdownCooldown } from "../lib/ai/breakdown-cooldown";
import { isValidDueTime, isValidDueDate } from "../lib/task-datetime";
import { parseQuickAdd } from "@workspace/quick-add";
import { buildQuickAddPrompt, parseQuickAddResult, QuickAddParseError } from "../lib/ai/quick-add-parse";
import { parseCooldown } from "../lib/ai/parse-cooldown";

const router: IRouter = Router();

const FOCUS_BONUS_POINTS = 10;

// node-postgres reports a unique-constraint violation as SQLSTATE 23505.
// drizzle-orm may wrap the driver error, so inspect the error and its `cause`.
function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && name === constraint;
}

function formatTask(
  task: typeof tasksTable.$inferSelect,
  steps: (typeof taskStepsTable.$inferSelect)[] = [],
) {
  return {
    id: task.id,
    userId: task.userId,
    title: task.title,
    description: task.description,
    points: task.points,
    completed: task.completed,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    dueDate: task.dueDate,
    dueTime: task.dueTime ?? null,
    priority: task.priority,
    category: task.category,
    categoryLabel: CATEGORY_LABELS[task.category] ?? CATEGORY_LABELS.default,
    createdAt: task.createdAt.toISOString(),
    estimatedMinutes: task.estimatedMinutes ?? null,
    actualMinutes: task.actualMinutes ?? null,
    isDailyFocus: task.isDailyFocus,
    focusDate: task.focusDate ?? null,
    isAnchored: task.isAnchored,
    steps: steps
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, text: s.text, position: s.position, done: s.done })),
  };
}

router.get("/tasks/recommend", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const excludeParam = String(req.query.exclude ?? "");
  const excludeIds = excludeParam
    ? excludeParam.split(",").map(Number).filter(n => !isNaN(n) && n > 0)
    : [];

  // Fetch all incomplete tasks for this user
  const allTasks = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, false)));

  if (!allTasks.length) {
    res.json({ task: null, reason: "No pending quests found." });
    return;
  }

  // Fetch today's completed tasks to compute category balance
  const today = new Date().toISOString().split("T")[0]!;
  const todayCompleted = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true)));

  const completedTodayCategories = new Set<string>();
  for (const t of todayCompleted) {
    if (t.completedAt && t.completedAt.toISOString().split("T")[0] === today) {
      completedTodayCategories.add(assignPoints(t.title, t.priority).category);
    }
  }

  const utcHour = new Date().getUTCHours();
  const isMorning   = utcHour >= 6  && utcHour < 11;
  const isAfternoon = utcHour >= 11 && utcHour < 17;
  const isEvening   = utcHour >= 17 && utcHour < 21;

  const candidates = allTasks.filter(t => !excludeIds.includes(t.id));
  if (!candidates.length) {
    res.json({ task: null, reason: "You've seen all pending quests." });
    return;
  }

  type ScoredTask = { task: typeof tasksTable.$inferSelect; score: number; reasons: string[] };
  const scored: ScoredTask[] = candidates.map(task => {
    const ap = assignPoints(task.title, task.priority);
    const category = ap.category;
    let score = 0;
    const reasons: string[] = [];

    // Priority bonus
    if (task.priority === "high")        { score += 15; reasons.push("high priority"); }
    else if (task.priority === "medium") { score += 5; }

    // Time-of-day boost
    if (isMorning) {
      if (MORNING_FOCUS_CATEGORIES.has(category)) {
        score += 20;
        reasons.push("ideal for morning focus");
      }
    } else if (isEvening) {
      if (EVENING_WINDDOWN_CATEGORIES.has(category)) {
        score += 20;
        reasons.push("perfect for your evening wind-down");
      }
      if (task.estimatedMinutes && task.estimatedMinutes <= 30) {
        score += 10;
        reasons.push("quick win");
      }
    }

    // Days in queue (cap at 7)
    const daysOld = Math.min(7, Math.floor((Date.now() - task.createdAt.getTime()) / 86_400_000));
    if (daysOld >= 2) {
      score += daysOld * 3;
      reasons.push(`waiting ${daysOld} day${daysOld === 1 ? "" : "s"}`);
    }

    // Category balance: boost uncompleted categories
    if (!completedTodayCategories.has(category)) {
      score += 15;
      reasons.push(`adds ${ap.categoryLabel} variety`);
    }

    // Overdue bonus (anchored tasks have no deadline and are never overdue).
    if (task.dueDate && task.dueDate < today) {
      score += 20;
      reasons.push("overdue");
    }

    // Short task boost when no estimate context
    if (task.estimatedMinutes && task.estimatedMinutes <= 20 && !isEvening) {
      score += 5;
    }

    return { task, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const ap = assignPoints(best.task.title, best.task.priority);

  let reason: string;
  if (best.reasons.includes("overdue")) {
    reason = "This quest is overdue — a great one to tackle now.";
  } else if (best.reasons.includes("ideal for morning focus")) {
    reason = `A great ${ap.categoryLabel.toLowerCase()} quest to kick off your morning.`;
  } else if (best.reasons.some(r => r.includes("evening"))) {
    reason = `Good choice for your evening — light and achievable.`;
  } else if (best.reasons.includes("high priority")) {
    reason = "High priority — this one moves the needle most.";
  } else if (best.reasons.some(r => r.includes("waiting"))) {
    const daysReason = best.reasons.find(r => r.includes("waiting")) ?? "waiting a few days";
    reason = `This has been ${daysReason} — a great time to knock it out.`;
  } else if (best.reasons.some(r => r.includes("variety"))) {
    reason = `Branch out into ${ap.categoryLabel} — you haven't touched it today.`;
  } else {
    reason = isAfternoon
      ? "Good momentum builder for the afternoon."
      : "A solid next step to keep things moving.";
  }

  res.json({ task: formatTask(best.task), reason, category: ap.category, categoryLabel: ap.categoryLabel });
});

router.get("/tasks/suggest-points", (req, res): void => {
  const title = String(req.query.title ?? "");
  const priority = String(req.query.priority ?? "medium");
  const result = assignPoints(title, priority);
  res.json(result);
});

router.get("/tasks", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { date, completed, category } = req.query;

  const userCond = eq(tasksTable.userId, userId);
  const completedCond =
    completed !== undefined && completed !== null
      ? eq(tasksTable.completed, completed === "true")
      : undefined;
  const categoryCond =
    category && typeof category === "string" && VALID_CATEGORIES.has(category)
      ? eq(tasksTable.category, category)
      : undefined;

  let where;
  if (date && typeof date === "string") {
    // Bucket A: tasks dated this day (respecting the status + category filters).
    const datedBucket = and(eq(tasksTable.dueDate, date), completedCond, categoryCond);
    // Bucket B: incomplete anchored tasks, injected regardless of date (respecting
    // the category filter). Skipped when the caller asked for completed-only, since
    // a completed anchored task has left the daily flow.
    const includeAnchored = completedCond === undefined || completed === "false";
    const anchoredBucket = includeAnchored
      ? and(eq(tasksTable.isAnchored, true), eq(tasksTable.completed, false), categoryCond)
      : undefined;
    where = and(userCond, anchoredBucket ? or(datedBucket, anchoredBucket) : datedBucket);
  } else {
    where = and(userCond, completedCond, categoryCond);
  }

  const tasks = await db.select().from(tasksTable)
    .where(where)
    .orderBy(desc(tasksTable.isAnchored), desc(tasksTable.createdAt));

  const taskIds = tasks.map((t) => t.id);
  const steps = taskIds.length
    ? await db.select().from(taskStepsTable)
        .where(inArray(taskStepsTable.taskId, taskIds))
        .orderBy(taskStepsTable.position)
    : [];
  const stepsByTask = new Map<number, (typeof taskStepsTable.$inferSelect)[]>();
  for (const s of steps) {
    const arr = stepsByTask.get(s.taskId) ?? [];
    arr.push(s);
    stepsByTask.set(s.taskId, arr);
  }

  res.json(tasks.map((t) => formatTask(t, stepsByTask.get(t.id) ?? [])));
});

router.post("/tasks", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, description, dueDate, dueTime, priority = "medium", estimatedMinutes, category, isAnchored } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    category?: string;
    isAnchored?: boolean;
  };

  const anchored = isAnchored === true;

  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!anchored && !dueDate) {
    res.status(400).json({ error: "dueDate is required for non-anchored quests" });
    return;
  }
  if (dueTime !== undefined && dueTime !== null && !isValidDueTime(dueTime)) {
    res.status(400).json({ error: "dueTime must be HH:mm (24-hour)" });
    return;
  }

  const autoPoint = assignPoints(title, priority);
  const resolvedCategory = category && VALID_CATEGORIES.has(category) ? category : autoPoint.category;

  // Anchored quests have no deadline: force a null date/time regardless of input.
  const [task] = await db.insert(tasksTable).values({
    userId,
    title,
    description,
    points: autoPoint.points,
    dueDate: anchored ? null : dueDate,
    dueTime: anchored ? null : (dueTime ?? null),
    priority,
    category: resolvedCategory,
    estimatedMinutes: estimatedMinutes ?? null,
    isAnchored: anchored,
  }).returning();

  res.status(201).json(formatTask(task));
});

router.post("/tasks/parse", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) { res.status(400).json({ error: "text is required" }); return; }
  if (text.length > 500) { res.status(400).json({ error: "text is too long" }); return; }

  const todayRaw = typeof req.body?.today === "string" ? req.body.today : undefined;
  // Anchor relative-date parsing to the client's local calendar date (noon avoids DST edges),
  // so the AI fallback resolves "next friday" etc. in the user's timezone, not the server's UTC.
  const now = todayRaw && isValidDueDate(todayRaw) ? new Date(`${todayRaw}T12:00:00`) : new Date();
  const deterministic = parseQuickAdd(text, { now });

  // Deterministic path was enough — no LLM call needed.
  if (deterministic.dueDate || deterministic.dueTime) {
    res.json(deterministic);
    return;
  }

  if (!isAiConfigured()) {
    res.status(503).json({ error: "AI parse is not configured" });
    return;
  }
  if (!parseCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment before parsing again." });
    return;
  }

  let aiParsed;
  try {
    const rawJson = await generateJson(buildQuickAddPrompt(text, { now }));
    aiParsed = parseQuickAddResult(rawJson, { text });
  } catch (err) {
    if (err instanceof AiClientError || err instanceof QuickAddParseError) {
      logger.warn({ err }, "quick-add parse generation failed");
      res.status(502).json({ error: "Couldn't smart-parse, edit manually." });
      return;
    }
    throw err;
  }

  // Deterministic fields win on merge (title, priority, category from explicit tokens).
  const merged = { ...aiParsed };
  if (deterministic.title) merged.title = deterministic.title;
  if (deterministic.priority) merged.priority = deterministic.priority;
  if (deterministic.category) merged.category = deterministic.category;
  res.json(merged);
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.select().from(tasksTable).where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const stepsForTask = await db.select().from(taskStepsTable)
    .where(eq(taskStepsTable.taskId, id))
    .orderBy(taskStepsTable.position);
  res.json(formatTask(task, stepsForTask));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Fetch task upfront to enforce ownership.
  const [existing] = await db.select({ completed: tasksTable.completed })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }

  // Points are server-assigned by auto-points logic and are not client-editable.
  const { title, description, dueDate, dueTime, priority, estimatedMinutes, actualMinutes, category, isAnchored } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
    category?: string;
    isAnchored?: boolean;
  };

  const updates: Partial<typeof tasksTable.$inferInsert> = {};

  if (existing.completed) {
    // On a completed task, only actualMinutes may be updated.
    if (actualMinutes != null) updates.actualMinutes = actualMinutes;
    if (Object.keys(updates).length === 0) {
      res.status(409).json({ error: "Cannot edit a completed task (only actualMinutes is allowed)" });
      return;
    }
    const [task] = await db.update(tasksTable).set(updates)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .returning();
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(formatTask(task));
    return;
  }

  // Incomplete task: allow full edit.
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
  if (dueDate != null) updates.dueDate = dueDate;
  if (dueTime !== undefined) {
    if (dueTime !== null && !isValidDueTime(dueTime)) {
      res.status(400).json({ error: "dueTime must be HH:mm (24-hour)" });
      return;
    }
    updates.dueTime = dueTime;
  }
  if (priority != null) updates.priority = priority;
  if (estimatedMinutes != null) updates.estimatedMinutes = estimatedMinutes;
  if (category != null && VALID_CATEGORIES.has(category)) updates.category = category;
  if (isAnchored !== undefined) {
    if (isAnchored === true) {
      // Anchoring drops the deadline entirely.
      updates.isAnchored = true;
      updates.dueDate = null;
      updates.dueTime = null;
    } else {
      updates.isAnchored = false;
      // Un-anchoring re-enters the dated flow; default to today unless the same
      // request supplied an explicit date (handled above, which wins).
      if (dueDate == null) updates.dueDate = new Date().toISOString().split("T")[0]!;
    }
  }

  // The WHERE clause re-checks completed=false as a safety guard against a race
  // between the read above and this write.
  let task: typeof tasksTable.$inferSelect | undefined;
  try {
    [task] = await db.update(tasksTable).set(updates)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId), eq(tasksTable.completed, false)))
      .returning();
  } catch (err) {
    // Rescheduling a recurring-spawned quest onto a date that already holds a
    // sibling instance violates unique(userId, recurringTaskId, dueDate).
    if (isUniqueViolation(err, "tasks_recurring_unique_idx")) {
      res.status(409).json({ error: "A quest from this habit already exists on that date." });
      return;
    }
    throw err;
  }
  if (!task) { res.status(409).json({ error: "Cannot edit a completed task" }); return; }

  res.json(formatTask(task));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.delete(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
    .returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.sendStatus(204);
});

router.post("/tasks/:id/complete", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // ─── Critical section ────────────────────────────────────────────────────────
  // Run inside a transaction so the task's completed=true and full snapshot are
  // committed atomically.  No /uncomplete request can ever observe completed=true
  // with a null pointsAwarded after this transaction commits.
  type TxOutcome =
    | { status: "not_found" }
    | { status: "already_completed"; existingTask: typeof tasksTable.$inferSelect; userPoints: number }
    | {
        status: "ok";
        task: typeof tasksTable.$inferSelect;
        boostedBase: number;
        pointsToAdd: number;
        bonusAwarded: boolean;
        focusBonusAwarded: boolean;
        streakBonus: number;
        multiplierLabel: string;
        multiplierValue: number;
        newTotalPoints: number;
        newWeeklyPoints: number;
        newLevel: ReturnType<typeof getLevelInfo>;
        leveledUp: boolean;
        newStreak: number;
        oldStreak: number;
        freezeConsumed: boolean;
      };

  const outcome = await db.transaction(async (tx): Promise<TxOutcome> => {
    // Lock the user row for the duration of the transaction to prevent concurrent
    // completions from reading stale point/streak totals.
    const [user] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!user) return { status: "not_found" };

    // Attempt the atomic completed=false → true flip.
    const [task] = await tx.update(tasksTable)
      .set({ completed: true, completedAt: now })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId), eq(tasksTable.completed, false)))
      .returning();

    if (!task) {
      const [existing] = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
      if (!existing) return { status: "not_found" };
      return { status: "already_completed", existingTask: existing, userPoints: user.totalPoints };
    }

    const oldLevel = getLevelInfo(user.totalPoints);
    const { totalPoints: boostedBase, streakBonus, multiplierInfo } = applyMultiplier(task.points, user.streakDays);
    let pointsToAdd = boostedBase;

    // Daily bonus check: read today's tasks inside the transaction for consistency.
    const todayTasks = await tx.select().from(tasksTable)
      .where(and(eq(tasksTable.userId, userId), eq(tasksTable.dueDate, today)));
    const allDone = todayTasks.every((t) => t.id === id || t.completed);
    let bonusAwarded = false;
    if (allDone && todayTasks.length > 0) {
      const recentBonus = await tx.select().from(activityTable)
        .where(and(eq(activityTable.userId, userId), eq(activityTable.type, "all_day_bonus")))
        .orderBy(desc(activityTable.createdAt))
        .limit(1);
      const alreadyGaveBonus = recentBonus.length > 0 &&
        recentBonus[0].createdAt.toISOString().split("T")[0] === today;
      if (!alreadyGaveBonus) {
        bonusAwarded = true;
        pointsToAdd += DAILY_BONUS_POINTS;
      }
    }

    // Focus quest bonus: award 10 XP once per day when all 3 pinned focus tasks are done.
    let focusBonusAwarded = false;
    if (task.isDailyFocus && task.focusDate === today) {
      const focusTasks = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.userId, userId), eq(tasksTable.isDailyFocus, true), eq(tasksTable.focusDate, today)));
      const allThreeDone = focusTasks.length === 3 && focusTasks.every((t) => t.id === id || t.completed);
      if (allThreeDone) {
        const recentFocusBonus = await tx.select().from(activityTable)
          .where(and(eq(activityTable.userId, userId), eq(activityTable.type, "focus_all_bonus")))
          .orderBy(desc(activityTable.createdAt))
          .limit(1);
        const alreadyGaveFocusBonus = recentFocusBonus.length > 0 &&
          recentFocusBonus[0].createdAt.toISOString().split("T")[0] === today;
        if (!alreadyGaveFocusBonus) {
          focusBonusAwarded = true;
          pointsToAdd += FOCUS_BONUS_POINTS;
        }
      }
    }

    // Streak computation.
    const streakDaysBefore = user.streakDays;
    const longestStreakBefore = user.longestStreak;
    const lastActiveDateBefore = user.lastActiveDate ?? null;
    let newStreak = user.streakDays;
    let freezeConsumed = false;
    if (user.lastActiveDate !== today) {
      if (user.lastActiveDate === yesterdayStr) {
        newStreak = user.streakDays + 1;
      } else if (user.streakFreezes > 0) {
        freezeConsumed = true;
      } else {
        newStreak = 1;
      }
    }

    const newTotalPoints = user.totalPoints + pointsToAdd;
    const newWeeklyPoints = user.weeklyPoints + pointsToAdd;
    const newLevel = getLevelInfo(newTotalPoints);
    const leveledUp = newLevel.level > oldLevel.level;
    const newLongestStreak = Math.max(user.longestStreak, newStreak);

    // Persist user state.
    await tx.update(usersTable).set({
      totalPoints: newTotalPoints,
      weeklyPoints: newWeeklyPoints,
      currentLevel: newLevel.level,
      streakDays: newStreak,
      longestStreak: newLongestStreak,
      lastActiveDate: today,
      ...(freezeConsumed ? { streakFreezes: user.streakFreezes - 1 } : {}),
    }).where(eq(usersTable.id, userId));

    // Write the full completion snapshot onto the task in the same transaction so
    // /uncomplete always sees a consistent state: completed=true ⟹ snapshot present.
    await tx.update(tasksTable).set({
      pointsAwarded: boostedBase,
      dailyBonusAwarded: bonusAwarded,
      streakDaysBefore,
      longestStreakBefore,
      lastActiveDateBefore,
      freezeConsumedOnComplete: freezeConsumed,
    }).where(eq(tasksTable.id, id));

    return {
      status: "ok",
      task,
      boostedBase,
      pointsToAdd,
      bonusAwarded,
      focusBonusAwarded,
      streakBonus,
      multiplierLabel: multiplierInfo.label,
      multiplierValue: multiplierInfo.multiplier,
      newTotalPoints,
      newWeeklyPoints,
      newLevel,
      leveledUp,
      newStreak,
      oldStreak: user.streakDays,
      freezeConsumed,
    };
  });
  // ─────────────────────────────────────────────────────────────────────────────

  if (outcome.status === "not_found") {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (outcome.status === "already_completed") {
    const lvl = getLevelInfo(outcome.userPoints);
    res.json({
      task: formatTask(outcome.existingTask),
      pointsAwarded: 0,
      bonusAwarded: false,
      bonusPoints: 0,
      streakBonus: 0,
      xpMultiplier: 1,
      newTotalPoints: outcome.userPoints,
      newLevel: lvl.level,
      leveledUp: false,
      newBadges: [],
    });
    return;
  }

  const { task, boostedBase, pointsToAdd, bonusAwarded, focusBonusAwarded, streakBonus, multiplierLabel, multiplierValue,
    newTotalPoints, newLevel, leveledUp, newStreak, oldStreak, freezeConsumed } = outcome;

  // ─── Post-transaction side effects ───────────────────────────────────────────
  // These run outside the transaction.  Any failure here leaves the user with
  // slightly stale badge/streak state rather than inconsistent XP — an acceptable
  // trade-off.  The unique constraints on user_badges and habit_streaks provide
  // last-resort protection against duplicates.

  let habitBadges: typeof badgesTable.$inferSelect[] = [];
  let habitStreakPreviousState: HabitStreakPreviousState | null = null;
  let habitGearReward: GearRewardInfo | null = null;
  if (task.recurringTaskId) {
    const completionDate = today;
    const result = await advanceHabitStreak(userId, task.recurringTaskId, completionDate, newLevel.level);
    habitBadges = result.newBadges;
    habitStreakPreviousState = result.previousState;
    habitGearReward = result.gearReward;
  }

  await db.insert(activityTable).values({
    userId,
    type: "task_completed",
    description: streakBonus > 0
      ? `Completed "${task.title}" (${multiplierLabel})`
      : `Completed "${task.title}"`,
    points: boostedBase,
  });

  if (bonusAwarded) {
    await db.insert(activityTable).values({
      userId,
      type: "all_day_bonus",
      description: "Completed all tasks for today! Daily bonus earned.",
      points: DAILY_BONUS_POINTS,
    });
  }

  if (focusBonusAwarded) {
    await db.insert(activityTable).values({
      userId,
      type: "focus_all_bonus",
      description: "Completed all 3 daily focus quests! Focus bonus earned.",
      points: FOCUS_BONUS_POINTS,
    });
  }

  if (freezeConsumed) {
    await db.insert(activityTable).values({
      userId,
      type: "streak_freeze_used",
      description: `Streak Freeze activated! Your ${oldStreak}-day streak is safe.`,
      points: 0,
    });
  }

  if (leveledUp) {
    await db.insert(activityTable).values({
      userId,
      type: "level_up",
      description: `Reached Level ${newLevel.level}: ${newLevel.name}!`,
      points: 0,
    });
  }

  let accountGearReward: GearRewardInfo | null = null;
  if (newStreak > oldStreak && (newStreak === 3 || newStreak === 7 || newStreak === 14 || newStreak === 30 || newStreak % 30 === 0)) {
    await db.insert(activityTable).values({
      userId,
      type: "streak_milestone",
      description: `${newStreak}-day streak! Keep it up!`,
      points: 0,
    });
    const isHighValue = task.points >= 50;
    const targetRarity = getStreakGearRarity(newStreak, isHighValue);
    accountGearReward = await awardStreakGear(
      userId,
      newLevel.level,
      targetRarity,
      `${newStreak}-day streak milestone`,
    );
  }

  // Badge grants.
  const allBadges = await db.select().from(badgesTable);
  const earnedBadgeIds = (await db.select().from(userBadgesTable)
    .where(eq(userBadgesTable.userId, userId))).map((ub) => ub.badgeId);
  const totalCompleted = (await db.select().from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true)))).length;

  const newBadges: typeof badgesTable.$inferSelect[] = [];
  const newBadgeIds: number[] = [];
  for (const badge of allBadges) {
    if (earnedBadgeIds.includes(badge.id)) continue;
    let qualifies = false;
    if (badge.category === "streak" && newStreak >= badge.requirement) qualifies = true;
    if (badge.category === "tasks" && totalCompleted >= badge.requirement) qualifies = true;
    if (badge.category === "points" && newTotalPoints >= badge.requirement) qualifies = true;
    if (badge.category === "level" && newLevel.level >= badge.requirement) qualifies = true;
    if (qualifies) {
      // onConflictDoNothing prevents duplicate badge rows from concurrent completions.
      // Only record activity and snapshot the badge ID if the insert actually succeeded.
      const [inserted] = await db.insert(userBadgesTable)
        .values({ userId, badgeId: badge.id })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        await db.insert(activityTable).values({
          userId,
          type: "badge_earned",
          description: `Earned badge: ${badge.name}`,
          points: 0,
        });
        newBadges.push(badge);
        newBadgeIds.push(badge.id);
      }
    }
  }

  const surpriseReward: SurpriseRewardResult = await rollSurpriseReward(userId, newLevel.level);

  // Collect gear item IDs awarded during this completion so /uncomplete can revoke them.
  const gearGrantedItemIds: number[] = [];
  if (accountGearReward) gearGrantedItemIds.push(accountGearReward.gearItemId);
  if (habitGearReward) gearGrantedItemIds.push(habitGearReward.gearItemId);
  if (surpriseReward?.type === "gear") gearGrantedItemIds.push(surpriseReward.gear.gearItemId);

  // Append badge IDs, habit-streak snapshot, and gear grants to the task row so
  // /uncomplete can reverse them all.
  await db.update(tasksTable).set({
    badgesGrantedIds: newBadgeIds.length > 0 ? JSON.stringify(newBadgeIds) : null,
    habitStreakSnapshot: habitStreakPreviousState
      ? JSON.stringify(habitStreakPreviousState)
      : null,
    gearGrantedIds: gearGrantedItemIds.length > 0 ? JSON.stringify(gearGrantedItemIds) : null,
  }).where(eq(tasksTable.id, id));
  // ─────────────────────────────────────────────────────────────────────────────

  const allNewBadges = [...newBadges, ...habitBadges];
  const finalTotalPoints = newTotalPoints + (surpriseReward?.type === "xp" ? surpriseReward.xpAmount : 0);

  // Surface the best gear reward (highest rarity wins; habit over account if tied)
  const RARITY_RANK: Record<string, number> = { common: 1, rare: 2, epic: 3, legendary: 4 };
  let gearReward: GearRewardInfo | null = null;
  if (accountGearReward && habitGearReward) {
    gearReward =
      (RARITY_RANK[habitGearReward.rarity] ?? 0) >= (RARITY_RANK[accountGearReward.rarity] ?? 0)
        ? habitGearReward
        : accountGearReward;
  } else {
    gearReward = habitGearReward ?? accountGearReward;
  }

  res.json({
    task: formatTask(task),
    pointsAwarded: pointsToAdd,
    bonusAwarded,
    bonusPoints: bonusAwarded ? DAILY_BONUS_POINTS : 0,
    streakBonus,
    xpMultiplier: multiplierValue,
    newTotalPoints: finalTotalPoints,
    newLevel: newLevel.level,
    leveledUp,
    newBadges: allNewBadges.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      category: b.category,
      requirement: b.requirement,
    })),
    gearReward,
    surpriseReward: surpriseReward ?? null,
    focusBonusAwarded,
    focusBonusPoints: focusBonusAwarded ? FOCUS_BONUS_POINTS : 0,
  });
});

router.post("/tasks/:id/uncomplete", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Collect side-effect reversal info before entering the transaction.
  const [taskPre] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!taskPre) { res.status(404).json({ error: "Task not found" }); return; }

  if (!taskPre.completed) {
    res.json(formatTask(taskPre));
    return;
  }

  // Require a valid snapshot.  Without it we cannot safely compute the exact rollback amounts,
  // so we reject the request rather than silently applying an incorrect partial reversal.
  if (taskPre.pointsAwarded === null || taskPre.pointsAwarded === undefined) {
    res.status(409).json({ error: "Task completion snapshot unavailable; cannot uncomplete" });
    return;
  }

  // ─── Transactional rollback ───────────────────────────────────────────────────
  const updatedTask = await db.transaction(async (tx) => {
    // Lock task and user rows to prevent concurrent /complete from racing this rollback.
    const [user] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    const [task] = await tx.select().from(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .for("update");

    if (!task || !user) return null;
    if (!task.completed) return task; // idempotent: already uncompleted

    const baseToReverse = task.pointsAwarded!;
    const bonusToReverse = task.dailyBonusAwarded ? DAILY_BONUS_POINTS : 0;
    const totalToReverse = baseToReverse + bonusToReverse;

    const newTotalPoints = Math.max(0, user.totalPoints - totalToReverse);
    const newWeeklyPoints = Math.max(0, user.weeklyPoints - totalToReverse);
    const newLevel = getLevelInfo(newTotalPoints);

    // Determine whether to restore streak state.
    // Only restore if this task was the sole contributor of today's streak advancement,
    // i.e., no other completed task remains for today.
    const today = new Date().toISOString().split("T")[0];
    const otherCompletedToday = await tx.select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.userId, userId),
        eq(tasksTable.completed, true),
        eq(tasksTable.dueDate, today),
      ));
    const hasOtherCompletedToday = otherCompletedToday.some((t) => t.id !== id);

    let newStreakDays = user.streakDays;
    let newLongestStreak = user.longestStreak;
    let newLastActiveDate: string | null = user.lastActiveDate ?? null;
    let freezesToRestore = 0;

    if (!hasOtherCompletedToday && task.streakDaysBefore !== null && task.streakDaysBefore !== undefined) {
      newStreakDays = task.streakDaysBefore;
      newLongestStreak = task.longestStreakBefore ?? user.longestStreak;
      newLastActiveDate = task.lastActiveDateBefore ?? null;
      if (task.freezeConsumedOnComplete) {
        freezesToRestore = 1;
      }
    }

    await tx.update(usersTable).set({
      totalPoints: newTotalPoints,
      weeklyPoints: newWeeklyPoints,
      currentLevel: newLevel.level,
      streakDays: newStreakDays,
      longestStreak: newLongestStreak,
      lastActiveDate: newLastActiveDate,
      ...(freezesToRestore > 0 ? { streakFreezes: user.streakFreezes + freezesToRestore } : {}),
    }).where(eq(usersTable.id, userId));

    const [updated] = await tx.update(tasksTable)
      .set({
        completed: false,
        completedAt: null,
        pointsAwarded: null,
        dailyBonusAwarded: false,
        streakDaysBefore: null,
        longestStreakBefore: null,
        lastActiveDateBefore: null,
        freezeConsumedOnComplete: false,
        badgesGrantedIds: null,
        habitStreakSnapshot: null,
        gearGrantedIds: null,
      })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.completed, true)))
      .returning();

    return updated ?? task;
  });
  // ─────────────────────────────────────────────────────────────────────────────

  if (!updatedTask) { res.status(404).json({ error: "Task not found" }); return; }

  // ─── Post-transaction side effects ───────────────────────────────────────────
  // Revoke task-completion badges and reverse habit streak advancement.
  // These use the snapshot captured before the transaction started; even if they
  // run slightly after the transaction commits, they are idempotent and safe.

  if (taskPre.badgesGrantedIds) {
    const badgeIds = JSON.parse(taskPre.badgesGrantedIds) as number[];
    for (const badgeId of badgeIds) {
      await db.delete(userBadgesTable)
        .where(and(eq(userBadgesTable.userId, userId), eq(userBadgesTable.badgeId, badgeId)));
    }
  }

  if (taskPre.recurringTaskId && taskPre.habitStreakSnapshot) {
    const previousState = JSON.parse(taskPre.habitStreakSnapshot) as HabitStreakPreviousState;
    await reverseHabitStreak(userId, taskPre.recurringTaskId, previousState);
  }

  // Revoke any gear that was awarded as a side effect of this completion.
  // Without this, a user could complete → receive gear → uncomplete → complete again
  // to cross the same streak/habit milestone repeatedly and farm unlimited equipment.
  if (taskPre.gearGrantedIds) {
    const gearItemIds = JSON.parse(taskPre.gearGrantedIds) as number[];
    for (const gearItemId of gearItemIds) {
      await db.delete(userGearTable)
        .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearItemId)));
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  res.json(formatTask(updatedTask));
});

router.post("/tasks/:id/breakdown", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [task] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  if (!isAiConfigured()) {
    res.status(503).json({ error: "AI breakdown is not configured" });
    return;
  }
  if (!breakdownCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment before generating another breakdown." });
    return;
  }

  let steps: string[];
  try {
    steps = await breakdownTask(
      {
        title: task.title,
        description: task.description,
        category: task.category,
        estimatedMinutes: task.estimatedMinutes,
      },
      generateJson,
    );
  } catch (err) {
    if (err instanceof AiClientError || err instanceof BreakdownParseError) {
      logger.warn({ err, taskId: id }, "task breakdown generation failed");
      res.status(502).json({ error: "Couldn't generate a breakdown, try again." });
      return;
    }
    throw err;
  }

  // Replace any existing steps atomically so a breakdown never half-applies.
  const inserted = await db.transaction(async (tx) => {
    await tx.delete(taskStepsTable)
      .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
    return tx.insert(taskStepsTable)
      .values(steps.map((text, i) => ({ taskId: id, userId, text, position: i })))
      .returning();
  });

  res.status(201).json(formatTask(task, inserted));
});

router.patch("/tasks/:id/steps/:stepId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawStepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;
  const id = parseInt(rawId, 10);
  const stepId = parseInt(rawStepId, 10);
  if (isNaN(id) || isNaN(stepId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const done: unknown = req.body?.done;
  if (typeof done !== "boolean") {
    res.status(400).json({ error: "done must be a boolean" });
    return;
  }

  const [updated] = await db.update(taskStepsTable)
    .set({ done })
    .where(and(
      eq(taskStepsTable.id, stepId),
      eq(taskStepsTable.taskId, id),
      eq(taskStepsTable.userId, userId),
    ))
    .returning();
  if (!updated) { res.status(404).json({ error: "Step not found" }); return; }

  res.json({ id: updated.id, text: updated.text, position: updated.position, done: updated.done });
});

router.delete("/tasks/:id/steps", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Idempotent: the userId filter means a non-owned/absent task deletes nothing.
  await db.delete(taskStepsTable)
    .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
  res.sendStatus(204);
});

router.patch("/tasks/:id/focus", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const pin: unknown = req.body?.pin;
  if (typeof pin !== "boolean") {
    res.status(400).json({ error: "pin must be a boolean" });
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  const [task] = await db.select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (task.completed) { res.status(400).json({ error: "Cannot pin a completed quest" }); return; }

  if (pin) {
    const [countResult] = await db.select({ total: count() })
      .from(tasksTable)
      .where(and(eq(tasksTable.userId, userId), eq(tasksTable.isDailyFocus, true), eq(tasksTable.focusDate, today)));
    if ((countResult?.total ?? 0) >= 3) {
      res.status(400).json({ error: "You already have 3 quests in focus today." });
      return;
    }
    const [updated] = await db.update(tasksTable)
      .set({ isDailyFocus: true, focusDate: today })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .returning();
    res.json(formatTask(updated));
  } else {
    const [updated] = await db.update(tasksTable)
      .set({ isDailyFocus: false, focusDate: null })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .returning();
    res.json(formatTask(updated));
  }
});

void getPointsToNextLevel;
void logger;

export default router;
