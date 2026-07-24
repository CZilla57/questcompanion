import express, { Router, type IRouter } from "express";
import { eq, and, or, desc, count, inArray, sql } from "drizzle-orm";
import { applyMultiplier } from "../lib/xp-multiplier";
import { db, usersTable, tasksTable, badgesTable, userBadgesTable, activityTable, userGearTable, taskStepsTable, questlinesTable, brainCheckinsTable, recurringTasksTable } from "@workspace/db";
import type { DifficultyLevel, VariantLadder } from "@workspace/db";
import { getLevelInfo, getPointsToNextLevel, DAILY_BONUS_POINTS } from "../lib/gamification";
import { newlyUnlocked, type FeatureKey } from "../lib/feature-gates";
import { assignPoints, CATEGORY_LABELS, VALID_CATEGORIES } from "../lib/auto-points";
import { advanceHabitStreak, reverseHabitStreak, type HabitStreakPreviousState } from "../lib/habit-streaks";
import { toFrequency } from "../lib/recurrence";
import { awardStreakGear, getStreakGearRarity, type GearRewardInfo } from "../lib/gear-rewards";
import { rollSurpriseReward, type SurpriseRewardResult } from "../lib/surprise-rewards";
import { grantQualifyingBadges } from "../lib/badge-awards";
import { logger } from "../lib/logger";
import { breakdownTask, BreakdownParseError } from "../lib/ai/task-breakdown";
import { generateJson, isAiConfigured, AiClientError } from "../lib/ai/client";
import { breakdownCooldown } from "../lib/ai/breakdown-cooldown";
import { generateVariants, VariantsParseError } from "../lib/ai/difficulty-variants";
import { variantsCooldown } from "../lib/ai/variants-cooldown";
import { assembleLadder, snapshotMedium, needsVariantGeneration, evaluateDifficultyOffer, toOfferInput } from "../lib/difficulty";
import { isValidDueTime, isValidDueDate } from "../lib/task-datetime";
import { deriveBrainState } from "../lib/brain-mode";
import { resolveTimeZone, localDateKey } from "../lib/date-buckets";
import { isBigSwing, rescheduleStruggleDelta } from "../lib/steering";
import { parseQuickAdd } from "@workspace/quick-add";
import { buildQuickAddPrompt, parseQuickAddResult, QuickAddParseError } from "../lib/ai/quick-add-parse";
import { parseCooldown } from "../lib/ai/parse-cooldown";
import { transcribeAudio, audioExtensionFor, isTranscriptionConfigured } from "../lib/ai/transcribe-audio";
import { transcribeCooldown } from "../lib/ai/transcribe-cooldown";
import { isBonusGatingTask, countsAsTodayCompletion } from "../lib/anchored-tasks";
import { isQuestlineAssignable } from "../lib/questlines";
import { hungerStage } from "../lib/hero-care";
import { completionCompanionReaction } from "../lib/companion";
import { growKingdom } from "../lib/kingdom-growth";
import { grantInitiationAwards } from "../lib/initiation-grant";
import type { InitiationXp } from "../lib/initiation";
import { awardCoins, reverseCoins } from "../lib/award-coins";
import { COIN_EARN, isStreakMilestone } from "../lib/coins";
import { isBoostActive, boostBonusPoints, XP_BOOST_BONUS } from "../lib/stat-perks";
import { isValidClientKey } from "../lib/client-key";

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

export function formatTask(
  task: typeof tasksTable.$inferSelect,
  steps: (typeof taskStepsTable.$inferSelect)[] = [],
  opts: { difficultyOfferable?: boolean } = {},
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
    questlineId: task.questlineId ?? null,
    difficulty: task.difficulty,
    difficultyOfferable: opts.difficultyOfferable ?? false,
    bigSwing: isBigSwing(task),
    steps: steps
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, text: s.text, position: s.position, done: s.done })),
  };
}

// Resolve a client-supplied questlineId for a create/update. Returns:
//  - { ok: true, value }  -> use `value` (a number to link, or null to unlink)
//  - { ok: false, error } -> reject with a 422
// A quest may only join a questline the user owns, and only if it is one-off.
async function resolveQuestlineId(
  userId: number,
  questlineId: number | null | undefined,
  task: { recurringTaskId: number | null },
): Promise<{ ok: true; value: number | null } | { ok: false; error: string }> {
  if (questlineId === undefined) return { ok: true, value: null };
  if (questlineId === null) return { ok: true, value: null };
  if (!isQuestlineAssignable(task)) {
    return { ok: false, error: "Recurring quests can't join a questline" };
  }
  const [ql] = await db.select({ id: questlinesTable.id }).from(questlinesTable)
    .where(and(eq(questlinesTable.id, questlineId), eq(questlinesTable.userId, userId)));
  if (!ql) return { ok: false, error: "Questline not found" };
  return { ok: true, value: questlineId };
}

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

  // Adaptive-difficulty offers are opt-in per request (client sends tz). Without
  // tz we can't do local-day math, so offers default off and only the manual
  // controls (driven by `difficulty`) show.
  const tzRaw = req.query.tz;
  let offerFor: (t: typeof tasksTable.$inferSelect) => boolean = () => false;
  if (typeof tzRaw === "string" && tzRaw && isAiConfigured()) {
    const tz = resolveTimeZone(tzRaw);
    const now = new Date();
    const todayStr = localDateKey(now, tz);
    const [latest] = await db.select().from(brainCheckinsTable)
      .where(eq(brainCheckinsTable.userId, userId))
      .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
      .limit(1);
    const mode = deriveBrainState(latest, now, tz).mode;
    offerFor = (t) => evaluateDifficultyOffer(toOfferInput(t), { now, todayStr, mode });
  }

  res.json(tasks.map((t) => formatTask(t, stepsByTask.get(t.id) ?? [], { difficultyOfferable: offerFor(t) })));
});

router.post("/tasks", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, description, dueDate, dueTime, priority = "medium", estimatedMinutes, category, isAnchored, questlineId, clientKey } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    category?: string;
    isAnchored?: boolean;
    questlineId?: number | null;
    clientKey?: string;
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
  if (clientKey !== undefined && !isValidClientKey(clientKey)) {
    res.status(400).json({ error: "clientKey must be a string of 8-64 characters" });
    return;
  }

  const autoPoint = assignPoints(title, priority);
  const resolvedCategory = category && VALID_CATEGORIES.has(category) ? category : autoPoint.category;

  const qlResult = await resolveQuestlineId(userId, questlineId, { recurringTaskId: null });
  if (!qlResult.ok) { res.status(422).json({ error: qlResult.error }); return; }

  // Anchored quests have no deadline: force a null date/time regardless of input.
  // onConflictDoNothing can only ever match the (user_id, client_key) partial
  // index here: this route never sets recurringTaskId, so the recurring unique
  // constraint (which treats its NULL as distinct) cannot fire.
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
    questlineId: qlResult.value,
    clientKey: clientKey ?? null,
  }).onConflictDoNothing().returning();

  if (!task) {
    // A replay of a capture we already have: hand back the existing quest.
    // 200 (not 201) so the client can tell "created" from "already had it".
    if (!clientKey) { res.status(500).json({ error: "Task insert failed" }); return; }
    const [existing] = await db.select().from(tasksTable)
      .where(and(eq(tasksTable.userId, userId), eq(tasksTable.clientKey, clientKey)));
    if (!existing) { res.status(500).json({ error: "Task insert failed" }); return; }
    const existingSteps = await db.select().from(taskStepsTable)
      .where(eq(taskStepsTable.taskId, existing.id))
      .orderBy(taskStepsTable.position);
    res.status(200).json(formatTask(existing, existingSteps));
    return;
  }

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

router.post(
  "/tasks/transcribe",
  // Reject unauthenticated requests before express.raw buffers up to 10MB.
  (req, res, next) => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  },
  // The global parser is express.json() only, which ignores audio bodies —
  // this scoped raw parser fills req.body with a Buffer for the two container
  // types MediaRecorder actually produces (type matching ignores codec params).
  // Oversized bodies get an automatic 413 from the limit — with Express's
  // default error body, not our ErrorEnvelope (no shaping middleware exists).
  // Acceptable: the 60s cap keeps real clips ~1MB, and the client maps any
  // unexpected status to a generic toast.
  express.raw({ type: ["audio/webm", "audio/mp4"], limit: "10mb" }),
  async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
    const userId = req.gameUserId;

    const contentType = req.get("content-type") ?? "";
    // A non-matching content type leaves req.body unparsed, so Buffer.isBuffer
    // doubles as the unsupported-container check.
    if (!audioExtensionFor(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "An audio/webm or audio/mp4 body is required" });
      return;
    }

    if (!isTranscriptionConfigured()) {
      res.status(503).json({ error: "Voice transcription is not configured" });
      return;
    }
    if (!transcribeCooldown.tryAcquire(userId)) {
      res.status(429).json({ error: "Slow down a moment before transcribing again." });
      return;
    }

    let text: string;
    try {
      text = await transcribeAudio(req.body, contentType);
    } catch (err) {
      if (err instanceof AiClientError) {
        logger.warn({ err }, "voice transcription failed");
        res.status(502).json({ error: "Couldn't transcribe, try typing it." });
        return;
      }
      throw err;
    }

    // May legitimately be empty (silent clip) — the frontend handles that case.
    res.json({ text });
  },
);

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
  const [existing] = await db.select({
    completed: tasksTable.completed,
    recurringTaskId: tasksTable.recurringTaskId,
    dueDate: tasksTable.dueDate,
    struggleScore: tasksTable.struggleScore,
  })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }

  // Points are server-assigned by auto-points logic and are not client-editable.
  const { title, description, dueDate, dueTime, priority, estimatedMinutes, actualMinutes, category, isAnchored, questlineId, viaSteering } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
    category?: string;
    isAnchored?: boolean;
    questlineId?: number | null;
    viaSteering?: boolean;
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
  // A re-worded quest is a new baseline: drop the stale ladder and return to medium.
  if (title != null || description != null) {
    updates.difficultyVariants = null;
    updates.difficulty = "medium";
  }
  if (dueDate != null) {
    updates.dueDate = dueDate;
    // Giving a quest a concrete date takes it out of the anchored (no-deadline)
    // state, unless this same request is explicitly re-anchoring it below.
    if (isAnchored !== true) updates.isAnchored = false;
    // Pushing an incomplete quest to a later day is a silent "I keep avoiding this" —
    // unless the user is steering it into a power window, which is planning.
    const rescheduleDelta = rescheduleStruggleDelta(existing.dueDate, dueDate, viaSteering === true);
    if (rescheduleDelta > 0) updates.struggleScore = existing.struggleScore + rescheduleDelta;
  }
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
  if (questlineId !== undefined) {
    const qlResult = await resolveQuestlineId(userId, questlineId, { recurringTaskId: existing.recurringTaskId });
    if (!qlResult.ok) { res.status(422).json({ error: qlResult.error }); return; }
    updates.questlineId = qlResult.value;
  }
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
        unlockedByAward: FeatureKey[];
        newStreak: number;
        oldStreak: number;
        freezeConsumed: boolean;
        heroRevived: boolean;
        companionReaction: string | null;
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

    // Hero care: completing any quest feeds the hero. Revival happens when the
    // hero was fainted (≥7 days unfed) at the moment this completion landed.
    const heroRevived = hungerStage(user.lastFedAt, now) === "fainted";

    const oldLevel = getLevelInfo(user.totalPoints);
    const { totalPoints: boostedBase, streakBonus, multiplierInfo } = applyMultiplier(task.points, user.streakDays);
    let pointsToAdd = boostedBase;

    // Act IV Stat Perk: an active XP Boost adds a flat % of the base quest reward
    // on top of the streak multiplier. Purely additive (upside-only) — it never
    // touches the streak/level math and can never lower a payout.
    const xpBoostBonus = boostBonusPoints(task.points, isBoostActive(user.xpBoostExpiresAt, now), XP_BOOST_BONUS);
    pointsToAdd += xpBoostBonus;

    // Daily bonus check: the gating set is tasks due today plus anchored tasks past
    // their one-day grace (created before today). Fetch the superset in-transaction,
    // then filter with the pure predicate so grace logic stays unit-tested.
    const candidateTasks = await tx.select().from(tasksTable)
      .where(and(
        eq(tasksTable.userId, userId),
        or(eq(tasksTable.dueDate, today), eq(tasksTable.isAnchored, true)),
      ));
    const gatingTasks = candidateTasks.filter((t) => isBonusGatingTask(t, today));
    const allDone = gatingTasks.every((t) => t.id === id || t.completed);
    let bonusAwarded = false;
    if (allDone && gatingTasks.length > 0) {
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
    // Gentle Door: gates crossed by this award (floor-aware; [] for unlockAll).
    const unlockedByAward = newlyUnlocked(user, oldLevel.level, newLevel.level);
    const newLongestStreak = Math.max(user.longestStreak, newStreak);

    // Act VI Living Companion: bond grows by one per completion (monotonic).
    const bondBefore = user.bondQuestsCompleted;
    const companionReaction = completionCompanionReaction({
      bondBefore,
      leveledUp,
      newLevel: newLevel.level,
      userId,
      now,
    });

    // Persist user state.
    await tx.update(usersTable).set({
      totalPoints: newTotalPoints,
      weeklyPoints: newWeeklyPoints,
      currentLevel: newLevel.level,
      streakDays: newStreak,
      longestStreak: newLongestStreak,
      lastActiveDate: today,
      lastFedAt: now,
      hungerNotifiedStage: null,
      bondQuestsCompleted: bondBefore + 1,
      ...(freezeConsumed ? { streakFreezes: user.streakFreezes - 1 } : {}),
    }).where(eq(usersTable.id, userId));

    // Act VI Life Kingdoms: base points (NOT boostedBase) grow the kingdom that
    // owns this quest's category. Monotonic — /uncomplete deliberately does not
    // reverse this.
    await growKingdom(tx, userId, task.category, task.points);

    // Act IV coins: every completed quest pays out; streak milestones pay a bonus.
    const coinMilestone = isStreakMilestone(newStreak, streakDaysBefore);
    await awardCoins(tx, userId, COIN_EARN.questComplete, "quest_complete");
    if (coinMilestone) {
      await awardCoins(tx, userId, COIN_EARN.streakMilestone, "streak_milestone");
    }
    const coinsAwarded = COIN_EARN.questComplete + (coinMilestone ? COIN_EARN.streakMilestone : 0);

    // Write the full completion snapshot onto the task in the same transaction so
    // /uncomplete always sees a consistent state: completed=true ⟹ snapshot present.
    await tx.update(tasksTable).set({
      pointsAwarded: boostedBase,
      coinsAwarded,
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
      unlockedByAward,
      newStreak,
      oldStreak: user.streakDays,
      freezeConsumed,
      heroRevived,
      companionReaction,
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
      newlyUnlocked: [],
      newBadges: [],
      heroRevived: false,
    });
    return;
  }

  const { task, boostedBase, pointsToAdd, bonusAwarded, focusBonusAwarded, streakBonus, multiplierLabel, multiplierValue,
    newTotalPoints, newLevel, leveledUp, unlockedByAward, newStreak, oldStreak, freezeConsumed, heroRevived, companionReaction } = outcome;

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
    // Cadence decides how the streak counts. Bucket on the quest's own due
    // date, not the day it was ticked off, so a monthly quest finished a
    // couple of days late still lands in the right period. due_date is
    // nullable (anchored tasks), so fall back to the completion date.
    const [template] = await db
      .select({ frequency: recurringTasksTable.frequency })
      .from(recurringTasksTable)
      .where(eq(recurringTasksTable.id, task.recurringTaskId));
    const frequency = toFrequency(template?.frequency);

    const result = await advanceHabitStreak(
      userId,
      task.recurringTaskId,
      completionDate,
      newLevel.level,
      { frequency, occurrenceDate: task.dueDate ?? completionDate },
    );
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
  if (isStreakMilestone(newStreak, oldStreak)) {
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

  // Badge grants.  Qualification is metric-driven (see `badge-rules.ts`), so
  // adding a badge to the catalog needs no change here.
  const [{ n: totalCompleted }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true)));

  const newBadges = await grantQualifyingBadges(userId, {
    streak_days: newStreak,
    tasks_completed: totalCompleted,
    total_points: newTotalPoints,
    level: newLevel.level,
  });
  const newBadgeIds = newBadges.map((b) => b.id);

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
    newlyUnlocked: unlockedByAward,
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
    heroRevived,
    companionReaction,
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
    // Streak restore only if this task was the sole contributor to today's activity.
    // A "today contribution" is a task due today OR an anchored task completed today.
    const completedTodayCandidates = await tx.select()
      .from(tasksTable)
      .where(and(
        eq(tasksTable.userId, userId),
        eq(tasksTable.completed, true),
        or(eq(tasksTable.dueDate, today), eq(tasksTable.isAnchored, true)),
      ));
    const hasOtherCompletedToday = completedTodayCandidates.some(
      (t) => t.id !== id && countsAsTodayCompletion(t, today),
    );

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
      // Gentle Door monotonic floor: capture the pre-reversal level so this XP
      // drop can never close a door the user has seen. Only written here — the
      // sole XP-lowering path.
      highestLevel: Math.max(user.highestLevel, getLevelInfo(user.totalPoints).level),
      ...(freezesToRestore > 0 ? { streakFreezes: user.streakFreezes + freezesToRestore } : {}),
    }).where(eq(usersTable.id, userId));

    await reverseCoins(tx, userId, task.coinsAwarded, "quest_uncomplete");

    const [updated] = await tx.update(tasksTable)
      .set({
        completed: false,
        completedAt: null,
        pointsAwarded: null,
        coinsAwarded: 0,
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

const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = ["easy", "medium", "hard"] as const;

router.post("/tasks/:id/difficulty", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const level = (req.body as { level?: unknown }).level;
  if (typeof level !== "string" || !DIFFICULTY_LEVELS.includes(level as DifficultyLevel)) {
    res.status(400).json({ error: "level must be easy, medium, or hard" });
    return;
  }
  const target = level as DifficultyLevel;

  const [task] = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (task.completed) { res.status(409).json({ error: "Can't change difficulty of a completed quest" }); return; }

  // needsVariantGeneration is the authoritative predicate (unit-tested in lib/difficulty):
  // a never-laddered quest moving to medium is a no-op (it already IS its medium baseline);
  // a never-laddered quest moving to easy/hard must draft the ladder first.
  let ladder: VariantLadder;
  if (task.difficultyVariants) {
    ladder = task.difficultyVariants; // reuse — no AI call
  } else if (needsVariantGeneration(!!task.difficultyVariants, target)) {
    // Generate the ladder on first use (guards mirror /breakdown exactly).
    if (!isAiConfigured()) { res.status(503).json({ error: "AI difficulty is not configured" }); return; }
    if (!variantsCooldown.tryAcquire(userId)) {
      res.status(429).json({ error: "Slow down a moment before resizing another quest." });
      return;
    }
    const currentSteps = await db.select().from(taskStepsTable)
      .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
    const stepTexts = currentSteps.slice().sort((a, b) => a.position - b.position).map((s) => s.text);
    try {
      const drafts = await generateVariants(
        { title: task.title, description: task.description, category: task.category, estimatedMinutes: task.estimatedMinutes, steps: stepTexts },
        generateJson,
      );
      ladder = assembleLadder(snapshotMedium(task, stepTexts), drafts);
    } catch (err) {
      if (err instanceof AiClientError || err instanceof VariantsParseError) {
        logger.warn({ err, taskId: id }, "difficulty variant generation failed");
        res.status(502).json({ error: "Couldn't resize that quest, try again." });
        return;
      }
      throw err;
    }
  } else {
    // No variants && target === "medium": nothing to draft — return the quest unchanged.
    const steps = await db.select().from(taskStepsTable)
      .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
    res.json(formatTask(task, steps));
    return;
  }

  const rung = ladder[target];

  // Swap title/estimate/steps + persist the ladder, reset struggle, snooze — atomically.
  const { updated, steps } = await db.transaction(async (tx) => {
    const [row] = await tx.update(tasksTable)
      .set({
        title: rung.title,
        estimatedMinutes: rung.estimatedMinutes,
        difficulty: target,
        difficultyVariants: ladder,
        struggleScore: 0,
        difficultyOfferSnoozedAt: new Date(),
      })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .returning();
    await tx.delete(taskStepsTable)
      .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
    const inserted = rung.steps.length
      ? await tx.insert(taskStepsTable)
          .values(rung.steps.map((text, i) => ({ taskId: id, userId, text, position: i })))
          .returning()
      : [];
    return { updated: row!, steps: inserted };
  });

  res.json(formatTask(updated, steps));
});

router.post("/tasks/:id/difficulty/snooze", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [updated] = await db.update(tasksTable)
    .set({ difficultyOfferSnoozedAt: new Date() })
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
    .returning({ id: tasksTable.id });
  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

  res.json({ ok: true });
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
  const tz = typeof req.query.tz === "string" ? req.query.tz : undefined;

  type Outcome =
    | { status: "not_found" }
    | { status: "ok"; step: { id: number; text: string; position: number; done: boolean }; initiationXp: InitiationXp };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row: initiation awards read and update point totals.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [current] = await tx.select().from(taskStepsTable)
      .where(and(
        eq(taskStepsTable.id, stepId),
        eq(taskStepsTable.taskId, id),
        eq(taskStepsTable.userId, userId),
      ));
    if (!current) return { status: "not_found" };

    const [updated] = await tx.update(taskStepsTable)
      .set({ done })
      .where(eq(taskStepsTable.id, current.id))
      .returning();
    if (!updated) return { status: "not_found" };

    // Initiation XP only on a false→true transition; unchecking never refunds.
    let initiationXp: InitiationXp = { total: 0, awards: [] };
    if (done && !current.done) {
      const [task] = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
      if (task) {
        const siblings = await tx.select().from(taskStepsTable)
          .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
        const otherStepsAlreadyDone = siblings.some((s) => s.id !== stepId && s.done);
        initiationXp = await grantInitiationAwards(tx, user, {
          type: "step_check",
          task: { id: task.id, title: task.title, questlineId: task.questlineId ?? null },
          otherStepsAlreadyDone,
        }, tz);
      }
    }

    return {
      status: "ok",
      step: { id: updated.id, text: updated.text, position: updated.position, done: updated.done },
      initiationXp,
    };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Step not found" }); return; }
  res.json({ ...outcome.step, initiationXp: outcome.initiationXp });
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
