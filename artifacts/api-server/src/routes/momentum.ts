import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, brainCheckinsTable, tasksTable, taskStepsTable } from "@workspace/db";
import { deriveBrainState } from "../lib/brain-mode";
import { rankMomentum, type MomentumTask } from "../lib/momentum";
import { localDateKey, localHour } from "../lib/date-buckets";
import { derivePatterns } from "../lib/patterns";
import { loadPatternInputs, resolveUserTimeZone } from "./patterns";
import { assignPoints } from "../lib/auto-points";
import { evaluateDifficultyOffer, toOfferInput } from "../lib/difficulty";
import { isAiConfigured } from "../lib/ai/client";
import { formatTask } from "./tasks";

const router: IRouter = Router();

// NOTE: mounted before tasksRouter in routes/index.ts so the static
// /tasks/momentum segment wins over /tasks/:id.
router.get("/tasks/momentum", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  // Persisted users.timezone beats the query param beats UTC — same resolution
  // as the patterns route, so windows and ranking agree on the user's clock.
  const tz = await resolveUserTimeZone(userId, req.query.tz);
  const rawMinutes = parseInt(String(req.query.minutes ?? ""), 10);
  const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0 && rawMinutes <= 480 ? rawMinutes : undefined;
  const excludeIds = String(req.query.exclude ?? "")
    .split(",").map(Number).filter((n) => !isNaN(n) && n > 0);

  const now = new Date();
  const todayStr = localDateKey(now, tz);

  const [latest] = await db
    .select()
    .from(brainCheckinsTable)
    .where(eq(brainCheckinsTable.userId, userId))
    .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
    .limit(1);
  const state = deriveBrainState(latest, now, tz);

  // One substrate load per momentum call (compute-on-read, PR #47). Below "ok"
  // confidence steering is absent entirely: empty hours = no signal.
  const patterns = derivePatterns(await loadPatternInputs(userId, tz, now));
  const powerHours = patterns.confidence === "ok" ? patterns.powerHours.map((p) => p.hour) : [];

  const open = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, false)));

  // Categories completed today (local day) for the variety signal.
  const done = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true)));
  const completedTodayCategories = new Set<string>();
  for (const t of done) {
    if (t.completedAt && localDateKey(t.completedAt, tz) === todayStr) {
      completedTodayCategories.add(
        t.category !== "default" ? t.category : assignPoints(t.title, t.priority).category,
      );
    }
  }

  const steps = await db
    .select()
    .from(taskStepsTable)
    .where(eq(taskStepsTable.userId, userId));
  const stepsByTask = new Map<number, typeof steps>();
  for (const s of steps) {
    const list = stepsByTask.get(s.taskId) ?? [];
    list.push(s);
    stepsByTask.set(s.taskId, list);
  }

  const candidates: MomentumTask[] = open
    .filter((t) => !excludeIds.includes(t.id))
    .map((t) => {
      const ts = stepsByTask.get(t.id) ?? [];
      return {
        id: t.id, title: t.title, priority: t.priority, category: t.category,
        difficulty: t.difficulty,
        estimatedMinutes: t.estimatedMinutes, createdAt: t.createdAt,
        dueDate: t.dueDate, isAnchored: t.isAnchored,
        isDailyFocus: t.isDailyFocus, focusDate: t.focusDate,
        stepsDone: ts.filter((s) => s.done).length,
        stepsOpen: ts.filter((s) => !s.done).length,
      };
    });

  const ranked = rankMomentum(candidates, {
    mode: state.mode, minutes, now,
    localHour: localHour(now, tz), todayStr, completedTodayCategories,
    powerHours,
  });

  const byId = new Map(open.map((t) => [t.id, t]));
  const canOffer = isAiConfigured();
  const suggestions = ranked.slice(0, 3).map((s, i) => {
    const row = byId.get(s.taskId)!;
    const offerable = canOffer && evaluateDifficultyOffer(
      toOfferInput(row),
      { now, todayStr, mode: state.mode },
    );
    return {
      task: formatTask(row, stepsByTask.get(s.taskId) ?? [], { difficultyOfferable: offerable }),
      reason: s.reason,
      kind: i === 0 ? "primary" : "alternate",
    };
  });

  res.json({ mode: state.mode, suggestions });
});

export default router;
